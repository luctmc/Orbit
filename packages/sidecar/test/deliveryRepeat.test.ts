import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { handleMcp } from '../src/mcp.ts'
import { fixture } from './r2Fixture.ts'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
test('F7a accepted without ACK never wakes alone; repeats once alongside a new delivery', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'First result', evidence: 'exit 0' })
    await delay(8000)
    const first = f.core.store.notifications(f.lead.missionId)[0]!
    assert.equal(first.state, 'pty_accepted')
    const panes = (f.core as any).panes
    const submit = panes.submitWithReceipt.bind(panes)
    const wakes: string[] = []
    panes.submitWithReceipt = (id: number, text: string, ...args: any[]) => { if (id === f.lead.id) wakes.push(text); return submit(id, text, ...args) }
    for (let n = 0; n < 3; n++) f.core.dispatchDeliveries(f.lead.missionId)
    await delay(200)
    assert.equal(wakes.length, 0)
    assert.match(f.core.missionBriefing(f.lead.missionId), /repeat: true/)
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString()
      await handleMcp(f.core, f.lead, req, res, body ? JSON.parse(body) : undefined)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const client = new Client({ name: 'repeat-test', version: '0' })
    try {
      const address = server.address() as { port: number }
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)))
      const response = await client.callTool({ name: 'handoff_list', arguments: { view: 'summary' } })
      const rows = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)
      assert.equal(rows.find((r: { resultId: string }) => r.resultId === first.resultId).repeat, true)
    } finally { await client.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
    for (let n = 0; n < 2; n++) {
      const { pane } = await f.core.spawnHelper(f.lead, { title: `Next ${n}`, task: `Read synthetic ${n}`, cli: 'claude', model: null })
      f.core.handoff(pane, { summary: `Next result ${n}`, evidence: 'exit 0' })
      await delay(8000)
    }
    assert.equal(wakes.length, 2)
    assert.ok(wakes[0]!.includes(first.id))
    assert.match(wakes[0]!, /repeat: true/)
    assert.ok(!wakes[1]!.includes(first.id))
    assert.equal(f.core.acknowledgeDelivery(f.lead, first.id).state, 'agent_acknowledged')
    assert.equal(f.core.store.activityHistory(f.lead.missionId).results.length, 3)
  } finally { await f.core.shutdown() }
})

test('F7b automatic Stop result is informative; a real blocked result still gates readiness', async () => {
  const f = await fixture()
  try {
    f.core.hookReport(f.pane.id, { hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Informative last words' })
    assert.equal(f.core.store.activityHistory(f.lead.missionId).results[0]!.status, 'auto')
    assert.ok(f.core.missionReady(f.lead, 'No pending verified work', false).readyAt)
    const notice = f.core.store.notifications(f.lead.missionId)[0]!
    assert.match(notice.text, /informativo/i)
    f.core.handoff(f.core.store.pane(f.pane.id)!, { status: 'blocked', summary: 'Need a decision' })
    assert.equal(f.core.mission(f.lead.missionId)!.readyAt, null)
    assert.throws(() => f.core.missionReady(f.lead, 'Still blocked', false), /falta retorno/)
  } finally { await f.core.shutdown() }
})

test('F7a replacement lead can acknowledge an accepted receipt from its briefing without a new wake', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'First result', evidence: 'exit 0' })
    await delay(8000)
    const notice = f.core.store.notifications(f.lead.missionId)[0]!
    const lead = await f.core.changeLead(f.lead.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
    assert.match(f.core.missionBriefing(lead.missionId), /repeat: true/)
    assert.equal(f.core.acknowledgeDelivery(lead, notice.id).state, 'agent_acknowledged')
    assert.equal(f.core.store.notifications(lead.missionId)[0]!.deliveries.length, 1)
  } finally { await f.core.shutdown() }
})
