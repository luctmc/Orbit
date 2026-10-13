import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommand, paneEnv, shellQuote } from '../src/command.ts'
import { writeAgentFiles } from '../src/agentFiles.ts'

test('shell panes start a login shell', () => {
  assert.deepEqual(buildCommand({ cli: 'shell', model: null }, '/bin/zsh'), { file: '/bin/zsh', args: ['-l'] })
})

test('agent panes run the CLI with the model, then fall back to a shell', () => {
  assert.deepEqual(buildCommand({ cli: 'claude', model: 'claude-opus-5-5' }, '/bin/zsh'), {
    file: '/bin/zsh',
    args: ['-l', '-c', `claude --model claude-opus-5-5; exec '/bin/zsh' -l`],
  })
  assert.deepEqual(buildCommand({ cli: 'codex', model: null }, '/bin/bash').args, ['-l', '-c', `codex; exec '/bin/bash' -l`])
})

test('model ids that could inject shell syntax are rejected', () => {
  assert.throws(() => buildCommand({ cli: 'claude', model: 'opus; rm -rf ~' }, '/bin/zsh'), /Modelo inválido/)
  assert.throws(() => buildCommand({ cli: 'codex', model: '$(whoami)' }, '/bin/zsh'), /Modelo inválido/)
})

test('shellQuote survives single quotes', () => {
  assert.equal(shellQuote(`/tmp/it's here`), `'/tmp/it'\\''s here'`)
})

test('claude agents get MCP, hooks, role and task from private files', () => {
  const paneDir = join(mkdtempSync(join(tmpdir(), 'orbit-files-')), 'panes', '7')
  const launch = writeAgentFiles({
    paneDir, cli: 'claude', model: null, effort: 'high', endpoint: 'http://127.0.0.1:4317', token: 'tok',
    hookCommand: `'/usr/bin/node' '/x/report.mjs'`, rolePrompt: 'papel', task: `faça "isso" e $(nada)`,
  })
  const mcp = JSON.parse(readFileSync(launch.mcpConfigPath!, 'utf8'))
  assert.equal(mcp.mcpServers.orbit.url, 'http://127.0.0.1:4317/mcp')
  assert.equal(mcp.mcpServers.orbit.headers.Authorization, 'Bearer tok')
  assert.equal(statSync(launch.mcpConfigPath!).mode & 0o777, 0o600)
  const settings = JSON.parse(readFileSync(launch.settingsPath!, 'utf8'))
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['Notification', 'PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'])
  assert.deepEqual(settings.permissions.allow, ['mcp__orbit'], "Orbit's own tools never stop the agent for permission")
  assert.equal(readFileSync(launch.taskPath!, 'utf8'), `faça "isso" e $(nada)`)

  const { args } = buildCommand(launch, '/bin/zsh')
  const line = args[2]!
  assert.ok(!line.includes('$(nada)'), 'task text must never reach the command line')
  assert.match(line, /--effort high/)
  assert.match(line, /--append-system-prompt "\$\(cat '.+role\.md'\)"/)
  assert.match(line, /-- "\$\(cat '.+task\.md'\)"/)
})

test('codex agents reach the MCP through a token env var', () => {
  const paneDir = join(mkdtempSync(join(tmpdir(), 'orbit-files-')), 'panes', '8')
  const launch = writeAgentFiles({ paneDir, cli: 'codex', model: 'gpt-6.1', effort: 'low', endpoint: 'http://127.0.0.1:4317', token: 'segredo-do-pane', hookCommand: 'x', rolePrompt: null, task: 'tarefa' })
  const line = buildCommand(launch, '/bin/zsh').args[2]!
  assert.match(line, /-c 'mcp_servers\.orbit\.url="http:\/\/127\.0\.0\.1:4317\/mcp"'/)
  assert.match(line, /bearer_token_env_var="ORBIT_PANE_TOKEN"/)
  assert.match(line, /-c 'model_reasoning_effort="low"'/)
  assert.match(line, /-c 'mcp_servers\.orbit\.default_tools_approval_mode="approve"'/)
  assert.ok(!line.includes('segredo-do-pane'), 'the token travels by env, never on the command line')
})

test('pane env drops Orbit secrets and adds pane identity', () => {
  const env = paneEnv({ PATH: '/usr/bin', ORBIT_TOKEN: 'secret', VITE_ORBIT_TOKEN: 'secret' }, { ORBIT_PANE_ID: '7' })
  assert.equal(env.ORBIT_TOKEN, undefined)
  assert.equal(env.VITE_ORBIT_TOKEN, undefined)
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.ORBIT_PANE_ID, '7')
  assert.equal(env.TERM, 'xterm-256color')
})
