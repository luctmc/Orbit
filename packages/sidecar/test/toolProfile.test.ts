import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildCommand } from '../src/command.ts'
import { Store } from '../src/store.ts'
import { OrbitCore } from '../src/core.ts'
import type { AgentLaunch } from '../src/command.ts'
import './helpers.ts'

test('focused Claude uses only the explicit MCP config and preserves hook settings with default bypass', () => {
  const launch = { cli: 'claude' as const, model: 'claude-haiku-5-5', toolProfile: 'orbit' as const, mcpConfigPath: '/private/pane/mcp.json', settingsPath: '/private/pane/settings.json' }
  const focused = buildCommand(launch, '/bin/sh').args[2]!
  assert.match(focused, /--strict-mcp-config/)
  assert.match(focused, /--dangerously-skip-permissions/)
  assert.match(focused, /--settings '\/private\/pane\/settings.json'/)
  assert.doesNotMatch(focused, /--bare|--safe-mode|--disable-slash/)
  assert.doesNotMatch(buildCommand({ ...launch, toolProfile: 'inherit' }, '/bin/sh').args[2]!, /--strict-mcp-config/)
  assert.throws(() => buildCommand({ cli: 'claude', model: null, toolProfile: 'orbit' }, '/bin/sh'), /MCP|config/i)
})

test('focused Codex keeps native read-only sandbox and the Orbit endpoint through its startup helper', () => {
  const line = buildCommand({ cli: 'codex', model: 'gpt-6-luna', toolProfile: 'orbit', sandbox: 'read-only', mcpUrl: 'http://127.0.0.1:1/mcp', addDirs: ['/not-writable'] }, '/bin/sh').args[2]!
  assert.match(line, /codex-profile\.mjs/)
  assert.match(line, /-s read-only/)
  assert.match(line, /bearer_token_env_var/)
  assert.doesNotMatch(line, /--add-dir|danger-full-access|--disable plugins/)
  const inherited = buildCommand({ cli: 'codex', model: null, toolProfile: 'inherit' }, '/bin/sh').args[2]!
  assert.equal(inherited, 'codex --dangerously-bypass-approvals-and-sandbox')
})

test('tool profile defaults to Orbit, persists inheritance and preserves old-client settings updates', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-profile-store-')), store = new Store(root)
  assert.equal(store.settings().agentToolProfile, 'orbit')
  store.saveSettings({ ...store.settings(), agentToolProfile: 'inherit' })
  store.flush()
  const restored = new Store(root)
  assert.equal(restored.settings().agentToolProfile, 'inherit')
  restored.saveSettings({ resumeOnStart: false, smartClassify: true, agentsInEnglish: false })
  assert.equal(restored.settings().agentToolProfile, 'inherit')
  assert.throws(() => restored.saveSettings({ ...restored.settings(), agentToolProfile: 'unknown' as never }), /perfil/i)
  assert.equal(restored.settings().agentToolProfile, 'inherit')
  const path = join(root, 'state.json'), legacy = JSON.parse(readFileSync(path, 'utf8'))
  delete legacy.settings.agentToolProfile
  writeFileSync(path, JSON.stringify(legacy))
  assert.equal(new Store(root).settings().agentToolProfile, 'orbit')
})

