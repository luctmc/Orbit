import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Run } from '../src/clis.ts'
import { parseAntigravityModels } from '../src/clis.ts'
import { buildCommand, type AgentLaunch } from '../src/command.ts'
import { writeAgentFiles } from '../src/agentFiles.ts'
import { fromGeminiHook, toGeminiHook } from '../src/hooks.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const SESSION = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const ORBIT_CLI = fileURLToPath(new URL('../hooks/orbit-cli.mjs', import.meta.url))

test('Gemini and Antigravity commands: model, folders, first prompt, resume, and the orbit command first on the PATH', () => {
  const gemini = buildCommand({ cli: 'gemini', model: 'pro', addDirs: ['/w/api', '/w/docs'], systemSettingsPath: '/p/gemini-settings.json', rolePromptPath: '/p/role.md', taskPath: '/p/task.md', binDir: '/p/bin' }, '/bin/zsh').args[2]!
  assert.match(gemini, /^PATH='\/p\/bin':"\$PATH" GEMINI_CLI_SYSTEM_SETTINGS_PATH='\/p\/gemini-settings\.json' gemini --sandbox=false --approval-mode yolo -m pro --include-directories '\/w\/api,\/w\/docs' -i "\$\(cat '\/p\/role\.md' '\/p\/task\.md'\)"/)
  const back = buildCommand({ cli: 'gemini', model: null, resume: SESSION, rolePromptPath: '/p/role.md', taskPath: '/p/task.md' }, '/bin/zsh').args[2]!
  assert.match(back, new RegExp(`^gemini --sandbox=false --approval-mode yolo --resume ${SESSION} -i "\\$\\(cat '/p/task\\.md'\\)"`))
  assert.doesNotMatch(back, /role\.md/)

  const agy = buildCommand({ cli: 'antigravity', model: 'gemini-3.1-pro', effort: 'high', addDirs: ['/w/api'], rolePromptPath: '/p/role.md', taskPath: '/p/task.md' }, '/bin/zsh').args[2]!
  assert.match(agy, /^agy --sandbox=false --dangerously-skip-permissions --model gemini-3\.1-pro --effort high --add-dir '\/w\/api' --prompt-interactive "\$\(cat '\/p\/role\.md' '\/p\/task\.md'\)"/)
  assert.match(buildCommand({ cli: 'antigravity', model: null, resume: SESSION }, '/bin/zsh').args[2]!, new RegExp(`^agy --sandbox=false --dangerously-skip-permissions --conversation ${SESSION}`))

  assert.deepEqual(buildCommand({ cli: 'gemini', model: null, login: true }, '/bin/zsh').args, ['-l', '-c', 'gemini'])
  assert.deepEqual(buildCommand({ cli: 'antigravity', model: null, login: true }, '/bin/zsh').args, ['-l', '-c', 'agy'])
  assert.throws(() => buildCommand({ cli: 'gemini', model: null, resume: 'x; rm -rf ~' }, '/bin/zsh'), /Conversa inválida/)
})

test('a Gemini agent gets Orbit as a trusted MCP server and hooks in its own settings file; every agent gets the orbit command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-pane-'))
  const launch = writeAgentFiles({ paneDir: dir, cli: 'gemini', model: null, effort: null, endpoint: 'http://127.0.0.1:9', token: 'tok', hookCommand: 'node hook.mjs', rolePrompt: 'papel', task: 'tarefa', orbitCommand: "'node' '/x/orbit-cli.mjs'" })
  const settings = JSON.parse(readFileSync(launch.systemSettingsPath!, 'utf8'))
  assert.deepEqual(settings.mcpServers.orbit, { httpUrl: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer tok' }, trust: true })
  assert.deepEqual(Object.keys(settings.hooks), ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'Notification', 'AfterAgent'])
  assert.deepEqual(settings.hooks.BeforeTool, [{ matcher: '*', hooks: [{ type: 'command', command: 'node hook.mjs', timeout: 5000 }] }])
  assert.equal(statSync(launch.systemSettingsPath!).mode & 0o777, 0o600)
  assert.equal(readFileSync(join(launch.binDir!, 'orbit'), 'utf8'), `#!/bin/sh\nexec 'node' '/x/orbit-cli.mjs' "$@"\n`)

  const agy = writeAgentFiles({ paneDir: mkdtempSync(join(tmpdir(), 'orbit-pane-')), cli: 'antigravity', model: null, effort: null, endpoint: 'http://127.0.0.1:9', token: 'tok', hookCommand: 'h', rolePrompt: 'papel', task: null, orbitCommand: 'o' })
  assert.deepEqual([agy.mcpUrl, agy.mcpConfigPath, agy.systemSettingsPath, Boolean(agy.binDir)], [undefined, undefined, undefined, true])
})

test("Gemini's hooks are read as Claude Code's and answered in Gemini's terms", () => {
  assert.deepEqual(fromGeminiHook({ hook_event_name: 'AfterAgent', prompt_response: 'Pronto', stop_hook_active: false }), { hook_event_name: 'Stop', prompt_response: 'Pronto', last_assistant_message: 'Pronto', stop_hook_active: false })
  assert.equal(fromGeminiHook({ hook_event_name: 'BeforeTool', tool_name: 'write_file' }).hook_event_name, 'PreToolUse')
  assert.equal(fromGeminiHook({ hook_event_name: 'BeforeModel' }).hook_event_name, 'gemini:BeforeModel')
  assert.deepEqual(toGeminiHook({ decision: 'block', reason: 'entregue' }), { decision: 'deny', reason: 'entregue' })
  assert.deepEqual(toGeminiHook({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'só leitura' } }), { decision: 'deny', reason: 'só leitura' })
  assert.deepEqual(toGeminiHook({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'maestro' } }), { hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: 'maestro' } })
  assert.equal(toGeminiHook(null), null)
})

