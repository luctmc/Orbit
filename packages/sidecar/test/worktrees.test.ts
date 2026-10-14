import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { parsePrStatus } from '../src/core.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Teste', '-c', 'user.email=teste@exemplo.dev', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8' })

/** A repository with an "origin" (a bare repo next to it) and the workspace in its app/ folder. */
function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-git-')))
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  git(root, 'init', '-q', '--bare', origin)
  git(root, 'init', '-q', work)
  mkdirSync(join(work, 'app'))
  writeFileSync(join(work, 'app', 'index.js'), 'export const a = 1\n')
  git(work, 'add', '.')
  git(work, 'commit', '-q', '-m', 'início')
  git(work, 'remote', 'add', 'origin', origin)
  git(work, 'push', '-q', '-u', 'origin', 'main')
  return { root, origin, work, folder: join(work, 'app') }
}

const ROLLUP = JSON.stringify({
  number: 7, url: 'https://github.com/luctmc/app/pull/7', state: 'OPEN', isDraft: true,
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'testes', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'StatusContext', context: 'deploy', state: 'FAILURE' },
  ],
})

test('PR checks are read from gh', () => {
  const status = parsePrStatus(ROLLUP)
  assert.deepEqual(status.checks, [{ name: 'testes', state: 'ok' }, { name: 'lint', state: 'pending' }, { name: 'deploy', state: 'fail' }])
  assert.deepEqual([status.number, status.state, status.draft], [7, 'OPEN', true])
})

test('each agent works in its own worktree and branch, and the mission becomes a PR', async () => {
  const { origin, work, folder } = repo()
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const ran: string[] = []
  const gh: Run = async (command) => {
    ran.push(command)
    if (command.includes('gh pr create')) return { code: 0, stdout: 'https://github.com/luctmc/app/pull/7\n', stderr: '' }
    if (command.includes('gh pr view 7')) return { code: 0, stdout: ROLLUP, stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const launches: AgentLaunch[] = []
  const fake = (launch: AgentLaunch, shell: string) => {
    launches.push(launch)
    return { file: shell, args: ['-c', `exec ${shell}`] }
  }
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: gh, agentCommand: fake, browser: null })
  const ui = connect(server.port)
  let mcp: Client | null = null
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: folder })
    const { workspace } = await ui.next('workspace.updated')

    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Novo cálculo de frete', objective: '', mode: 'livre', isolation: 'worktrees', lead: { cli: 'claude', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    const branch = mission.git!.branch
    assert.match(branch, /^orbit\/novo-calculo-de-frete-[0-9a-f]{4}$/)
    assert.equal(mission.git!.base, 'main')
    assert.equal(lead.branch, branch)
    assert.equal(lead.cwd, join(dataDir, 'worktrees', mission.id, 'lider', 'app'), 'the lead starts in the same subfolder of its copy')
    assert.equal(git(work, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main', "the person's checkout is untouched")
    assert.match(readFileSync(join(dataDir, 'panes', String(lead.id), 'role.md'), 'utf8'), /cópia isolada do repositório \(git worktree\)/)

    ui.send({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'claude', model: null, title: 'Frete' } })
    const { pane: helper } = await ui.next('pane.updated', (m) => m.pane.title === 'Frete')
    assert.equal(helper.branch, `${branch}--${helper.id}`)
    const helperTree = join(dataDir, 'worktrees', mission.id, String(helper.id))
    assert.equal(helper.cwd, join(helperTree, 'app'))

    // The helper commits one change and leaves another uncommitted, then delivers.
    writeFileSync(join(helperTree, 'app', 'frete.js'), 'export const frete = (kg) => kg * 2\n')
    git(helperTree, 'add', '.')
    git(helperTree, 'commit', '-q', '-m', 'Cálculo de frete')
    writeFileSync(join(helperTree, 'app', 'rascunho.txt'), 'ideias\n')
    ui.send({ type: 'pane.input', paneId: helper.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === helper.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    await mcp.callTool({ name: 'handoff_submit', arguments: { summary: 'Frete pronto', evidence: 'npm test' } })
    const handoff = await ui.next('event.added', (m) => m.event.kind === 'handoff')
    assert.match(handoff.event.body, new RegExp(`1 commit\\(s\\) para integrar \\(git merge ${branch}--${helper.id}\\)`))
    assert.match(handoff.event.body, /1 arquivo\(s\) sem commit/)

    ui.send({ type: 'git.summary', missionId: mission.id })
    let { summary } = await ui.next('git.summary')
    assert.deepEqual(summary.agents.map((a) => [a.paneId, a.ahead, a.dirty]), [[helper.id, 1, ['app/rascunho.txt']]])
    assert.equal(summary.commits.length, 0)
    assert.equal(summary.remote, true)

    // The lead integrates; a PR needs commits on the mission branch.
    ui.send({ type: 'git.pr.create', missionId: mission.id, title: 'Frete', body: 'corpo', draft: true })
    assert.match((await ui.next('files.error')).message, /ainda não tem commits/)
    git(join(dataDir, 'worktrees', mission.id, 'lider'), 'merge', '-q', '--no-edit', `${branch}--${helper.id}`)
    ui.inbox.length = 0
    ui.send({ type: 'git.summary', missionId: mission.id })
    ;({ summary } = await ui.next('git.summary'))
    assert.deepEqual(summary.commits.map((c) => c.subject), ['Cálculo de frete'])
    assert.deepEqual(summary.files.map((f) => [f.path, f.added]), [['app/frete.js', 1]])

    ui.send({ type: 'git.pr.create', missionId: mission.id, title: 'Novo cálculo de frete', body: 'O que mudou', draft: true })
    const pr = await ui.next('git.pr')
    assert.deepEqual([pr.status.number, pr.status.checks.length], [7, 3])
    assert.equal(git(origin, 'branch', '--list', branch).trim(), branch, 'the branch reached origin')
    const create = ran.find((c) => c.includes('gh pr create'))!
    assert.match(create, new RegExp(`--base 'main' --head '${branch}' --title 'Novo cálculo de frete' --body-file '[^']+pr-body.md' --draft$`))
    await ui.next('mission.updated', (m) => m.mission.git?.pr?.number === 7)

    // Reopening a helper keeps its copy and branch.
    ui.send({ type: 'pane.restart', paneId: helper.id, resume: false })
    const { pane: again } = await ui.next('pane.updated', (m) => m.pane.id > helper.id && m.pane.title === 'Frete')
    assert.deepEqual([again.branch, again.cwd], [helper.branch, helper.cwd])

    // Archiving removes clean copies and keeps the one with uncommitted work; branches stay.
    ui.send({ type: 'mission.archive', missionId: mission.id })
    await ui.next('event.added', (m) => m.event.title === 'Cópias mantidas' && m.event.body.includes(`de #${helper.id}`))
    assert.equal(existsSync(join(dataDir, 'worktrees', mission.id, 'lider')), false)
    assert.equal(existsSync(helperTree), true)
    assert.match(git(work, 'branch', '--list', 'orbit/*'), new RegExp(branch.replace('/', '\\/')))

    // Not a repository: the option is refused.
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-plain-')))
    ui.send({ type: 'workspace.open', path: plain })
    const { workspace: other } = await ui.next('workspace.updated', (m) => m.workspace.path === plain)
    ui.send({ type: 'mission.create', workspaceId: other.id, title: 'x', objective: '', mode: 'livre', isolation: 'worktrees', lead: { cli: 'shell', model: null, title: '' } })
    assert.match((await ui.next('error')).message, /não é um repositório git/)
  } finally {
    await mcp?.close()
    ui.ws.close()
    await server.close()
  }
})
