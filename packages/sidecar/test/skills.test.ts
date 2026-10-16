import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCommand, type AgentLaunch } from '../src/command.ts'
import type { Run } from '../src/clis.ts'
import { frontMatter, gateTool, scanCatalog } from '../src/skills.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const HOOK = fileURLToPath(new URL('../hooks/report.mjs', import.meta.url))

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

/** A Claude and a Codex config folder with a bit of everything, and one project folder. */
function fixtures() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-skills-')))
  const claude = join(root, 'claude')
  const codex = join(root, 'codex')
  const project = join(root, 'app')
  write(join(claude, 'skills', 'revisar', 'SKILL.md'), '---\nname: revisar\ndescription: "Revisa um diff: bugs, \\"riscos\\" e testes."\n---\n# corpo')
  write(join(claude, 'skills', 'sem-front', 'SKILL.md'), '# sem front matter')
  write(join(claude, 'agents', 'frontend.md'), '---\nname: frontend-developer\ndescription: >\n  Constrói telas\n  em React.\nmodel: sonnet\n---\nCorpo')
  const plugin = join(root, 'plugin-install')
  write(join(plugin, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Publica.\n---')
  write(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'ops@loja': [{ installPath: plugin }] } }))
  write(join(claude, '.claude.json'), JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://api.github.com/mcp', headers: { Authorization: 'Bearer segredo' } } }, projects: { [project]: { mcpServers: { banco: { command: '/usr/local/bin/pg-mcp', env: { PGPASSWORD: 'segredo' } } } } } }))
  write(join(project, '.claude', 'skills', 'migrar', 'SKILL.md'), '---\nname: migrar\ndescription: Migra o banco.\n---')
  write(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { 'docs.local': { type: 'sse', url: 'http://localhost:9000/sse' } } }))
  write(join(codex, 'skills', 'revisar', 'SKILL.md'), '---\nname: revisar\ndescription: Revisão no Codex.\n---')
  write(join(codex, 'skills', '.system', 'imagegen', 'SKILL.md'), '---\nname: imagegen\ndescription: Gera imagens.\n---')
  write(join(codex, 'config.toml'), 'model = "gpt"\n[mcp_servers.node_repl]\ncommand = "x"\n[mcp_servers.node_repl.env]\nA = "b"\n')
  return { root, claude, codex, project }
}

test('front matter: quoted, folded and missing', () => {
  assert.deepEqual(frontMatter('---\nname: a\ndescription: "x: \\"y\\""\n---'), { name: 'a', description: 'x: "y"' })
  assert.equal(frontMatter('---\ndescription: >\n  uma\n  linha\n---').description, 'uma linha')
  assert.deepEqual(frontMatter('# nada'), {})
})

test('the catalog lists skills, subagents and MCP servers without their secrets', async () => {
  const { claude, codex, project } = fixtures()
  const codexList: Run = async (command) => command === 'codex mcp list --json'
    ? { code: 0, stdout: JSON.stringify([{ name: 'node_repl', enabled: true, transport: { type: 'stdio', command: '/opt/node_repl' } }, { name: 'code-review', enabled: false, transport: { type: 'stdio' } }]), stderr: '' }
    : { code: 127, stdout: '', stderr: '' }
  const items = await scanCatalog({ claudeDir: claude, codexDir: codex, folders: [project], run: codexList })
  const ids = items.map((i) => i.id)
  for (const id of ['claude:skill:revisar', 'claude:skill:sem-front', 'claude:skill:ops:deploy', 'claude:skill:migrar', 'claude:agent:frontend-developer', 'claude:mcp:github', 'claude:mcp:banco', 'claude:mcp:docs.local', 'codex:skill:revisar', 'codex:skill:imagegen', 'codex:mcp:node_repl', 'codex:mcp:code-review']) {
    assert.ok(ids.includes(id), id)
  }
  const get = (id: string) => items.find((i) => i.id === id)!
  assert.equal(get('claude:skill:revisar').description, 'Revisa um diff: bugs, "riscos" e testes.')
  assert.equal(get('claude:agent:frontend-developer').description, 'Constrói telas em React.')
  assert.equal(get('claude:skill:ops:deploy').source, 'plugin ops')
  assert.equal(get('claude:skill:migrar').source, 'projeto app')
  assert.equal(get('claude:mcp:github').description, 'http · api.github.com')
  assert.equal(get('claude:mcp:banco').description, 'stdio · pg-mcp')
  assert.equal(get('codex:skill:imagegen').source, 'sistema')
  assert.equal(get('codex:mcp:code-review').offInCli, true)
  assert.ok(!JSON.stringify(items).includes('segredo'), 'env and headers never leave the config')

  // Without the Codex CLI, config.toml still names its servers.
  const offline = await scanCatalog({ claudeDir: claude, codexDir: codex, folders: [], run: async () => ({ code: 127, stdout: '', stderr: '' }) })
  assert.deepEqual(offline.filter((i) => i.id.startsWith('codex:mcp:')).map((i) => i.name), ['node_repl'])
})

