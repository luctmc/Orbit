import test from 'node:test'
import assert from 'node:assert/strict'
import { nextVersion } from './release-version.mjs'

test('increments beyond both source version and previously published tags', () => {
  assert.equal(nextVersion('0.2.15', ['v0.2.14']), '0.2.16')
  assert.equal(nextVersion('0.2.15', ['v0.2.99', 'v0.3.2', 'v0.3.3-beta.1', 'bad']), '0.3.3')
  assert.equal(nextVersion('1.0.0', []), '1.0.1')
  assert.throws(() => nextVersion('0.2.bad', []))
})
