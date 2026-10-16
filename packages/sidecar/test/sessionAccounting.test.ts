import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'

const SESSION = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const report = (input: number, output: number, cost: number) => ({
  context_window: { total_input_tokens: input, total_output_tokens: output, used_percentage: 5 }, orbit_session_usage: { format: 'claude-transcript-v1', input: input, output: output, cacheRead: 0, cacheWrite: 0, total: input + output },
  cost: { total_cost_usd: cost },
})

async function fixture(cli: 'claude' | 'codex' = 'claude') {
  const root = mkdtempSync(join(tmpdir(), 'orbit-session-accounting-'))
  const old = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    GEMINI_CLI_HOME: process.env.GEMINI_CLI_HOME,
  }
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  process.env.CODEX_HOME = join(root, 'codex')
  process.env.GEMINI_CLI_HOME = join(root, 'gemini')
  const create = () => {
    const next = new OrbitCore({
      dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
      broadcast: () => {},
      run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
      agentCommand: (launch) => ({ file: '/bin/sh', args: ['-c', launch.cli === 'codex' ? 'read line; exit 0' : 'while read line; do :; done'] }),
    })
    next.setEndpoint('http://127.0.0.1:1')
    return next
  }
  let core = create()
  core.handle({ type: 'workspace.open', path: root })
  const workspace = core.store.snapshot().workspaces[0]!
  core.handle({ type: 'mission.create', workspaceId: workspace.id, title: 'Accounting',
    objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  const { pane } = await core.spawnHelper(lead, {
    title: 'Synthetic worker', task: 'Read synthetic input', cli, readOnly: true, model: null,
  })
  core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: SESSION })
  const totals = () => ({
    mission: core.store.mission(lead.missionId)!.usage.total,
    cost: core.store.mission(lead.missionId)!.usage.costUsd,
    day: core.store.snapshot().usageDays.reduce((sum, d) => sum + d[cli], 0),
  })
  return {
    get core() { return core }, id: pane.id, root, totals,
    async reload() { await core.shutdown(); core = create() },
    async close() {
      await core.shutdown()
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

test('same-session resume adds only the new cumulative delta', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
    await f.core.handle({ type: 'pane.restart', paneId: f.id, resume: true })
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
    f.core.statusReport(f.id, report(1200, 120, 0.012))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
  } finally { await f.close() }
})

test('persisted baseline survives a core reload and resume', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    await f.reload()
    await f.core.handle({ type: 'pane.restart', paneId: f.id, resume: true })
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
  } finally { await f.close() }
})

test('a fresh conversation counts its new usage', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    await f.core.handle({ type: 'pane.restart', paneId: f.id, resume: false })
    f.core.statusReport(f.id, report(200, 20, 0.002))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
  } finally { await f.close() }
})

test('the final Codex report remains the resume baseline after process exit', async () => {
  const f = await fixture('codex')
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    const rollout = join(f.root, 'synthetic-rollout.jsonl')
    writeFileSync(rollout, JSON.stringify({ payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 1200, output_tokens: 120, total_tokens: 1320 },
    } } }) + '\n')
    // Bind a synthetic rollout; the production exit handler must read its final cumulative report.
    const internal = f.core as unknown as { codexRollouts: Map<number, string> }
    internal.codexRollouts.set(f.id, rollout)
    f.core.handle({ type: 'pane.input', paneId: f.id, data: '\r' })
    for (let n = 0; n < 100 && f.core.store.pane(f.id)?.status !== 'exited'; n++) await new Promise(r => setTimeout(r, 20))
    assert.equal(f.totals().mission, 1320)
    assert.equal(f.core.store.pane(f.id)?.usage?.total, 1320)
    await f.core.handle({ type: 'pane.restart', paneId: f.id, resume: true })
    f.core.statusReport(f.id, report(1200, 120, 0.012))
    assert.equal(f.totals().mission, 1320)
  } finally { await f.close() }
})

test('out-of-order cumulative reports never lower the charged watermark', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    f.core.statusReport(f.id, report(500, 50, 0.005))
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
  } finally { await f.close() }
})

test('the same CLI/account/session is charged once across separate panes', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    const lead = f.core.store.snapshot().panes.find(p => p.role === 'lead')!
    const { pane: second } = await f.core.spawnHelper(lead, { title: 'Same conversation', task: 'A separate synthetic pane', cli: 'claude', model: null })
    f.core.hookReport(second.id, { hook_event_name: 'SessionStart', session_id: SESSION })
    f.core.statusReport(second.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
    f.core.statusReport(second.id, report(1200, 120, 0.012))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
  } finally { await f.close() }
})

test('a different session id in the same process establishes a fresh counter', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    f.core.hookReport(f.id, { hook_event_name: 'SessionStart', session_id: 'aabbccdd-1234-4567-89ab-001122334455' })
    f.core.statusReport(f.id, report(200, 20, 0.002))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
  } finally { await f.close() }
})

test('accounting commits the watermark and all totals before acknowledgement, or rolls them back', async () => {
  const f = await fixture()
  const blocked = join(f.root, 'data/state.json.tmp')
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    const disk = () => JSON.parse(readFileSync(join(f.root, 'data/state.json'), 'utf8'))
    assert.equal(disk().missions[0].usage.total, 1100, 'visible on disk without shutdown or debounce')
    mkdirSync(blocked)
    assert.throws(() => f.core.statusReport(f.id, report(1200, 120, 0.012)), /EISDIR/)
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
    assert.equal(disk().sessionBaselines[0].usage.total, 1100)
    rmSync(blocked, { recursive: true })
    f.core.statusReport(f.id, report(1200, 120, 0.012))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
    assert.equal(disk().usageLog[0].tokens, 1320)
    assert.equal(disk().sessionBaselines[0].source, 'status')
  } finally { rmSync(blocked, { recursive: true, force: true }); await f.close() }
})

test('a report with unknown cost cannot erase a known cost watermark', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    f.core.statusReport(f.id, { context_window: { total_input_tokens: 1200, total_output_tokens: 120 }, orbit_session_usage: { format: 'claude-transcript-v1', input: 1200, output: 120, cacheRead: 0, cacheWrite: 0, total: 1200 + 120 } })
    f.core.statusReport(f.id, report(1200, 120, 0.012))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
  } finally { await f.close() }
})

test('the status payload identifies a session even when SessionStart was not received', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    const lead = f.core.store.snapshot().panes.find(p => p.role === 'lead')!
    const { pane } = await f.core.spawnHelper(lead, { title: 'No start hook', task: 'Read separate synthetic input', cli: 'claude', model: null })
    f.core.statusReport(pane.id, { ...report(1000, 100, 0.01), session_id: SESSION })
    assert.equal(f.core.store.pane(pane.id)?.sessionId, SESSION)
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
  } finally { await f.close() }
})
