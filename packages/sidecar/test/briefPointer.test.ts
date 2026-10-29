import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { fixture } from './r2Fixture.ts'
import { buildCommand } from '../src/command.ts'
import { HarnessMeasurements } from '../src/measurements.ts'

test('F10 long tasks persist exact private content and launch a short pointer with acceptance and attempt', async () => {
  const { core, lead, root } = await fixture()
  const measurements = new HarnessMeasurements()
  ;(core as any).measurements = measurements
  const launches: any[] = []
  const manager = (core as any).panes
  const spawn = manager.spawn.bind(manager)
  manager.spawn = (args: any) => { launches.push(args.launch); return spawn(args) }
  try {
    const task = 'Contexto completo.\n'.repeat(300).slice(0, 5000)
    const { pane, receipt } = await core.spawnHelper(lead, { title: 'Long', task, cli: 'claude', model: null, accept: ['Comprovar resultado'] })
    const id = receipt.find(s => s.startsWith('brief: '))?.slice(7)
    assert.match(id ?? '', /^[a-f0-9]{12}$/)
    const path = join(root, 'data', 'briefs', lead.missionId, `${id}.md`)
    assert.ok(isAbsolute(path)); assert.equal(readFileSync(path, 'utf8'), task)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    const launch = launches[0]
    const prompt = readFileSync(launch.taskPath, 'utf8')
    assert.ok(prompt.length < 1200); assert.ok(prompt.includes(path))
    assert.match(prompt, /arquivo inteiro/); assert.match(prompt, /handoff_submit/)
    assert.match(prompt, /Comprovar resultado/)
    assert.ok(readFileSync(launch.rolePromptPath, 'utf8').includes(pane.activityAttemptId!))
    assert.ok(launch.addDirs.includes(join(root, 'data', 'briefs', lead.missionId)))
    for (const cli of ['claude', 'codex'] as const) assert.ok(buildCommand({ ...launch, cli, toolProfile: 'inherit' }, '/bin/sh').args.join(' ').includes(`--add-dir '${join(root, 'data', 'briefs', lead.missionId)}'`))
    const reused = await core.spawnHelper(lead, { title: 'Long', briefId: id, cli: 'claude', model: null, accept: ['Comprovar resultado'] })
    assert.equal(reused.pane.id, pane.id)
    assert.ok(reused.receipt.includes(`brief: ${id}`))
    const another = await core.spawnHelper(lead, { title: 'Other', briefId: id, task: 'Complemento curto', cli: 'claude', model: null })
    assert.notEqual(another.pane.id, pane.id)
    assert.equal(readdirSync(join(root, 'data', 'briefs', lead.missionId)).length, 1)
    assert.match(readFileSync(launches[1].taskPath, 'utf8'), /Complemento curto/)
    const metric = measurements.snapshot().find(m => m.paneId === pane.id)!
    assert.ok(metric.initialBytesBeforePointer > metric.initialBytes)
    console.log('B5 M0', JSON.stringify({ sourceBytes: Buffer.byteLength(task), before: metric.initialBytesBeforePointer, after: metric.initialBytes }))
    await assert.rejects(core.spawnHelper(lead, { title: 'Bad', briefId: '000000000000', model: null }), /brief.*missão|brief.*encontrado/i)
    await assert.rejects(core.spawnHelper(lead, { title: 'Traversal', briefId: '../outside', model: null }), /brief/i)
    await assert.rejects(core.spawnHelper(lead, { title: 'Empty', model: null }), /tarefa|brief/i)
    await core.handle({ type: 'pane.restart', paneId: pane.id, resume: false })
    assert.ok(readFileSync(launches[2].taskPath, 'utf8').includes(path))
    assert.ok(launches[2].addDirs.includes(join(root, 'data', 'briefs', lead.missionId)))
    assert.equal(readFileSync(path, 'utf8'), task)
  } finally { await core.shutdown() }
})

