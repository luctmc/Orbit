import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerIdentity } from './providerIdentity.ts'

test('pane identity separates observed models from configured/default models and custom endpoints', () => {
  assert.match(providerIdentity({ cli: 'codex', model: null }).model, /ainda não informado/)
  assert.match(providerIdentity({ cli: 'claude', model: 'sonnet' }).model, /Configurado: sonnet.*não confirmada/)
  assert.match(providerIdentity({ cli: 'codex', model: null, reportedModels: ['gpt-observed'] }).model, /Observado na sessão: gpt-observed/)
  const custom = providerIdentity({ cli: 'claude', model: null }, { kind: 'api', baseUrl: 'https://openrouter.ai/api' } as any)
  assert.equal(custom.brand, null)
  assert.equal(custom.provider, 'openrouter.ai')
  assert.equal(providerIdentity({ cli: 'shell', model: null }).brand, null)
})
