import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ActivityRecord, ActivityResult, DecisionReceipt } from '@orbit/protocol'
import { createAttempt, emptyActivityLedger } from '../src/activityLedger.ts'
import { handleMcp } from '../src/mcp.ts'
import { fixture } from './r2Fixture.ts'

async function lines() {
  const module = await import('../src/missionLedger.ts').catch(() => null)
  assert.equal(typeof module?.delegationLines, 'function', 'F16 precisa da projeção pura delegationLines')
  return module!.delegationLines
}

function history() {
  const h = emptyActivityLedger()
  const activity: ActivityRecord = { id: 'a', missionId: 'm', key: 'a', title: 'Work', revision: 1, contractHash: 'hash', acceptance: [], state: 'reserved', activeAttemptId: '', deliveryId: 'd', createdAt: 1, updatedAt: 1 }
  h.activities.push(activity)
  const attempt = createAttempt(h, activity, 2, null, 1)
  const decision: DecisionReceipt = { version: 1, policyRevision: 'p', catalogRevision: null, source: 'explicit', requested: { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }, effective: { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium', accountId: null }, reasons: ['brief: abc123 · nota 9/10'], capabilityLimits: [], at: 1 }
  attempt.decision = decision
  return { h, activity, attempt }
}

function delivered(h: Omit<ReturnType<typeof history>['h'], 'version'>, attemptId: string, evidence = 'npm test\nexit 0'): ActivityResult {
  const result: ActivityResult = { id: `r-${h.results.length}`, activityId: 'a', attemptId, activityRevision: 1, digest: 'digest', status: 'done', state: 'submitted', summary: 'Done', evidence, details: '', deliveredTo: 1, createdAt: h.results.length + 1 }
  h.results.push(result)
  return result
}

test('F16 one fixed line per activity uses current attempt, receipt and first current evidence without mutation', async () => {
  const project = await lines()
  const { h, activity } = history()
  delivered(h, activity.activeAttemptId, 'obsolete')
  createAttempt(h, activity, 3, 'Retry', 2)
  const current = createAttempt(h, activity, 4, 'Retry again', 3)
  current.decision = structuredClone(h.attempts[0]!.decision)
  current.decision!.effective.model = 'gpt-6-astra'
  delivered(h, current.id)
  delivered(h, current.id, 'later evidence')
  activity.state = 'awaiting_validation'
  const before = JSON.stringify(h)
  assert.deepEqual(project(h), ['#4 | - | gpt-6-astra/medium | brief 9/10 | entregue | npm test exit 0'])
  assert.equal(JSON.stringify(h), before)
})

test('F16 Portuguese statuses preserve review verdicts, exhausted rescues and replaced work', async () => {
  const project = await lines()
  const { h, activity, attempt } = history()
  assert.match(project(h)[0]!, /aguardando/)
  activity.state = 'running'
  assert.match(project(h)[0]!, /em andamento/)
  const result = delivered(h, attempt.id)
  activity.state = 'awaiting_validation'
  for (const [verdict, label] of [['accepted', 'aceito'], ['changes_required', 'ajustes solicitados'], ['unverified', 'não verificado']] as const) {
    assert.ok(project({ ...h, verifications: [{ resultId: result.id, scope: 'result', verdict, checks: [] }] })[0]!.includes(`| ${label} |`))
  }
  result.state = 'unverified'
  assert.match(project(h)[0]!, /não verificado/)
  activity.state = 'blocked'
  assert.match(project(h)[0]!, /bloqueado/)
  assert.match(project({ ...h, deliveries: [{ id: 'd', status: 'superseded' }] })[0]!, /substituído/)
  for (let i = 0; i < 2; i++) createAttempt(h, activity, 5 + i, 'Retry', 4 + i)
  for (const a of h.attempts) { a.error = 'Launch failed'; a.state = 'stopped' }
  activity.state = 'stopped'
  assert.match(project(h)[0]!, /resgate esgotado/)
})

test('F16 ignores integration verdicts and earlier attempts, and uses first verification when evidence is empty', async () => {
  const project = await lines()
  const { h, activity, attempt } = history()
  const old = delivered(h, attempt.id)
  const current = createAttempt(h, activity, 3, 'Retry', 3)
  const result = delivered(h, current.id, '')
  activity.state = 'awaiting_validation'
  const verifications = [
    { resultId: old.id, scope: 'result' as const, verdict: 'changes_required' as const, checks: [] },
    { resultId: result.id, scope: 'integration' as const, verdict: 'accepted' as const, checks: [] },
    { resultId: result.id, scope: 'result' as const, verdict: 'unverified' as const, checks: [{ command: 'npm test', exitCode: 1, summary: 'No proof\nyet' }] },
  ]
  assert.equal(project({ ...h, verifications })[0], '#3 | - | -/- | brief - | não verificado | npm test: exit 1; No proof yet')
})

test('F16 bounds fields, evidence and history to 30 most recent activities plus count', async () => {
  const project = await lines()
  const { h, activity, attempt } = history()
  attempt.decision!.effective.model = 'm'.repeat(1000)
  delivered(h, attempt.id, 'e'.repeat(120) + '\nignored')
  for (let i = 1; i <= 32; i++) {
    const next = { ...activity, id: `a${i}`, createdAt: i + 1 }
    h.activities.push(next)
    createAttempt(h, next, i + 2, null, i + 1)
  }
  const output = project(h)
  assert.equal(output.length, 31)
  assert.equal(output.at(-1), '+3 anteriores')
  assert.match(output[0]!, /^#5 \|/)
  assert.match(output.at(-2)!, /^#34 \|/)
  assert.ok(output.slice(0, -1).every(line => line.length <= 220 && !/[\r\n]/.test(line)))
  const single = project({ ...h, activities: [activity] })[0]!
  assert.equal(single.split(' | ').length, 6)
  assert.equal(single.split(' | ').at(-1), 'e'.repeat(79) + '…')
  assert.deepEqual(project(emptyActivityLedger()), [])
})

test('F16 real core keeps compact delegations across lead change and omits empty section', async () => {
  const f = await fixture()
  try {
    const before = f.core.missionBriefing(f.lead.missionId)
    assert.match(before, /## Delegations\n\n#\d+ \|/)
    assert.ok(Buffer.byteLength(before) <= 18_000)
    const project = await lines()
    const history = f.core.store.activityHistory(f.lead.missionId)
    const current = history.attempts[0]!
    current.pane!.taskType = 'Correção'
    current.decision!.effective.model = 'gpt-6.1-sol'
    current.decision!.effective.effort = 'medium'
    assert.ok(project(history)[0]!.includes('| Correção | gpt-6.1-sol/medium |'))
    current.paneId = Number.MAX_SAFE_INTEGER
    current.pane!.taskType = 't'.repeat(1000)
    current.decision!.effective.model = 'm'.repeat(1000)
    current.decision!.effective.effort = 'xhigh'
    delivered(history, current.id, 'e'.repeat(1000)).activityId = history.activities[0]!.id
    assert.ok(project(history)[0]!.length <= 220, 'all fields remain present within 220 characters')
    const ledger = before.split('## Delegations\n\n')[1]!.split('\n\n')[0]
    await f.core.changeLead(f.lead.missionId, { kind: 'new', cli: 'codex', model: null, effort: null, accountId: null })
    assert.ok(f.core.missionBriefing(f.lead.missionId).includes(`## Delegations\n\n${ledger}`))
    f.core.handle({ type: 'mission.create', workspaceId: f.core.store.snapshot().workspaces[0]!.id, title: 'Empty', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const empty = f.core.store.snapshot().missions.find(m => m.title === 'Empty')!
    assert.doesNotMatch(f.core.missionBriefing(empty.id), /## Delegations/)
  } finally { await f.core.shutdown() }
})

test('F16 mission_status returns derived ledger; F18 tool defines NOT_PROVEN', async () => {
  const f = await fixture()
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    await handleMcp(f.core, f.lead, req, res, body ? JSON.parse(body) : undefined)
  })
  const client = new Client({ name: 'mission-ledger', version: '0' })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`)))
    const tools = await client.listTools()
    const description = tools.tools.find(t => t.name === 'verification_submit')!.description!
    assert.match(description, /unverified = NOT_PROVEN/)
    assert.match(description, /nunca accepted/)
    assert.match(description, /não é changes_required/)
    const response = await client.callTool({ name: 'mission_status', arguments: {} })
    const status = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)
    assert.ok(Array.isArray(status.ledger))
    assert.match(status.ledger[0], new RegExp(`^#${f.pane.id} \\|`))
    assert.match(status.ledger[0], /brief -/)
  } finally { await client.close(); await new Promise<void>(resolve => server.close(() => resolve())); await f.core.shutdown() }
})

test('F16 oversized delegation section becomes a retrievable reference within existing briefing budget', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 31; i++) {
      const ticket = f.core.store.reserveActivity({ missionId: f.lead.missionId, key: `archive-${i}`, title: 'Archived', contractHash: 'hash', acceptance: [], retryReason: null, assignedBy: f.lead.id, requiresDelivery: false })
      const pane = { ...f.pane, id: ticket.attempt.paneId, activityAttemptId: ticket.attempt.id, taskType: 't'.repeat(40), model: 'm'.repeat(40) }
      f.core.store.commitActivityResult(pane, { status: 'done', summary: 'Archived', evidence: 'e'.repeat(100), details: '', deliveredTo: null }, { title: 'Archived', body: '' })
    }
    const briefing = f.core.missionBriefing(f.lead.missionId)
    assert.ok(Buffer.byteLength(briefing) <= 18_000)
    assert.match(briefing, /## Objective/)
    assert.match(briefing, /## How to carry on/)
    assert.doesNotMatch(briefing, /## Delegations/)
    const hashes = [...briefing.matchAll(/"sha256":"([a-f0-9]{64})"/g)].map(m => m[1]!)
    const sections = hashes.map(sha => f.core.readContext(f.lead, sha, 0, 16_000).text)
    const section = sections.find(text => text.startsWith('## Delegations'))
    assert.ok(section, 'optional delegations remain retrievable')
    assert.ok(Buffer.byteLength(section) > 3000)
    assert.match(section, /\+2 anteriores$/)
    assert.equal(section.split('\n').length, 33)
  } finally { await f.core.shutdown() }
})
