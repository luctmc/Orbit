import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCodexRollout, fromClaudeStatus, fromCodexRollout, usageDelta } from '../src/usage.ts'
import { startServer } from '../src/server.ts'
import type { AgentLaunch } from '../src/command.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

// Shapes captured from Claude Code 2.1 and Codex 0.160 (values made up).
const CLAUDE_STATUS = {
  model: { id: 'claude-haiku-5-5', display_name: 'Haiku 5.5' },
  effort: { level: 'medium' },
  cost: { total_cost_usd: 0.0051 },
  context_window: { total_input_tokens: 41242, total_output_tokens: 4, context_window_size: 1000000, current_usage: { input_tokens: 2, output_tokens: 4, cache_creation_input_tokens: 41240, cache_read_input_tokens: 0 }, used_percentage: 4 },
  rate_limits: { five_hour: { used_percentage: 51, resets_at: 1791947400 }, seven_day: { used_percentage: 27, resets_at: 1792368000 } },
}

const codexLine = (total: number, primary = 1) => JSON.stringify({
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: { input_tokens: total - 100, cached_input_tokens: 80, output_tokens: 90, reasoning_output_tokens: 10, total_tokens: total }, last_token_usage: { input_tokens: 47500 }, model_context_window: 475000 },
    rate_limits: { primary: { used_percent: primary, window_minutes: 300, resets_at: 1791948272 }, secondary: { used_percent: 0, window_minutes: 10080, resets_at: 1792535072 }, plan_type: 'plus' },
  },
})

test("Claude's status line gives session totals, cost, context and the account limits", () => {
  const report = fromClaudeStatus(CLAUDE_STATUS, 1)
  assert.deepEqual(report.usage, { input: 41242, output: 4, cacheRead: 0, cacheWrite: 0, total: 41246, costUsd: 0.0051 })
  assert.equal(report.contextPercent, 4)
  assert.deepEqual(report.limits, { cli: 'claude', fiveHour: { usedPercent: 51, resetsAt: 1791947400000, windowMinutes: 300 }, weekly: { usedPercent: 27, resetsAt: 1792368000000, windowMinutes: 10080 }, plan: null, updatedAt: 1 })
  assert.equal(fromClaudeStatus({ model: {} }).limits, null, 'no limits before the first API call')
})

test("Codex's session file gives the latest totals and limits", () => {
  const text = [JSON.stringify({ type: 'session_meta', payload: {} }), codexLine(1000), 'linha quebrada {', codexLine(5000, 7)].join('\n')
  const report = fromCodexRollout(text, 1)
  assert.equal(report.usage!.total, 5000)
  assert.equal(report.usage!.output, 100, 'reasoning counts as output')
  assert.equal(report.contextPercent, 10)
  assert.equal(report.limits!.fiveHour!.usedPercent, 7)
  assert.equal(report.limits!.plan, 'plus')
  assert.equal(fromCodexRollout('').usage, null)
})

test('usage deltas count only what is new and never go negative', () => {
  const a = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15, costUsd: 0.01 }
  const b = { input: 30, output: 9, cacheRead: 4, cacheWrite: 0, total: 39, costUsd: 0.03 }
  assert.deepEqual(usageDelta(a, b), { input: 20, output: 4, cacheRead: 4, cacheWrite: 0, total: 24, costUsd: 0.02 })
  assert.equal(usageDelta(b, a).total, 0, 'a /clear that resets the session is not negative usage')
  assert.equal(usageDelta(null, b).total, 39)
})

function codexSession(home: string, cwd: string, startedAt: number, lines: string[]): string {
  const d = new Date(startedAt)
  const dir = join(home, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `rollout-${startedAt}.jsonl`)
  writeFileSync(file, [JSON.stringify({ type: 'session_meta', payload: { cwd, timestamp: new Date(startedAt).toISOString() } }), ...lines].join('\n'))
  return file
}

test("a Codex agent's session file is the one started in its folder after it", () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-')))
  const now = Date.now()
  codexSession(home, cwd, now - 60_000, [codexLine(1)]) // older session, same folder
  codexSession(home, '/outra/pasta', now + 500, [codexLine(2)]) // other folder
  const mine = codexSession(home, cwd, now + 1000, [codexLine(3)])
  assert.equal(findCodexRollout(home, cwd, now, new Set()), mine)
  assert.equal(findCodexRollout(home, cwd, now, new Set([mine])), null, 'another agent already owns it')
})

test('agents report usage: missions and days add up, account limits reach the UI', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
  process.env.CODEX_HOME = home
  const fake = (launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `echo FAKE ${launch.cli}; exec ${shell}`] })
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, agentCommand: fake })
  const ui = connect(server.port)
  try {
    await ui.opened
    await ui.next('snapshot')
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-')))
    ui.send({ type: 'workspace.open', path: cwd })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Uso', objective: '', mode: 'livre', lead: { cli: 'claude', model: null, title: '' } })
    const { mission } = await ui.next('mission.updated')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')

    // Claude agents get Orbit's status line, which posts to /status with their own token.
    const settings = JSON.parse(readFileSync(join(dataDir, 'panes', String(lead.id), 'settings.json'), 'utf8'))
    assert.match(settings.statusLine.command, /statusline\.mjs'$/)
    ui.send({ type: 'pane.input', paneId: lead.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === lead.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    const post = (body: object) => fetch(`http://127.0.0.1:${server.port}/status`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await post(CLAUDE_STATUS)).status, 204)
    await ui.next('pane.updated', (m) => m.pane.id === lead.id && m.pane.usage?.total === 41246 && m.pane.contextPercent === 4)
    await ui.next('mission.updated', (m) => m.mission.id === mission.id && m.mission.usage.total === 41246)
    await ui.next('usage.day', (m) => m.day.claude === 41246)
    await ui.next('limits', (m) => m.limits.some((l) => l.cli === 'claude' && l.fiveHour?.usedPercent === 51))
    // A later report counts only the difference.
    await post({ ...CLAUDE_STATUS, context_window: { ...CLAUDE_STATUS.context_window, total_input_tokens: 50000 } })
    await ui.next('mission.updated', (m) => m.mission.usage.total === 50004)

    // Codex agents are read from their session file.
    ui.send({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'codex', model: null, title: 'codex' } })
    const { pane: codex } = await ui.next('pane.updated', (m) => m.pane.cli === 'codex')
    codexSession(home, cwd, Date.now(), [codexLine(7000, 3)])
    await ui.next('pane.updated', (m) => m.pane.id === codex.id && m.pane.usage?.total === 7000, 9000)
    await ui.next('usage.day', (m) => m.day.codex === 7000)
    await ui.next('limits', (m) => m.limits.some((l) => l.cli === 'codex' && l.fiveHour?.usedPercent === 3 && l.plan === 'plus'))
    await ui.next('mission.updated', (m) => m.mission.usage.total === 57004)
  } finally {
    delete process.env.CODEX_HOME
    ui.ws.close()
    await server.close()
  }
})
