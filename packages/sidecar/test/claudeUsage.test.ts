import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseClaudeUsage, parseReset, usageText } from '../src/claudeUsage.ts'

const REAL = `You are currently using your subscription to power your Claude Code usage

Current session: 75% used · resets Oct 14 at 5:39pm (America/Sao_Paulo)
Current week (all models): 73% used · resets Oct 18 at 8:59pm (America/Sao_Paulo)

What's contributing to your limits usage?
Last 24h · 1771 requests · 36 sessions
  98% of your usage came from subagent-heavy sessions`

test("Claude Code's /usage gives a subscription's session and weekly windows, in its own time zone", () => {
  const now = Date.UTC(2026, 9, 14, 15, 0) // 12:00 in São Paulo (UTC-3)
  const usage = parseClaudeUsage(REAL, now)!
  assert.equal(usage.fiveHour!.usedPercent, 75)
  assert.equal(usage.fiveHour!.windowMinutes, 300)
  assert.equal(new Date(usage.fiveHour!.resetsAt).toISOString(), '2026-10-14T20:39:00.000Z')
  assert.equal(usage.weekly!.usedPercent, 73)
  assert.equal(new Date(usage.weekly!.resetsAt).toISOString(), '2026-10-18T23:59:00.000Z')
  // Some lines of "98% of your usage" are not windows.
  assert.equal(parseClaudeUsage('You are using an API key\n98% of your usage came from x', now), null)
})

test('resets read 12am/12pm right and roll into next year when the date already passed', () => {
  const dec = Date.UTC(2026, 11, 31, 12, 0)
  assert.equal(new Date(parseReset('resets Jan 2 at 12am (UTC)', dec)!).toISOString(), '2027-01-02T00:00:00.000Z')
  assert.equal(new Date(parseReset('resets Dec 31 at 12pm (UTC)', dec)!).toISOString(), '2026-12-31T12:00:00.000Z')
  assert.equal(new Date(parseReset('resets Mar 3, 2027 at 9:15am (America/New_York)', dec)!).toISOString(), '2027-03-03T14:15:00.000Z')
  assert.equal(parseReset('resets soon', dec), null)
})

test('the command output is JSON with the text in result', () => {
  assert.equal(usageText(JSON.stringify({ type: 'result', result: 'Current session: 1% used', is_error: false })), 'Current session: 1% used')
  assert.equal(usageText(JSON.stringify({ is_error: true, result: 'falhou' })), null)
  assert.equal(usageText('não é json'), null)
})

test('with no Claude agent open, Orbit still knows each subscription\'s room from /usage', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { startServer } = await import('../src/server.ts')
  const { connect, ORIGIN, TOKEN } = await import('./helpers.ts')
  const asked: string[] = []
  const run = async (command: string) => {
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    if (command.includes('claude -p "/usage"')) {
      asked.push(command)
      return { code: 0, stdout: JSON.stringify({ type: 'result', is_error: false, result: 'Current session: 88% used · resets Oct 14 at 5:39pm (UTC)\nCurrent week (all models): 40% used · resets Oct 18 at 8:59pm (UTC)' }), stderr: '' }
    }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'claude-home-'))
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-data-')), shell: '/bin/sh', run, agentCommand: (_l, sh) => ({ file: sh, args: [] }), browser: null, scheduler: false })
  const ui = connect(server.port)
  try {
    await ui.opened
    for (let i = 0; i < 150 && !server.core.store.limits().some((l) => l.accountId === 'claude'); i++) await new Promise((r) => setTimeout(r, 20))
    const claude = server.core.store.limits().find((l) => l.accountId === 'claude')!
    assert.equal(claude.fiveHour?.usedPercent, 88)
    assert.deepEqual([claude.cli, claude.weekly?.usedPercent], ['claude', 40])
    // No hooks, MCP servers or saved session for this probe; it never reaches a model.
    assert.match(asked[0]!, /claude -p "\/usage" --settings '\{"disableAllHooks":true\}' --strict-mcp-config --no-session-persistence/)
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.CODEX_HOME
    ui.ws.close()
    await server.close()
  }
})
