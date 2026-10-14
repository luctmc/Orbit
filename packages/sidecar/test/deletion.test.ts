import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Teste', '-c', 'user.email=teste@exemplo.dev', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8' })
const CLAUDE_SESSION = '11111111-2222-4333-8444-555555555555'
const CODEX_SESSION = '0199bbbb-cccc-7ddd-8eee-ffff00001111'

test('deleting an agent, a mission or a workspace leaves nothing behind in Orbit, and only what was chosen outside it', async () => {
  const run: Run = async (command) => {
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const fake = (_launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `exec ${shell}`] })
  const claudeHome = mkdtempSync(join(tmpdir(), 'claude-home-'))
  const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'))
  process.env.CLAUDE_CONFIG_DIR = claudeHome
  process.env.CODEX_HOME = codexHome
  // The CLIs' own conversations, as they keep them.
  const claudeFile = join(claudeHome, 'projects', 'ws', `${CLAUDE_SESSION}.jsonl`)
  mkdirSync(join(claudeHome, 'projects', 'ws', CLAUDE_SESSION), { recursive: true })
  writeFileSync(claudeFile, '{}\n')
  const day = join(codexHome, 'sessions', '2026', '10', '14')
  mkdirSync(day, { recursive: true })
  const codexFile = join(day, `rollout-2026-10-14T10-00-00-${CODEX_SESSION}.jsonl`)
  writeFileSync(codexFile, '{}\n')

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-git-')))
  const work = join(root, 'app')
  git(root, 'init', '-q', work)
  writeFileSync(join(work, 'README.md'), '# app\n')
  git(work, 'add', '.')
  git(work, 'commit', '-q', '-m', 'início')

  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  const store = server.core.store
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 150 && !done(); i++) await new Promise((r) => setTimeout(r, 20))
    assert.ok(done(), 'timed out')
  }
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: work })
    const { workspace } = await ui.next('workspace.updated')

    // A mission with a Claude lead and a Codex helper, both with conversations; a card, memory and usage.
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Apagável', objective: '', mode: 'livre', lead: { cli: 'claude', model: null, title: 'Líder' }, cards: ['Uma tarefa'] })
    const { mission } = await ui.next('mission.updated')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    ui.send({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'codex', model: null, title: 'Ajudante' } })
    const { pane: helper } = await ui.next('pane.updated', (m) => m.pane.cli === 'codex')
    ;(server.core as unknown as { panes: { setSession: (id: number, s: string) => void } }).panes.setSession(lead.id, CLAUDE_SESSION)
    ;(server.core as unknown as { panes: { setSession: (id: number, s: string) => void } }).panes.setSession(helper.id, CODEX_SESSION)
    await ui.next('pane.updated', (m) => m.pane.id === helper.id && m.pane.sessionId === CODEX_SESSION)
    store.addLedger({ day: '2026-10-14', workspaceId: workspace.id, missionId: mission.id, cli: 'codex', model: null, accountId: 'codex', tokens: 900, costUsd: 0 })
    ui.send({ type: 'memory.save', workspaceId: workspace.id, entry: { kind: 'fato', text: 'Escrito por mim' } })
    await ui.next('memory', (m) => m.entries.length === 1)
    store.saveMemory(workspace.id, { id: 'da-missao', kind: 'licao', text: 'Lição da missão', at: Date.now(), source: { missionId: mission.id, missionTitle: 'Apagável', paneId: lead.id }, pinned: false })
    assert.ok(store.snapshot().events.some((e) => e.paneId === helper.id))

    // The helper alone: its pane, its lines in the flow and its Codex conversation.
    ui.send({ type: 'pane.delete', paneId: helper.id, conversation: true })
    await until(() => !store.snapshot().panes.some((p) => p.id === helper.id))
    assert.deepEqual(store.snapshot().events.filter((e) => e.paneId === helper.id).map((e) => e.title), [])
    for (let i = 0; i < 50 && existsSync(codexFile); i++) await new Promise((r) => setTimeout(r, 20))
    assert.equal(existsSync(codexFile), false)
    assert.ok(existsSync(claudeFile), 'the lead\'s conversation is untouched')

    // The mission: everything Orbit kept, the lead's conversation and its memory; the person's entry stays.
    ui.send({ type: 'mission.delete', missionId: mission.id, conversations: true, memory: true, branches: false })
    await until(() => !store.mission(mission.id))
    const after = store.snapshot()
    assert.deepEqual([after.panes.length, after.events.filter((e) => e.missionId === mission.id).length, after.cards.length], [0, 0, 0])
    assert.equal(store.ledger('2026-10').length, 0)
    assert.deepEqual(store.memory(workspace.id).map((e) => e.text), ['Escrito por mim'])
    assert.equal(existsSync(claudeFile), false)
    assert.equal(existsSync(join(claudeHome, 'projects', 'ws', CLAUDE_SESSION)), false)

    // A mission with a branch per agent: its copies go even with uncommitted work; branches only when asked.
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Com branches', objective: '', mode: 'livre', isolation: 'worktrees', lead: { cli: 'shell', model: null, title: '' } })
    const branched = (await ui.next('mission.updated', (m) => m.mission.title === 'Com branches' && m.mission.git !== null)).mission
    await ui.next('pane.updated', (m) => m.pane.missionId === branched.id)
    const copy = branched.git!.leadPath
    writeFileSync(join(copy, 'rascunho.txt'), 'sem commit')
    ui.send({ type: 'mission.delete', missionId: branched.id, conversations: false, memory: false, branches: false })
    await until(() => !store.mission(branched.id))
    assert.equal(existsSync(copy), false)
    assert.match(git(work, 'branch', '--list', branched.git!.branch), new RegExp(branched.git!.branch.replace('/', '\\/')))

    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Sem rastro', objective: '', mode: 'livre', isolation: 'worktrees', lead: { cli: 'shell', model: null, title: '' } })
    const gone = (await ui.next('mission.updated', (m) => m.mission.title === 'Sem rastro' && m.mission.git !== null)).mission
    await ui.next('pane.updated', (m) => m.pane.missionId === gone.id)
    ui.send({ type: 'mission.delete', missionId: gone.id, conversations: false, memory: false, branches: true })
    await until(() => !store.mission(gone.id))
    assert.equal(git(work, 'branch', '--list', gone.git!.branch).trim(), '')

    // The workspace: its missions, memory, templates and schedules; the folder stays.
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Última', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: '' } })
    await ui.next('mission.updated', (m) => m.mission.title === 'Última')
    ui.send({ type: 'workspace.delete', workspaceId: workspace.id, conversations: true, branches: false })
    await until(() => !store.workspace(workspace.id))
    const snapshot = store.snapshot()
    assert.deepEqual([snapshot.missions.length, snapshot.panes.length, snapshot.templates.length, snapshot.schedules.length], [0, 0, 0, 0])
    assert.deepEqual(store.memory(workspace.id), [])
    assert.ok(existsSync(join(work, 'README.md')), 'the project folder is never touched')
  } finally {
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    process.env.CODEX_HOME = HOMES.codex
    ui.ws.close()
    await server.close()
  }
})