test('Antigravity models come from `agy models`, whatever the decoration', () => {
  const catalog = parseAntigravityModels('Fetching available models...\nAvailable models:\n  * gemini-3.1-pro   Gemini 3.1 Pro\n  - claude-sonnet-5-5 | Claude Sonnet 5.5\n  gpt-oss-120b\n')
  assert.deepEqual(catalog.models.map((m) => [m.id, m.label]), [['gemini-3.1-pro', 'Gemini 3.1 Pro'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['gpt-oss-120b', 'gpt-oss-120b']])
  assert.deepEqual(catalog.models[0]!.efforts, [], 'text model list does not establish effort support')
  assert.throws(() => parseAntigravityModels('Error: Please sign in to view available models.'))
})

test('Gemini agents run with a known conversation and Orbit rules through their hooks; the orbit command works as the agent', async () => {
  const run: Run = async (command) => {
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    if (command === 'agy models') return { code: 1, stdout: '', stderr: 'Error: Please sign in to view available models.' }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const launches: AgentLaunch[] = []
  const fake = (launch: AgentLaunch, shell: string) => {
    launches.push(launch)
    return { file: shell, args: ['-c', `exec ${shell}`] }
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const geminiHome = mkdtempSync(join(tmpdir(), 'gemini-home-'))
  process.env.GEMINI_CLI_HOME = geminiHome
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'claude-home-'))
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  try {
    await ui.opened
    // Not signed in anywhere yet: both say so instead of failing later.
    await ui.next('account.status', (m) => m.statuses.some((s) => s.accountId === 'gemini' && s.loggedIn === false) && m.statuses.some((s) => s.accountId === 'antigravity' && s.loggedIn === false))

    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Gemini', objective: '', mode: 'agentica', allowedClis: ['claude', 'gemini'], lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    assert.deepEqual(mission.allowedClis, ['claude', 'gemini'])
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')

    // A disconnected explicit account is refused without replacement; then provide synthetic login.
    const beforeGemini = launches.length
    ui.send({ type: 'pane.spawn', requestId: 'disconnected-gemini', request: { missionId: mission.id, role: 'crew', cli: 'gemini', model: 'flash', title: 'Unavailable', accountId: 'gemini' } })
    assert.match((await ui.next('pane.spawn.error', m => m.requestId === 'disconnected-gemini')).message, /não está conectada/)
    assert.equal(launches.length, beforeGemini)
    const status = (server.core as any).accountStatus.get('gemini')
    ;(server.core as any).accountStatus.set('gemini', { ...status, loggedIn: true })
    // A Gemini helper, chosen by hand; its conversation id arrives with its first hook.
    ui.send({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'gemini', model: 'flash', title: 'Gêmeo', task: 'Revise o README', accountId: 'gemini' } })
    const { pane: helper } = await ui.next('pane.updated', (m) => m.pane.cli === 'gemini')
    const launch = launches.at(-1)!
    assert.ok(launch.systemSettingsPath && launch.binDir)

    // Its hooks: read as Claude's, answered in Gemini's terms. Before Orbit knows it, nobody owes anything.
    const settings = JSON.parse(readFileSync(launch.systemSettingsPath!, 'utf8'))
    const token = /Bearer (.+)/.exec(settings.mcpServers.orbit.headers.Authorization)![1]!
    const hook = async (payload: object) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      return res.status === 200 ? res.json() : null
    }
    await hook({ hook_event_name: 'BeforeAgent', prompt: 'oi', session_id: SESSION })
    await ui.next('pane.updated', (m) => m.pane.id === helper.id && m.pane.status === 'running' && m.pane.sessionId === SESSION)

    // The orbit command, as this agent: lists the tools and hands off through them.
    const exec = promisify(execFile)
    const env = { ...process.env, ORBIT_MCP_URL: `http://127.0.0.1:${server.port}/mcp`, ORBIT_PANE_TOKEN: token }
    const tools = (await exec(process.execPath, [ORBIT_CLI], { env })).stdout
    assert.match(tools, /- handoff_submit \(summary: string/)
    assert.match((await exec(process.execPath, [ORBIT_CLI, 'whoami'], { env })).stdout, new RegExp(`"id": ${helper.id}`))
    await assert.rejects(exec(process.execPath, [ORBIT_CLI, 'handoff_submit', '--summary', 'Revisado'], { env }), /evidence/)
    const delivered = await exec(process.execPath, [ORBIT_CLI, 'handoff_submit', JSON.stringify({ summary: 'README revisado', status: 'done', evidence: 'li o README inteiro' })], { env })
    assert.match(delivered.stdout, new RegExp(`enfileirado para #${lead.id}`))
    await assert.rejects(exec(process.execPath, [ORBIT_CLI, 'whoami'], { env: { ...env, ORBIT_PANE_TOKEN: 'falso' } }), /401|negado|Unauthorized/i)

    // AfterAgent with nothing owed lets it stop; status follows.
    assert.equal(await hook({ hook_event_name: 'AfterAgent', prompt_response: 'Feito', stop_hook_active: false }), null)
    await ui.next('pane.updated', (m) => m.pane.id === helper.id && m.pane.status === 'idle')
  } finally {
    process.env.GEMINI_CLI_HOME = HOMES.gemini
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    process.env.CODEX_HOME = HOMES.codex
    ui.ws.close()
    await server.close()
  }
})
