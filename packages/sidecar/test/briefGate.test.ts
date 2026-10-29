import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'

const completeBrief = `# Goal
Corrigir a leitura em packages/sidecar/src/core.ts.
## Expected result
1. Executar npm test e comprovar todos os testes passando.
**Scope**
Owns: packages/sidecar/src/core.ts; must not touch: usage.ts.
Constraints: Preservar dados e credenciais existentes, sem chamadas a modelo.
`
const long = (brief: string) => brief + '\nContexto adicional seguro. '.repeat(65)
async function score(text: string) {
  const module = await import('../src/briefGate.ts').catch(() => ({})) as any
  assert.equal(typeof module.scoreBrief, 'function', 'gate determinístico exportado')
  return module.scoreBrief(text)
}

for (const [name, text, total, accepted] of [
  ['English complete', completeBrief, 10, true],
  ['Portuguese labels', 'OBJETIVO: Corrigir a leitura em packages/sidecar/src/core.ts.\nRESULTADO ESPERADO: 1. Executar npm test e comprovar todos os testes.\nESCOPO: Pode alterar: core.ts; não tocar: usage.ts.\nRESTRIÇÕES: Preservar dados e credenciais existentes.', 10, true],
  ['6 refuses', 'Goal: Melhorar a leitura dos dados existentes.\nExpected result: Entregar a leitura consistente dos dados.\nScope: core\nConstraints: sem rede', 6, false],
  ['7 accepts', 'Goal: Melhorar a leitura dos dados existentes.\nExpected result: Entregar a leitura consistente dos dados.\nScope: owns core.ts; must not touch usage.ts\nConstraints: sem rede', 7, true],
  ['weak Goal refuses', 'Goal: corrigir\nExpected result: 1. Entregar leitura consistente dos dados.\nScope: owns core.ts; must not touch usage.ts\nConstraints: Preservar dados e credenciais existentes.', 8, false],
  ['weak Result refuses', 'Goal: Corrigir a leitura em src/core.ts.\nExpected result: pronto\nScope: owns core.ts; must not touch usage.ts\nConstraints: Preservar dados e credenciais existentes.', 8, false],
  ['missing scope refuses even with eight points', completeBrief.replace('**Scope**\nOwns: packages/sidecar/src/core.ts; must not touch: usage.ts.\n', ''), 8, false],
  ['markup alone is vague', '# Goal\n***---***\n## Expected result\n***---***\n# Scope\n---\n# Constraints\n---', 0, false],
  ['empty Scope and Constraints headings do not count as present', '# Goal\nCorrigir leitura em packages/sidecar/src/core.ts.\n## Expected result\n1. Executar npm test e comprovar o resultado.\nScope:\nConstraints:\n', 6, false],
  ['whitespace-only Scope and Constraints do not count as present', '# Goal\nCorrigir leitura em packages/sidecar/src/core.ts.\n## Expected result\n1. Executar npm test e comprovar o resultado.\nScope:   \n\nConstraints:\n   \n', 6, false],
] as const) test(`F12 ${name}`, async () => {
  const result = await score(text)
  assert.equal(result.score, total)
  assert.equal(result.accepted, accepted)
  if (!accepted) assert.match(result.error, /Brief recusado.*\/10[\s\S]*Goal:[\s\S]*Expected result:[\s\S]*Scope:[\s\S]*Constraints:/)
})

test('F12 long rejection precedes pane, activity, attempt, file and rescue accounting, including sub-helper', async () => {
  const f = await fixture()
  try {
    for (const caller of [f.lead, f.pane]) {
      const before = JSON.stringify(f.core.store.snapshot())
      const history = JSON.stringify(f.core.store.activityHistory(f.lead.missionId))
      await assert.rejects(f.core.spawnHelper(caller, { title: 'Invalid', task: long(completeBrief.replace('**Scope**\nOwns: packages/sidecar/src/core.ts; must not touch: usage.ts.\n', '')), model: null }), /Brief recusado.*Escopo/)
      assert.equal(JSON.stringify(f.core.store.snapshot()), before)
      assert.equal(JSON.stringify(f.core.store.activityHistory(f.lead.missionId)), history)
      assert.equal(existsSync(join(f.root, 'data', 'briefs', f.lead.missionId)), false)
    }
  } finally { await f.core.shutdown() }
})

test('F12 complete long brief records score; approved briefId skips scoring and short task remains inline', async () => {
  const f = await fixture()
  try {
    const result = await f.core.spawnHelper(f.lead, { title: 'Approved', task: long(completeBrief), cli: 'claude', model: null })
    const receipt = result.receipt.find(s => s.startsWith('brief: '))!
    assert.match(receipt, /^brief: [a-f0-9]{12} · nota 10\/10$/)
    const id = receipt.slice(7, 19)
    const reused = await f.core.spawnHelper(f.lead, { title: 'Approved', briefId: id, cli: 'claude', model: null })
    assert.equal(reused.pane.id, result.pane.id)
    // A stored F10 brief is trusted by id, even when it predates the gate.
    const { helperBrief } = await import('../src/agentFiles.ts')
    const legacy = helperBrief(join(f.root, 'data'), f.lead.missionId, 'legacy context '.repeat(100))!
    const approved = await f.core.spawnHelper(f.lead, { title: 'Legacy', briefId: legacy.id, cli: 'claude', model: null })
    assert.ok(approved.pane.id)
    const short = await f.core.spawnHelper(f.lead, { title: 'Short', task: 'x'.repeat(1200), cli: 'claude', model: null })
    assert.ok(!short.receipt.some(s => s.startsWith('brief: ')))
    assert.match(readFileSync(join(f.root, 'data', 'panes', String(short.pane.id), 'task.md'), 'utf8'), /x{1200}/)
    assert.equal(readdirSync(join(f.root, 'data', 'briefs', f.lead.missionId)).length, 2)
  } finally { await f.core.shutdown() }
})

test('F12 MCP single, batch and sub-helper reject long invalid briefs without admission effects', async () => {
  const { createServer } = await import('node:http')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const { handleMcp } = await import('../src/mcp.ts')
  const f = await fixture()
  let caller = f.lead
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    await handleMcp(f.core, caller, req, res, body ? JSON.parse(body) : undefined)
  })
  const client = new Client({ name: 'gate-mcp', version: '0' })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as any).port}/mcp`)))
    const before = JSON.stringify(f.core.store.snapshot())
    const invalid = { title: 'Invalid', task: 'Contexto sem seções. '.repeat(100) }
    const single = await client.callTool({ name: 'agent_spawn', arguments: invalid })
    assert.equal(single.isError, true)
    assert.match((single.content as any)[0].text, /Brief recusado.*Escopo/)
    const batch = await client.callTool({ name: 'agent_spawn_many', arguments: { helpers: [invalid, invalid] } })
    assert.equal(((batch.content as any)[0].text.match(/Brief recusado/g) ?? []).length, 2)
    caller = f.pane
    assert.ok(f.core.childSlots(caller) > 0)
    const sub = await client.callTool({ name: 'agent_spawn', arguments: invalid })
    assert.equal(sub.isError, true)
    assert.match((sub.content as any)[0].text, /Brief recusado.*Escopo/)
    assert.equal(JSON.stringify(f.core.store.snapshot()), before)
    assert.equal(existsSync(join(f.root, 'data', 'briefs', f.lead.missionId)), false)
  } finally {
    await client.close()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    await f.core.shutdown()
  }
})
