import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Schedule } from '@orbit/protocol'
import { nextRun, normalizeWhen } from '../src/schedules.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime()

test('the next run follows the chosen time, days and interval', () => {
  const tue = local(2026, 10, 13, 10, 0) // terça
  assert.equal(nextRun({ kind: 'daily', time: '09:00', days: [] }, tue), local(2026, 10, 14, 9, 0), 'already past today: tomorrow')
  assert.equal(nextRun({ kind: 'daily', time: '18:30', days: [] }, tue), local(2026, 10, 13, 18, 30))
  assert.equal(nextRun({ kind: 'daily', time: '09:00', days: [1] }, tue), local(2026, 10, 19, 9, 0), 'only mondays')
  assert.equal(nextRun({ kind: 'interval', hours: 6 }, tue), tue + 6 * 3_600_000)
  assert.equal(nextRun({ kind: 'once', at: tue + 1000 }, tue), tue + 1000)
  assert.equal(nextRun({ kind: 'once', at: tue - 1000 }, tue), null)
  assert.deepEqual(normalizeWhen({ kind: 'daily', time: '07:05', days: [5, 1, 1, 9] }), { kind: 'daily', time: '07:05', days: [1, 5] })
  assert.throws(() => normalizeWhen({ kind: 'daily', time: '25:00', days: [] }), /HH:MM/)
  assert.throws(() => normalizeWhen({ kind: 'once', at: Date.now() - 1 }), /futuro/)
  assert.throws(() => normalizeWhen({ kind: 'interval', hours: 0 }), /De 1 a 168/)
})

test('due schedules start missions from their template, skip while the last one works, and move on', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, browser: null, scheduler: false })
  const ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'template.save', template: { name: 'Dependências', workspaceId: workspace.id, title: 'Atualizar dependências', objective: 'Atualizar e rodar os testes.', mode: 'livre', squadId: null, isolation: null, lead: { cli: 'shell', model: null, effort: null }, cards: ['Atualizar', 'Testar'] } })
    const { template } = await ui.next('template.updated')

    ui.send({ type: 'schedule.save', schedule: { name: 'A cada 6 h', templateId: 'nao-existe', workspaceId: workspace.id, when: { kind: 'interval', hours: 6 }, enabled: true, skipIfRunning: true } })
    assert.match((await ui.next('error')).message, /modelo de missão que exista/)
    ui.send({ type: 'schedule.save', schedule: { name: 'A cada 6 h', templateId: template.id, workspaceId: workspace.id, when: { kind: 'interval', hours: 6 }, enabled: true, skipIfRunning: true } })
    const saved = (await ui.next('schedule.updated')).schedule
    assert.ok(saved.nextRunAt! > Date.now() + 5.9 * 3_600_000)

    // Time passes: the mission starts from the template, with its cards.
    const t1 = saved.nextRunAt!
    server.core.tickSchedules(t1)
    const { mission } = await ui.next('mission.updated', (m) => m.mission.title.startsWith('Atualizar dependências · '))
    assert.equal(mission.scheduleId, saved.id)
    await ui.next('event.added', (m) => m.event.missionId === mission.id && m.event.title === 'Missão agendada iniciada (A cada 6 h)')
    await ui.next('card.updated', (m) => m.card.missionId === mission.id && m.card.title === 'Testar')
    const ran = (await ui.next('schedule.updated', (m) => m.schedule.lastMissionId === mission.id)).schedule
    assert.deepEqual([ran.lastResult, ran.lastRunAt, ran.nextRunAt], ['Missão iniciada', t1, t1 + 6 * 3_600_000])

    // The next run comes while that mission's agent is still starting: skipped.
    server.core.tickSchedules(ran.nextRunAt!)
    const skipped = (await ui.next('schedule.updated', (m) => (m.schedule.lastResult ?? '').startsWith('Pulada'))).schedule
    assert.match(skipped.lastResult!, /ainda tem 1 agente trabalhando/)
    assert.equal(skipped.lastMissionId, mission.id)

    // Running by hand does not move the next run.
    ui.send({ type: 'schedule.run', scheduleId: saved.id })
    const manual = (await ui.next('schedule.updated', (m) => m.schedule.lastResult === 'Missão iniciada (na mão)')).schedule
    assert.equal(manual.nextRunAt, skipped.nextRunAt)

    // A single run: done afterwards. Without its template: says so.
    ui.send({ type: 'schedule.save', schedule: { name: 'Uma vez', templateId: template.id, workspaceId: workspace.id, when: { kind: 'once', at: Date.now() + 60_000 }, enabled: true, skipIfRunning: false } })
    const once = (await ui.next('schedule.updated', (m) => m.schedule.name === 'Uma vez')).schedule
    ui.send({ type: 'template.delete', templateId: template.id })
    await ui.next('template.removed')
    server.core.tickSchedules(once.nextRunAt!)
    const done: Schedule = (await ui.next('schedule.updated', (m) => m.schedule.id === once.id && m.schedule.lastRunAt !== null)).schedule
    assert.deepEqual([done.lastResult, done.nextRunAt, done.enabled], ['Não rodou: o modelo foi apagado', null, false])

    ui.send({ type: 'schedule.delete', scheduleId: once.id })
    await ui.next('schedule.removed', (m) => m.scheduleId === once.id)
  } finally {
    ui.ws.close()
    await server.close()
  }
})
