import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { handleMcp } from '../src/mcp.ts'
import { fixture } from './r2Fixture.ts'
import { noticeText } from '../src/deliveryQueue.ts'
import { buildCommand } from '../src/command.ts'
import { HarnessMeasurements } from '../src/measurements.ts'

test('F11 4 KB result has a bounded wake, exact private copy, full MCP list and idempotent resend', async () => {
  const f = await fixture()
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    await handleMcp(f.core, f.lead, req, res, body ? JSON.parse(body) : undefined)
  })
  const client = new Client({ name: 'handoff-file', version: '0' })
  try {
    const measurements = new HarnessMeasurements()
    ;(f.core as any).measurements = measurements
    measurements.start(f.pane, 0, 0, 0)
    const summary = 'Resumo completo. '.repeat(100)
    const evidence = 'Verificação exit 0. '.repeat(100)
    const details = 'd'.repeat(4096 - Buffer.byteLength(summary + evidence))
    assert.equal(Buffer.byteLength(summary + evidence + details), 4096)
    const input = { summary, evidence, details }
    const manager = (f.core as any).panes
    const submit = manager.submitWithReceipt.bind(manager)
    const wakes: string[] = []
    manager.submitWithReceipt = (id: number, text: string, ...args: any[]) => {
      if (id === f.lead.id) wakes.push(text)
      return submit(id, text, ...args)
    }
    const result = f.core.handoff(f.pane, input)
    const notice = f.core.store.notifications(f.lead.missionId)[0]!
    const wake = noticeText(notice)
    assert.ok(wake.split('\n').length <= 10)
    assert.match(wake, /STATUS: done/); assert.match(wake, /SUMMARY:/)
    const path = join(f.root, 'data', 'handoffs', f.lead.missionId, `${result.resultId}.md`)
    assert.ok(wake.includes(path)); assert.ok(!wake.includes(summary.trim()))
    const file = readFileSync(path, 'utf8')
    for (const value of ['STATUS: done', summary.trim(), evidence.trim(), details]) assert.ok(file.includes(value), value.slice(0, 30))
    assert.equal(statSync(path).mode & 0o777, 0o600)
    const modified = statSync(path).mtimeMs
    assert.equal(f.core.handoff(f.pane, input).resultId, result.resultId)
    assert.equal(statSync(path).mtimeMs, modified)
    assert.equal(readdirSync(join(f.root, 'data', 'handoffs', f.lead.missionId)).length, 1)
    assert.equal(f.core.store.notifications(f.lead.missionId).length, 1)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as any).port}/mcp`)))
    const list = await client.callTool({ name: 'handoff_list', arguments: { resultId: result.resultId } })
    const text = JSON.parse((list.content as any)[0].text)[0].text
    for (const value of [summary.trim(), evidence.trim(), details]) assert.ok(text.includes(value))
    for (let n = 0; n < 160 && !wakes.length; n++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(wakes, [wake], 'actual queued wake preserves the short pointer and independent receipt')
    const metric = measurements.snapshot()[0]!
    assert.ok(metric.handoffWakeBytesBeforePointer > metric.handoffWakeBytes)
    console.log('B6 M0', JSON.stringify({ payloadBytes: 4096, before: metric.handoffWakeBytesBeforePointer, after: metric.handoffWakeBytes, beforeWithReceipt: metric.handoffWakeBytesBeforePointer + Buffer.byteLength(wake) - metric.handoffWakeBytes, wakeBytesWithReceipt: Buffer.byteLength(wake), lines: wake.split('\n').length }))
  } finally { await client.close(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); await f.core.shutdown() }
})

test('F11 short result stays inline with normalized default STATUS', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'Concluído', evidence: 'npm test exit 0' })
    const text = f.core.store.notifications(f.lead.missionId)[0]!.text
    assert.match(text, /Concluído/); assert.match(text, /npm test exit 0/)
    assert.match(text, /STATUS: done/); assert.match(text, /SUMMARY: Concluído/)
    assert.doesNotMatch(text, /\/handoffs\//)
  } finally { await f.core.shutdown() }
})

for (const status of ['progress', 'blocked', 'auto'] as const) test(`F11 ${status} has explicit STATUS and complete file`, async () => {
  const f = await fixture()
  try {
    if (status === 'auto') f.core.hookReport(f.pane.id, { hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Mensagem automática. '.repeat(90) })
    else f.core.handoff(f.pane, { status, summary: 'Checkpoint', details: 'd'.repeat(4096), ...(status === 'progress' ? { to: f.lead.id } : {}) })
    const result = f.core.store.activityHistory(f.lead.missionId).results.at(-1)!
    assert.equal(result.status, status)
    const path = join(f.root, 'data', 'handoffs', f.lead.missionId, `${result.id}.md`)
    assert.match(readFileSync(path, 'utf8'), new RegExp(`STATUS: ${status}`))
    for (const notice of f.core.store.notifications(f.lead.missionId)) assert.match(notice.text, new RegExp(`STATUS: ${status}`))
  } finally { await f.core.shutdown() }
})

test('F11 destination launch grants the handoff directory to Claude and Codex, including replacement lead', async () => {
  const f = await fixture()
  try {
    const launches: any[] = []
    const manager = (f.core as any).panes
    const spawn = manager.spawn.bind(manager)
    manager.spawn = (args: any) => { launches.push(args.launch); return spawn(args) }
    const replacement = await f.core.changeLead(f.lead.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
    const path = join(f.root, 'data', 'handoffs', f.lead.missionId)
    const launch = launches[0]
    assert.ok(launch.addDirs.includes(path))
    for (const cli of ['claude', 'codex'] as const) assert.ok(buildCommand({ ...launch, cli, toolProfile: 'inherit' }, '/bin/sh').args.join(' ').includes(`--add-dir '${path}'`))
    const other = await f.core.spawnHelper(replacement, { title: 'Recipient', task: 'Read review', cli: 'claude', model: null })
    assert.ok(launches.at(-1).addDirs.includes(path))
    assert.ok(other.pane.id)
  } finally { await f.core.shutdown() }
})

test('F11 criteria remain complete in the file and compact in a directed wake', async () => {
  const f = await fixture()
  try {
    const worker = await f.core.spawnHelper(f.lead, { title: 'Writer', task: 'Read criteria', cli: 'claude', model: null, accept: ['Preservar contrato integral'] })
    const result = f.core.handoff(worker.pane, { summary: 'Verificado', evidence: 'npm test exit 0', details: 'Contexto adicional', to: f.pane.id, criteria: [{ item: 1, met: true, how: 'Contrato conferido' }] })
    const notice = f.core.store.notifications(f.lead.missionId)[0]!
    assert.deepEqual(notice.recipient, { kind: 'pane', paneId: f.pane.id })
    assert.match(notice.text, /critérios: 1\/1/)
    assert.ok(noticeText(notice).split('\n').length <= 10)
    const file = readFileSync(join(f.root, 'data', 'handoffs', f.lead.missionId, `${result.resultId}.md`), 'utf8')
    assert.match(file, /✓ 1. Preservar contrato integral: Contrato conferido/)
    assert.match(file, /Contexto adicional/)
  } finally { await f.core.shutdown() }
})