test("Claude's hook refuses what is switched off and what is outside the role's skills", () => {
  const off = new Set(['claude:skill:imagegen', 'claude:agent:frontend-developer', 'claude:mcp:docs.local'])
  const pre = (tool_name: string, tool_input: unknown) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input })
  assert.match(gateTool(pre('Skill', { skill: 'imagegen' }), off, undefined)!, /desligada/)
  assert.equal(gateTool(pre('Skill', { skill: 'revisar' }), off, undefined), null)
  assert.match(gateTool(pre('Skill', { skill: 'deploy' }), off, { only: ['revisar'] })!, /só usa estas skills: revisar/)
  assert.equal(gateTool(pre('Skill', { skill: 'ops:revisar' }), off, { only: ['revisar'] }), null, 'plugin skills match by their own name')
  assert.match(gateTool(pre('Skill', { skill: 'revisar' }), off, { only: [] })!, /não usa skills/)
  assert.match(gateTool(pre('Agent', { subagent_type: 'frontend-developer' }), off, undefined)!, /subagente/)
  assert.match(gateTool(pre('Task', { subagent_type: 'frontend-developer' }), off, undefined)!, /subagente/)
  assert.match(gateTool(pre('mcp__docs_local__search', {}), off, undefined)!, /docs\.local/)
  assert.equal(gateTool(pre('mcp__orbit__agent_list', {}), off, undefined), null, "Orbit's own tools always work")
  assert.equal(gateTool(pre('Bash', { command: 'ls' }), off, undefined), null)
  assert.equal(gateTool({ hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'imagegen' } }, off, undefined), null)
})

test('Codex agents start with switched-off MCP servers disabled', () => {
  const { args } = buildCommand({ cli: 'codex', model: null, disabledMcp: ['node_repl', 'mal; rm -rf ~', 'orbit'] }, '/bin/zsh')
  assert.match(args[2]!, /-c 'mcp_servers\.node_repl\.enabled=false'/)
  assert.doesNotMatch(args[2]!, /rm -rf|mcp_servers\.orbit\.enabled/)
})