test('Codex preflight refuses ambiguous metadata, preserves caller args/env and replaces its own PID', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-codex-profile-')), marker = join(root, 'started')
  const cli = join(root, 'codex')
  writeFileSync(cli, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nconst a=process.argv.slice(2);\nif(a[0]==='mcp') {\n if(process.env.ORBIT_TEST_BAD_METADATA) {console.log('not json');process.exit(0)}\n const disabled=a.some(v=>v.startsWith('mcp_servers.external-a={enabled=false,command='));
 if(a.some(v=>v.includes('enabled=false'))&&!disabled){process.stderr.write('invalid transport');process.exit(1)}\n console.log(JSON.stringify([{name:'external-a',enabled:!disabled},{name:'orbit',enabled:true}]));\n} else {writeFileSync(process.env.ORBIT_TEST_MARKER,'started');console.log(JSON.stringify({pid:process.pid,args:a,tokenPresent:!!process.env.ORBIT_PANE_TOKEN}));process.exit(23)}\n`, { mode: 0o700 })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  const helper = fileURLToPath(new URL('../hooks/codex-profile.mjs', import.meta.url))
  const args = [helper, '--', '-s', 'read-only', '-m', 'gpt-6-luna', '--', 'Literal $(never-execute)']
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, ORBIT_PANE_TOKEN: 'fixture-secret', ORBIT_TEST_MARKER: marker }
  const failed = spawnSync(process.execPath, args, { env: { ...env, ORBIT_TEST_BAD_METADATA: '1' }, encoding: 'utf8', timeout: 5000 })
  assert.equal(failed.status, 1)
  assert.equal(existsSync(marker), false, 'preflight cannot silently launch with inherited servers')
  assert.doesNotMatch(failed.stderr, /fixture-secret/)
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 23, result.stderr)
  const observed = JSON.parse(result.stdout)
  assert.equal(observed.pid, result.pid, 'execve preserves the process identity used by writer leases')
  assert.equal(observed.tokenPresent, true)
  assert.ok(observed.args.some((v: string)=>v.startsWith('mcp_servers.external-a={enabled=false,command=')))
  assert.deepEqual(observed.args.slice(-6), ['-s', 'read-only', '-m', 'gpt-6-luna', '--', 'Literal $(never-execute)'])
  assert.ok(observed.args.includes('apps'))
  assert.ok(!observed.args.includes('plugins'), 'plugin hooks and instructions are preserved')
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/)
  const bypass = spawnSync(process.execPath, [helper, '--', 'resume', '--dangerously-bypass-approvals-and-sandbox', '--', '12345678-1234-1234-1234-123456789abc'], { env, encoding: 'utf8', timeout: 5000 })
  assert.equal(bypass.status, 23, bypass.stderr)
  assert.deepEqual(JSON.parse(bypass.stdout).args.slice(-4), ['resume', '--dangerously-bypass-approvals-and-sandbox', '--', '12345678-1234-1234-1234-123456789abc'])
})

test('profile changes affect the next native opening, retain sandbox restrictions and leave other adapters inherited', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-profile-core-')), launches: AgentLaunch[] = []
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null, broadcast: () => {}, run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
    agentCommand: launch => { launches.push(structuredClone(launch)); return { file: '/bin/sh', args: ['-c', 'printf "READY\\n"; while read line; do :; done'] } },
  })
  core.setEndpoint('http://127.0.0.1:1')
  try {
    core.handle({ type: 'workspace.open', path: root })
    core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'Profile', objective: '', mode: 'agentica', allowedClis: ['claude', 'codex', 'gemini'], lead: { cli: 'codex', model: 'gpt-6-luna', title: 'Lead' } })
    const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
    assert.equal(lead.toolProfile, 'orbit')
    assert.equal(launches[0]!.sandbox, 'read-only')
    core.store.saveSettings({ ...core.store.settings(), agentToolProfile: 'inherit' })
    assert.equal(core.store.pane(lead.id)!.toolProfile, 'orbit', 'changing defaults cannot rewrite a running execution')
    await core.handle({ type: 'pane.restart', paneId: lead.id, resume: false })
    assert.equal(core.store.pane(lead.id)!.toolProfile, 'inherit')
    assert.equal(launches.at(-1)!.sandbox, 'read-only')
    core.store.saveSettings({ ...core.store.settings(), agentToolProfile: 'orbit' })
    const currentLead = core.store.pane(lead.id)!
    const { pane: worker } = await core.spawnHelper(currentLead, { cli: 'codex', model: 'gpt-6-luna', task: 'Implement', title: 'Worker' })
    assert.equal(worker.toolProfile, 'orbit')
    assert.equal(launches.at(-1)!.sandbox, 'danger-full-access')
    const { pane: other } = await core.spawnHelper(currentLead, { cli: 'gemini', model: null, readOnly: true, task: 'Read', title: 'Other adapter' })
    assert.equal(other.toolProfile, 'inherit')
  } finally { await core.shutdown() }
})