test('F10 short tasks remain inline (ALREADY_COVERED)', async () => {
  const { core, lead, root } = await fixture()
  try {
    const { pane } = await core.spawnHelper(lead, { title: 'Short', task: 'Texto curto literal', cli: 'claude', model: null })
    assert.match(readFileSync(join(root, 'data', 'panes', String(pane.id), 'task.md'), 'utf8'), /Texto curto literal/)
  } finally { await core.shutdown() }
})

test('F10 brief files survive restart, are idempotent, and cannot cross mission boundaries', async () => {
  const { helperBrief } = await import('../src/agentFiles.ts')
  const { core, lead, root, create } = await fixture()
  const task = 'á\n'.repeat(601)
  try {
    const first = await core.spawnHelper(lead, { title: 'Exact', task, cli: 'claude', model: null })
    const id = first.receipt.find(s => s.startsWith('brief: '))!.slice(7)
    const path = join(root, 'data', 'briefs', lead.missionId, `${id}.md`)
    const modified = statSync(path).mtimeMs
    await core.spawnHelper(lead, { title: 'Exact', task, cli: 'claude', model: null })
    assert.equal(statSync(path).mtimeMs, modified)
    assert.throws(() => helperBrief(join(root, 'data'), 'different-mission', undefined, id), /não encontrado nesta missão/)
    assert.equal(helperBrief(join(root, 'data'), lead.missionId, 'x'.repeat(1200)), null)
    assert.ok(helperBrief(join(root, 'data'), lead.missionId, 'x'.repeat(1201)))
    await core.shutdown()
    const restored = create()
    try {
      assert.equal(helperBrief(join(root, 'data'), lead.missionId, undefined, id)!.task, task)
      assert.match(restored.missionBriefing(lead.missionId), /Exact/)
    } finally { await restored.shutdown() }
  } finally { await core.shutdown() }
})

test('F10 MCP spawn and spawn_many accept briefId without task and return the same receipt', async () => {
  const { createServer } = await import('node:http')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const { handleMcp } = await import('../src/mcp.ts')
  const { core, lead } = await fixture()
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    await handleMcp(core, lead, req, res, body ? JSON.parse(body) : undefined)
  })
  const client = new Client({ name: 'brief-test', version: '0' })
  const textOf = (r: any) => r.content[0].text as string
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as any).port}/mcp`)))
    const first = await client.callTool({ name: 'agent_spawn', arguments: { task: 'MCP context '.repeat(200), agent: 'claude' } })
    assert.ok(!first.isError, textOf(first))
    const id = /brief: ([a-f0-9]{12})/.exec(textOf(first))![1]!
    const reused = await client.callTool({ name: 'agent_spawn_many', arguments: { helpers: [{ briefId: id, agent: 'claude' }, { briefId: id, agent: 'claude' }] } })
    assert.ok(!reused.isError, textOf(reused))
    assert.equal(textOf(reused).match(new RegExp(`brief: ${id}`, 'g'))?.length, 2)
    assert.equal(core.missionPanes(lead.missionId).length, 3)
    const missing = await client.callTool({ name: 'agent_spawn', arguments: { briefId: '000000000000' } })
    assert.equal(missing.isError, true)
    assert.match(textOf(missing), /não encontrado nesta missão/)
    const empty = await client.callTool({ name: 'agent_spawn', arguments: {} })
    assert.equal(empty.isError, true)
    const status = await client.callTool({ name: 'mission_status', arguments: {} })
    assert.ok(!status.isError)
  } finally {
    await client.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await core.shutdown()
  }
})

test('F10 pointer preserves routing and design constraints from the full assignment', async () => {
  const { core, lead } = await fixture()
  try {
    await assert.rejects(core.spawnHelper(lead, { title: 'Worker', task: 'Implemente design de frontend. '.repeat(100), cli: 'claude', model: 'claude-haiku-5-5' }), /conflita com a política frontend/)
  } finally { await core.shutdown() }
})
