import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenBaseline } from './tokenBaseline.ts'

test('baseline mede o catálogo real, mensagens continuam no líder e resume distingue role preparado de bytes enviados', async (t) => {
  const result = await tokenBaseline()
  assert.equal(result.components.length, 2)
  // Baseline B8 medido nesta worktree antes de filtrar os grupos; bytes UTF-8, não tokens cobrados.
  const before = [
    { role: 'lead', tools: 40, catalogBytes: 26882, roleBytes: 10275, promptBytes: 0 },
    { role: 'crew', tools: 28, catalogBytes: 15502, roleBytes: 6337, promptBytes: 0 },
  ]
  const comparison = result.components.map((component, index) => {
    const prior = before[index]!
    const after = { role: component.role, tools: component.toolCount, catalogBytes: component.mcpTools.bytes, roleBytes: component.completeRole.bytes, promptBytes: component.prompt.bytes }
    const fixedBefore = prior.catalogBytes + prior.roleBytes + prior.promptBytes
    const fixedAfter = after.catalogBytes + after.roleBytes + after.promptBytes
    return { before: prior, after, fixedBefore, fixedAfter, savedBytes: fixedBefore - fixedAfter, savedPercent: 100 * (fixedBefore - fixedAfter) / fixedBefore }
  })
  assert.equal(result.components[0]!.toolCount, 40)
  assert.equal(result.components[0]!.mcpTools.bytes, 26882, 'catálogo do líder permanece intacto')
  assert.equal(result.components[1]!.toolCount, 17)
  assert.ok(result.components[1]!.mcpTools.bytes < 15502)
  assert.ok(comparison[1]!.savedPercent >= 20, 'a remoção dos grupos reduz o contexto fixo real da fixture')
  t.diagnostic(`B8 M0 ${JSON.stringify({ unit: 'UTF-8 bytes; bytes/4 é estimativa, não tokens cobrados', comparison })}`)
  for (const component of result.components) {
    assert.ok(component.toolCount > 0)
    assert.ok(component.completeRole.bytes > component.roleContract.bytes)
    assert.ok(component.mcpTools.bytes > component.mcpInputSchemas.bytes)
    assert.equal(component.mcpTools.estimatedTokens, component.mcpTools.bytes / 4)
  }
  assert.equal(result.paneCountAfterMessages, result.paneCountBeforeMessages)
  assert.deepEqual(result.replies, [{ type: 'pane.submitted', paneId: 1 }, { type: 'pane.submitted', paneId: 1 }])
  assert.equal(result.beforeResume.preparedRoleBytes, result.components[0]!.completeRole.bytes)
  assert.equal(result.afterResume.preparedRoleBytes, result.components[0]!.completeRole.bytes)
  assert.equal(result.afterResume.initialBytes, 0, 'resume sem mensagem não reenvia o role')
})
