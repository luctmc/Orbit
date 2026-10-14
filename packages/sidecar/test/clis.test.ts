import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { effortsFor, type CliStatus } from '@orbit/protocol'
import { blankStatus, CLAUDE_CATALOG, installMethod, parseCodexCatalog, parseVersion, updateCommands, type Run, GEMINI_CATALOG, ANTIGRAVITY_FALLBACK } from '../src/clis.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

const CODEX_JSON = JSON.stringify({
  models: [
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Workhorse', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' }, { effort: 'ultra' }] },
    { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }] },
    { slug: 'interno', display_name: 'Interno', visibility: 'hide', supported_reasoning_levels: [{ effort: 'low' }] },
  ],
})

test('versions and install methods are read from what the shell reports', () => {
  assert.equal(parseVersion('2.1.296 (Claude Code)'), '2.1.296')
  assert.equal(parseVersion('codex-cli 0.160.1'), '0.160.1')
  assert.equal(parseVersion('nada'), null)
  assert.equal(installMethod('claude', '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe'), 'npm')
  assert.equal(installMethod('claude', '/Users/x/.local/share/claude/versions/2.1.296'), 'native')
  assert.equal(installMethod('codex', '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js'), 'npm')
  assert.equal(installMethod('codex', '/opt/homebrew/Cellar/codex/0.1/bin/codex'), 'brew')
  assert.equal(installMethod('codex', '/usr/local/bin/codex'), 'unknown')
})

test("Codex's catalog keeps the listed models with their own effort levels", () => {
  const catalog = parseCodexCatalog(CODEX_JSON)
  assert.equal(catalog.source, 'cli')
  assert.deepEqual(catalog.models.map((m) => m.id), ['gpt-6.1-sol', 'gpt-6-luna'], 'hidden models stay out')
  assert.deepEqual(catalog.models[1]!.efforts, ['low', 'medium'])
  assert.equal(catalog.models[0]!.defaultEffort, 'low')
  assert.deepEqual(catalog.efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  const both = { claude: CLAUDE_CATALOG, codex: catalog, gemini: GEMINI_CATALOG, antigravity: ANTIGRAVITY_FALLBACK }
  assert.deepEqual(effortsFor(both, 'codex', 'gpt-6-luna'), ['low', 'medium'])
  assert.deepEqual(effortsFor(both, 'claude', 'opus'), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(effortsFor(both, 'shell', null), [])
})

test('each install method updates its own way', () => {
  const status = (patch: Partial<CliStatus>): CliStatus => ({ ...blankStatus('claude'), installed: true, ...patch })
  assert.deepEqual(updateCommands(status({ method: 'native', path: '/Users/x/.local/share/claude/versions/2.1.296' })), ['claude update'])
  assert.deepEqual(updateCommands(status({ method: 'npm', path: '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe' })), [
    'npm install -g @anthropic-ai/claude-code@latest',
    "node '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/install.cjs'",
  ])
  assert.deepEqual(updateCommands({ ...blankStatus('codex'), installed: true, method: 'npm', path: '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js' }), ['npm install -g @openai/codex@latest'])
  assert.match(String(updateCommands(status({ method: 'brew' }))), /brew upgrade/)
})

test('the UI checks and updates the CLIs, and efforts are held to what each model accepts', async () => {
  const ran: string[] = []
  let claudeVersion = '2.1.296'
  const shell: Run = async (command) => {
    ran.push(command)
    const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })
    if (command === 'command -v claude') return ok('/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe\n')
    if (command === 'command -v codex') return ok('/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js\n')
    if (command === 'claude --version') return ok(`${claudeVersion} (Claude Code)\n`)
    if (command === 'codex --version') return ok('codex-cli 0.160.1\n')
    if (command === 'npm view @anthropic-ai/claude-code version') return ok('2.1.300\n')
    if (command === 'npm view @openai/codex version') return ok('0.161.0\n')
    if (command === 'codex debug models') return ok(CODEX_JSON)
    if (command === 'npm install -g @anthropic-ai/claude-code@latest') { claudeVersion = '2.1.300'; return ok('added 1 package\n') }
    if (command.startsWith('node ') && command.includes('install.cjs')) return ok('')
    return { code: 127, stdout: '', stderr: `inesperado: ${command}` }
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: shell, agentCommand: (_l, sh) => ({ file: sh, args: [] }) })
  const ui = connect(server.port)
  try {
    await ui.opened
    await ui.next('snapshot')
    await ui.next('catalog', (m) => m.catalog.codex.source === 'cli')

    ui.send({ type: 'cli.check' })
    // The light check at startup (no network) comes first; the full one adds the latest versions.
    const { clis } = await ui.next('cli.status', (m) => m.clis.every((c) => c.checkedAt !== null && c.busy === null) && m.clis.some((c) => c.latest !== null))
    const claude = clis.find((c) => c.cli === 'claude')!
    assert.deepEqual([claude.version, claude.latest, claude.method], ['2.1.296', '2.1.300', 'npm'])
    assert.deepEqual([clis[1]!.version, clis[1]!.latest], ['0.160.1', '0.161.0'])

    ui.send({ type: 'cli.update', cli: 'claude' })
    const updated = await ui.next('cli.status', (m) => m.clis.find((c) => c.cli === 'claude')!.version === '2.1.300' && m.clis[0]!.busy === null)
    assert.equal(updated.clis[0]!.ok, true)
    assert.ok(ran.some((c) => c.includes('install.cjs')), "Claude's native binary is restored after npm")

    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'esforço', objective: '', mode: 'livre', lead: { cli: 'codex', model: 'gpt-6-luna', effort: 'ultra', title: '' } })
    assert.match((await ui.next('error')).message, /não vale para gpt-6-luna; use baixo, médio/)
  } finally {
    ui.ws.close()
    await server.close()
  }
})
