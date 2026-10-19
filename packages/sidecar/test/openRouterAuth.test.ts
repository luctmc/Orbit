import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountFiles, BUILTIN_ACCOUNTS } from '../src/accounts.ts'
import './helpers.ts'

test('OpenRouter uses isolated bearer auth and no key material in shell command/config helper', () => {
  const originalToken = process.env.ANTHROPIC_AUTH_TOKEN
  const files = new AccountFiles(mkdtempSync(join(tmpdir(), 'orbit-openrouter-')))
  const account = { ...BUILTIN_ACCOUNTS[0]!, id: 'router', builtin: false, kind: 'api' as const, baseUrl: 'https://openrouter.ai/api', model: 'anthropic/claude-sonnet', keyHint: 'fixture' }
  const secret = 'synthetic-router-key-never-real'
  files.prepare(account); files.saveKey(account, secret)
  const env = files.env(account)
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, secret)
  assert.equal(env.ANTHROPIC_API_KEY, '')
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://openrouter.ai/api')
  assert.equal(files.apiKeyHelper(account), undefined, 'bearer credential must not compete with x-api-key helper')
  assert.ok(!files.envPrefix(account).includes(secret))
  assert.match(files.envPrefix(account), /ANTHROPIC_AUTH_TOKEN="\$\(cat /)
  assert.equal(readFileSync(files.keyPath(account), 'utf8'), secret)
  const native = { ...account, id: 'native-api', baseUrl: null }
  files.prepare(native); files.saveKey(native, 'different-fixture-key')
  assert.equal(files.env(native).ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(files.env(native).ANTHROPIC_API_KEY, undefined)
  assert.match(files.apiKeyHelper(native)!, /native-api/)
  const lookalike = { ...account, baseUrl: 'https://openrouter.ai.example.invalid/api' }
  assert.equal(files.env(lookalike).ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(files.env(BUILTIN_ACCOUNTS[0]!).ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, originalToken, 'global environment is unchanged')
})
