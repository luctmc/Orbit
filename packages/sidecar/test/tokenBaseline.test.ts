import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenBaseline } from './tokenBaseline.ts'

test('baseline mede o catálogo real, mensagens continuam no líder e resume distingue role preparado de bytes enviados', async () => {
  const result = await tokenBaseline()
  assert.equal(result.components.length, 2)
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
