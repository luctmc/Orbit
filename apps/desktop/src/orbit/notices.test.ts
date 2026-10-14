import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mission, MissionEvent, Pane } from '@orbit/protocol'
import { DEFAULT_PREFS, FINISHED_AFTER_MS, NoticeWatcher, waitingCount } from './notices.ts'

const mission = { id: 'm1', title: 'Refatorar login' } as Mission
const pane = (patch: Partial<Pane>): Pane => ({ ...({ id: 3, missionId: 'm1', role: 'lead', cli: 'claude', title: 'Líder', status: 'running' } as Pane), ...patch })
const event = (kind: MissionEvent['kind'], title: string, body: string): MissionEvent => ({ id: 'e', missionId: 'm1', kind, at: 0, title, body, paneId: 4 })

test('waiting, handoffs and exits become notices as the person chose', () => {
  const w = new NoticeWatcher()
  const waiting = w.observe({ type: 'event.added', event: event('pane.waiting', '#4 espera você', 'Claude precisa de permissão para usar Bash') }, [mission], DEFAULT_PREFS)
  assert.deepEqual(waiting, [{ title: '#4 espera você', body: 'Refatorar login: Claude precisa de permissão para usar Bash', missionId: 'm1', paneId: 4 }])
  const handoff = w.observe({ type: 'event.added', event: event('handoff', 'Retorno de #4', 'Corrigi o token.\n\nDetalhes longos') }, [mission], DEFAULT_PREFS)
  assert.equal(handoff[0]!.body, 'Refatorar login: Corrigi o token.')
  assert.deepEqual(w.observe({ type: 'event.added', event: event('pane.exited', '#4 encerrou', 'código 0') }, [mission], DEFAULT_PREFS), [], 'exits are off by default')
  assert.equal(w.observe({ type: 'event.added', event: event('pane.exited', '#4 encerrou', 'código 1') }, [mission], { ...DEFAULT_PREFS, exited: true }).length, 1)
  assert.deepEqual(w.observe({ type: 'event.added', event: event('pane.waiting', '#4 espera você', 'x') }, [mission], { ...DEFAULT_PREFS, waiting: false }), [])
})

test('a Claude agent finishing a long turn is a notice; quick answers and Codex are not', () => {
  const w = new NoticeWatcher()
  const t0 = 1_000_000
  w.observe({ type: 'pane.updated', pane: pane({ status: 'running' }) }, [mission], DEFAULT_PREFS, t0)
  w.observe({ type: 'pane.updated', pane: pane({ status: 'running' }) }, [mission], DEFAULT_PREFS, t0 + 5000)
  const done = w.observe({ type: 'pane.updated', pane: pane({ status: 'idle' }) }, [mission], DEFAULT_PREFS, t0 + 3 * 60_000)
  assert.deepEqual(done, [{ title: '#3 terminou', body: 'Refatorar login: Líder depois de 3 min', missionId: 'm1', paneId: 3 }])

  w.observe({ type: 'pane.updated', pane: pane({ status: 'running' }) }, [mission], DEFAULT_PREFS, t0)
  assert.deepEqual(w.observe({ type: 'pane.updated', pane: pane({ status: 'idle' }) }, [mission], DEFAULT_PREFS, t0 + FINISHED_AFTER_MS - 1), [], 'quick turn')

  w.observe({ type: 'pane.updated', pane: pane({ id: 9, cli: 'codex', status: 'running' }) }, [mission], DEFAULT_PREFS, t0)
  assert.deepEqual(w.observe({ type: 'pane.updated', pane: pane({ id: 9, cli: 'codex', status: 'idle' }) }, [mission], DEFAULT_PREFS, t0 + 10 * 60_000), [])

  w.observe({ type: 'pane.updated', pane: pane({ status: 'running' }) }, [mission], DEFAULT_PREFS, t0)
  assert.deepEqual(w.observe({ type: 'pane.updated', pane: pane({ status: 'waiting' }) }, [mission], DEFAULT_PREFS, t0 + 5 * 60_000), [], 'waiting has its own notice')
  assert.equal(waitingCount([pane({ status: 'waiting' }), pane({ id: 5, status: 'idle' }), pane({ id: 6, status: 'waiting' })]), 2)
})
