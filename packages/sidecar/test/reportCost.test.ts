import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mission } from '@orbit/protocol'
import { missionReport } from '../src/report.ts'

const render = (costUsd: number | null) => missionReport({
  mission: { id: 'm', title: 'Custos', mode: 'agentica', status: 'active', createdAt: 0, updatedAt: 0,
    usage: { input: 100, output: 5, total: 105, cacheRead: 0, cacheWrite: 0, costUsd } } as Mission,
  workspace: undefined, squad: undefined, panes: [], accountNames: {}, cards: [], events: [], git: null, pr: null, folders: [], now: 0,
})

test('the report shows a reported zero cost without claiming full coverage', () => {
  const md = render(0)
  assert.match(md, /US\$ 0,00/)
  assert.match(md, /subtotal informado pelo Claude/)
  assert.match(md, /outros custos podem estar ausentes/)
})
test('the report marks unknown USD explicitly instead of implying free execution', () => {
  const md = render(null)
  assert.match(md, /custo em USD não informado/)
  assert.doesNotMatch(md, /US\$ 0,00/)
})
test('the report labels a positive known amount as a subtotal', () => {
  const md = render(0.42)
  assert.match(md, /US\$ 0,42/)
  assert.match(md, /subtotal informado pelo Claude/)
  assert.match(md, /outros custos podem estar ausentes/)
})
