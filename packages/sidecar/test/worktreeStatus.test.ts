import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worktreeStatus } from '../src/worktreeStatus.ts'

const base = { alive: true, waiting: false, dirty: false, result: null, reviewRequired: true, accepted: false } as const
for (const [name, input, expected] of [
  ['live without delivery', {}, 'working'],
  ['closed without delivery', { alive: false }, 'working'],
  ['human input', { waiting: true, result: 'done', accepted: true }, 'blocked'],
  ['blocked result', { result: 'blocked', dirty: true }, 'blocked'],
  ['uncommitted delivery', { result: 'done', accepted: true, dirty: true }, 'working'],
  ['awaiting independent acceptance', { result: 'done' }, 'review'],
  ['accepted current delivery', { result: 'done', accepted: true }, 'done'],
  ['delivery without required review', { result: 'done', reviewRequired: false }, 'done'],
  ['automatic stop is not delivery', { result: 'auto' }, 'working'],
] as const) test(name, () => assert.equal(worktreeStatus({ ...base, ...input }), expected))
