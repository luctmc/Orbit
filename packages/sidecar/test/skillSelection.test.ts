import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogItem } from '@orbit/protocol'
import { resolveSkillSelectors } from '../src/skillSelection.ts'
import { designSkillDelivery } from '../src/designSkills.ts'

const item = (id: string, name: string): CatalogItem => ({ id, name, cli: 'codex', kind: 'skill', description: 'fixture', source: 'fixture', offInCli: false })
test('explicit skills require an exact id or an unambiguous name; repeated selectors deliver once', () => {
  const first = item('project:review', 'review'), second = item('personal:review', 'review')
  assert.throws(() => resolveSkillSelectors([first, second], ['review']), /ambígua|mais de uma/i)
  assert.deepEqual(resolveSkillSelectors([first, second], [first.id, first.id]), [first])
  assert.throws(() => resolveSkillSelectors([first], ['absent']), /indisponível|encontrada/i)
  const namespaced = item('plugin:review', 'plugin:review')
  assert.deepEqual(resolveSkillSelectors([namespaced], ['review', namespaced.id]), [namespaced])
  assert.throws(() => resolveSkillSelectors([first, namespaced], ['review']), /ambígua|mais de uma/i)
})

test('automatic skill delivery leaves the caller-owned missing list unchanged', () => {
  const missing = ['No compatible local design skill']
  const bad = { ...item('broken', 'broken'), resource: { sha256: 'not-a-resource' } } as CatalogItem
  designSkillDelivery([bad, bad], [], missing)
  assert.deepEqual(missing, ['No compatible local design skill'])
})