test('switching items off reaches running Claude agents through their hook, and new Codex agents', async () => {
  const { root, claude, codex, project } = fixtures()
  process.env.CLAUDE_CONFIG_DIR = claude
  process.env.CODEX_HOME = codex
  const launches: AgentLaunch[] = []
  const fake = (launch: AgentLaunch, shell: string) => {
    launches.push(launch)
    return { file: shell, args: ['-c', `exec ${shell}`] }
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: async () => ({ code: 127, stdout: '', stderr: '' }), agentCommand: fake, browser: null })
  const ui = connect(server.port)
  try {
    await ui.opened
    await ui.next('skills', (m) => m.scannedAt !== null && m.items.some((i) => i.id === 'claude:skill:revisar'))
    ui.send({ type: 'workspace.open', path: project })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'catalog.scan' })
    await ui.next('skills', (m) => m.items.some((i) => i.id === 'claude:skill:migrar'))

    ui.send({ type: 'catalog.toggle', id: 'claude:skill:migrar', enabled: false })
    ui.send({ type: 'catalog.toggle', id: 'codex:mcp:node_repl', enabled: false })
    await ui.next('skills', (m) => m.disabled.includes('claude:skill:migrar') && m.disabled.includes('codex:mcp:node_repl'))

    // A task type limited to one skill.
    const { snapshot } = await ui.next('snapshot')
    const routing = structuredClone(snapshot.routing)
    routing.taskTypes[0] = { ...routing.taskTypes[0]!, skills: ['revisar'], onlySkills: true }
    ui.send({ type: 'routing.save', routing })
    await ui.next('routing.updated', (m) => m.routing.taskTypes[0]!.onlySkills)

    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Skills', objective: '', mode: 'agentica', lead: { cli: 'claude', model: null, title: '' } })
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    assert.match(readFileSync(join(dataDir, 'panes', String(lead.id), 'role.md'), 'utf8'), /Switched off in Orbit \(do not use\): migrar/)
    ui.send({ type: 'pane.spawn', request: { missionId: lead.missionId, role: 'crew', cli: 'claude', model: null, title: 'bug', taskTypeId: routing.taskTypes[0]!.id } })
    const { pane: crew } = await ui.next('pane.updated', (m) => m.pane.title === 'bug')
    assert.match(readFileSync(join(dataDir, 'panes', String(crew.id), 'role.md'), 'utf8'), /use only these skills: revisar/)
    ui.send({ type: 'pane.spawn', request: { missionId: lead.missionId, role: 'crew', cli: 'codex', model: null, title: 'codex', readOnly: true } })
    await ui.next('pane.updated', (m) => m.pane.title === 'codex')
    assert.deepEqual(launches.find((l) => l.cli === 'codex')?.disabledMcp, ['node_repl'])

    // The real hook script, as Claude Code runs it, with each agent's token.
    const tokenOf = async (paneId: number) => {
      ui.send({ type: 'pane.input', paneId, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
      return /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === paneId && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    }
    // Async: the sidecar runs in this process and must keep answering while the hook waits.
    const hook = (token: string, payload: object) => new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, [HOOK], { env: { ...process.env, ORBIT_HOOK_URL: `http://127.0.0.1:${server.port}/hooks`, ORBIT_PANE_TOKEN: token } }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
      child.stdin!.end(JSON.stringify(payload))
    })
    const skill = (name: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: name } })
    const leadToken = await tokenOf(lead.id)
    const crewToken = await tokenOf(crew.id)
    const refused = JSON.parse(await hook(leadToken, skill('migrar')))
    assert.equal(refused.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(refused.hookSpecificOutput.permissionDecisionReason, /desligada no Orbit/)
    assert.equal(await hook(leadToken, skill('revisar')), '', 'allowed: no output, Claude goes on')
    assert.match(JSON.parse(await hook(crewToken, skill('deploy'))).hookSpecificOutput.permissionDecisionReason, /só usa estas skills: revisar/)
    assert.equal(await hook(crewToken, skill('revisar')), '')

    // Switching back on applies right away.
    ui.send({ type: 'catalog.toggle', id: 'claude:skill:migrar', enabled: true })
    await ui.next('skills', (m) => !m.disabled.includes('claude:skill:migrar'))
    assert.equal(await hook(leadToken, skill('migrar')), '')
    ui.send({ type: 'catalog.toggle', id: 'qualquer coisa', enabled: false })
    assert.match((await ui.next('error')).message, /Item desconhecido/)
    void root
  } finally {
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    process.env.CODEX_HOME = HOMES.codex
    ui.ws.close()
    await server.close()
  }
})
