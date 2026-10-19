import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { startServer } from '../src/server.ts'
import { InputJournal, inputFingerprint, translateCodex, UncertainTranslation, type Translate } from '../src/inputLanguage.ts'
import { offline, seedRoutingQuota, HOMES, connect, ORIGIN, TOKEN } from './helpers.ts'
import type { ClientMessage, ServerMessage } from '@orbit/protocol'

async function fixture(translate: Translate) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-input-test-'))
  const launches: any[] = []
  const core = new OrbitCore({ dataDir: root, shell: '/bin/sh', browser: null, broadcast: () => {}, run: offline, translate,
    agentCommand: launch => { launches.push(launch); return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] } } })
  core.setEndpoint('http://127.0.0.1:1')
  core.store.saveSettings({ ...core.store.settings(), smartClassify: false })
  await seedRoutingQuota(core)
  const workspace = core.store.createWorkspace('Test', [root])
  await core.handle({ type: 'mission.create', workspaceId: workspace.id, title: 'Test', objective: '', mode: 'livre', lead: { cli: 'codex', model: null, title: '' } })
  const pane = core.store.snapshot().panes[0]!
  const sent: string[] = []
  const priv = core as any
  priv.panes.submitWithReceipt = (_id: number, text: string, ack: () => void) => { sent.push(text); ack?.(); return true }
  const send = async (message: ClientMessage) => { const replies: ServerMessage[] = []; await core.handle(message, m => replies.push(m)); return replies[0] as any }
  return { core, root, pane, workspace, launches, sent, send, close: async () => { await core.shutdown(); rmSync(root, { recursive: true, force: true }) } }
}

test('Portuguese is translated before PTY, scoped login is explicit, lost ACK/concurrent retry sends once', async () => {
  let calls = 0
  const f = await fixture(async input => { calls++; assert.equal(input.text, 'Corrija o botão'); assert.equal(input.authFile, join(HOMES.codex, 'auth.json')); return 'Fix the button' })
  try {
    const message = { type: 'pane.submit' as const, dispatch: 'continue' as const, paneId: f.pane.id, text: 'Corrija o botão', requestId: 'same-request', translationAccountId: 'codex' }
    const replies = await Promise.all([f.send(message), f.send(message)])
    assert(replies.every(r => r.type === 'pane.submitted'))
    assert.equal(replies[0].executionEpoch, f.pane.executionEpoch)
    assert.equal(replies[0].paneId, f.pane.id)
    assert.equal(typeof replies[0].acceptedAt, 'number')
    assert.deepEqual(replies[1], replies[0], 'concurrent receipt names the same acceptance')
    assert.equal(calls, 1); assert.equal(f.sent.length, 1)
    assert.match(f.sent[0]!, /^Fix the button\n\nRespond to the user in Brazilian Portuguese/)
    assert(!f.sent[0]!.includes(message.text))
    assert.equal((await f.send(message)).type, 'pane.submitted'); assert.equal(f.sent.length, 1)
    const changed = await f.send({ ...message, text: 'Outro pedido' })
    assert.match(changed.message, /outros dados/); assert.equal(f.sent.length, 1)
    const file = join(f.root, 'input-journal', f.pane.missionId, 'same-request.json')
    const record = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(record.original, message.text); assert.equal(record.state, 'acked')
    assert.equal(record.acceptedAt, replies[0].acceptedAt)
    assert.equal(record.executionEpoch, f.pane.executionEpoch)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(statSync(join(f.root, 'input-journal', f.pane.missionId)).mode & 0o777, 0o700)
    assert(!JSON.stringify(f.core.store.snapshot()).includes('same-request'))
  } finally { await f.close() }
})

test('no silent provider/account fallback; original requires explicit authorization; failed translation never repeats', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; throw new Error('synthetic translation failure') })
  try {
    const base = { type: 'pane.submit' as const, dispatch: 'continue' as const, paneId: f.pane.id, text: 'Olá' }
    assert.match((await f.send({ ...base, requestId: 'missing' })).message, /explicitamente/)
    assert.match((await f.send({ ...base, requestId: 'wrong', translationAccountId: 'claude' })).message, /somente.*Codex/)
    assert.equal(calls, 0); assert.equal(f.sent.length, 0)
    const failure = { ...base, requestId: 'failure', translationAccountId: 'codex' }
    assert.match((await f.send(failure)).message, /synthetic/)
    assert.match((await f.send(failure)).message, /synthetic/)
    assert.equal(calls, 1); assert.equal(f.sent.length, 0)
    assert.equal((await f.send({ ...base, requestId: 'authorized-original', allowOriginal: true })).type, 'pane.submitted')
    assert.match(f.sent[0]!, /^Olá/)
  } finally { await f.close() }
})

test('durable uncertain translation or PTY state is reported pending after restart without retry', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; return 'Hello' })
  try {
    for (const state of ['translating', 'submitting'] as const) {
      const message = { type: 'pane.submit' as const, dispatch: 'continue' as const, paneId: f.pane.id, text: 'Olá', requestId: state, translationAccountId: 'codex' }
      new InputJournal(f.root).save(f.pane.missionId, state, { state, original: message.text, fingerprint: inputFingerprint(message) })
      const result = await f.send(message)
      assert.equal(result.type, 'pane.submit.error'); assert.equal(result.pending, true)
    }
    assert.equal(calls, 0); assert.equal(f.sent.length, 0)
  } finally { await f.close() }
})

test('initial mission translates before launch, reports correlated ACK and deduplicates creation', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; return 'Fix authentication' })
  try {
    const message = { type: 'mission.create' as const, requestId: 'new-mission', workspaceId: f.workspace.id, title: 'Login', objective: 'Corrija a autenticação', mode: 'agentica' as const, translationAccountId: 'codex', adaptiveLead: false, lead: { cli: 'codex' as const, model: 'gpt-6.1-sol', effort: 'medium' as const, accountId: 'codex', title: '' } }
    const first = await f.send(message)
    assert.equal(first.type, 'mission.created', JSON.stringify(first)); assert.equal(first.mission.objective, 'Fix authentication')
    const executor = f.core.store.snapshot().panes.find(pane => pane.missionId === first.mission.id)!
    assert.equal(executor.executionConfig?.decision.requested.cli, 'codex')
    assert.deepEqual(executor.executionConfig?.applied, { model: 'gpt-6.1-sol', effort: 'medium' })
    assert.equal(executor.model, 'gpt-6.1-sol'); assert.equal(executor.effort, 'medium'); assert.equal(executor.accountId, 'codex')
    assert.match(readFileSync(f.launches.at(-1).taskPath, 'utf8'), /Fix authentication/)
    assert(!readFileSync(f.launches.at(-1).taskPath, 'utf8').includes(message.objective))
    const count = f.core.store.snapshot().panes.length
    const retry = await f.send(message)
    assert.equal(retry.mission.id, first.mission.id); assert.equal(calls, 1)
    assert.equal(f.core.store.snapshot().panes.length, count)
  } finally { await f.close() }
})

test('missing initial translator returns correlated failure and does not launch a mission', async () => {
  const f = await fixture(async () => { throw new Error('must not run') })
  try {
    const before = f.core.store.snapshot().missions.length
    const result = await f.send({ type: 'mission.create', requestId: 'bad-new', workspaceId: f.workspace.id, title: 'Login', objective: 'Corrija o login', mode: 'agentica', lead: { cli: 'codex', model: null, title: '' } })
    assert.equal(result.type, 'mission.create.error'); assert.equal(result.pending, false)
    assert.equal(f.core.store.snapshot().missions.length, before)
  } finally { await f.close() }
})


test('uncertain provider failure remains pending and cannot be retried under the same ID', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; throw new UncertainTranslation('timeout synthetic') })
  try {
    const request = { type: 'pane.submit' as const, dispatch: 'continue' as const, paneId: f.pane.id, text: 'Olá', requestId: 'uncertain-provider', translationAccountId: 'codex' }
    assert.equal((await f.send(request)).pending, true)
    assert.equal((await f.send(request)).pending, true)
    assert.equal(calls, 1); assert.equal(f.sent.length, 0)
    assert.equal(new InputJournal(f.root).get(f.pane.missionId, request.requestId)?.original, 'Olá')
  } finally { await f.close() }
})

test('legacy clients receive actionable error instead of a silent drop', async () => {
  const f = await fixture(async () => { throw new Error('must not run') })
  try {
    const response = await f.send({ type: 'pane.submit', dispatch: 'continue', paneId: f.pane.id, text: 'Olá' })
    assert.equal(response.type, 'error'); assert.match(response.message, /requestId.*translationAccountId.*allowOriginal/)
    await assert.rejects(async () => { await f.core.handle({ type: 'mission.create', workspaceId: f.workspace.id, title: 'Old caller', objective: 'Olá', mode: 'agentica', lead: { cli: 'codex', model: null, title: '' } }) }, /requestId.*translationAccountId.*allowOriginal/)
    assert.equal(f.sent.length, 0)
  } finally { await f.close() }
})

test('isolated Codex invocation pins lightweight model/low, disables retries and inherits only selected login', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-translator-command-'))
  const oldPath = process.env.PATH
  const executable = join(dir, 'codex'), authFile = join(dir, 'chosen-auth.json')
  writeFileSync(authFile, '{"fixture":"chosen-only"}', { mode: 0o600 })
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path'); const a = process.argv.slice(2);
const has = v => a.includes(v);
if (!has('--ignore-user-config') || !has('--ignore-rules') || !has('--ephemeral') || !has('gpt-6-luna') || !has('model_reasoning_effort="low"') || !has('features.shell_tool=false') || !has('model_providers.orbit-translation.request_max_retries=0') || !has('model_providers.orbit-translation.stream_max_retries=0')) process.exit(41);
if (process.env.OPENAI_API_KEY || process.env.ORBIT_ENDPOINT || process.env.CLAUDE_CONFIG_DIR) process.exit(42);
if (fs.readFileSync(path.join(process.env.CODEX_HOME, 'auth.json'), 'utf8') !== '{"fixture":"chosen-only"}') process.exit(43);
if (fs.existsSync(path.join(process.env.CODEX_HOME, 'config.toml'))) process.exit(44);
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], JSON.stringify({english:'Fix the button'}));
`)
  chmodSync(executable, 0o700)
  process.env.PATH = `${dir}:${oldPath}`
  try { assert.equal(await translateCodex({ text: 'Corrija o botão', authFile }), 'Fix the button') }
  finally { process.env.PATH = oldPath; rmSync(dir, { recursive: true, force: true }) }
})


test('explicit account2 is independent of target pane account and uses its own auth path', async () => {
  let selected = ''
  const f = await fixture(async input => { selected = input.authFile; return 'Hello' })
  try {
    const account = f.core.store.account('codex')!
    f.core.store.saveAccount({ ...account, id: 'codex-acc-2', name: 'Account 2', builtin: false })
    const result = await f.send({ type: 'pane.submit', dispatch: 'continue', paneId: f.pane.id, text: 'Olá', requestId: 'chosen-account2', translationAccountId: 'codex-acc-2' })
    assert.equal(result.type, 'pane.submitted')
    assert.equal(selected, join(f.root, 'accounts/codex-acc-2/codex/auth.json'))
  } finally { await f.close() }
})

test('normal Portuguese input crosses authenticated WebSocket and a real stand-in PTY only as English', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-input-websocket-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: root, shell: '/bin/sh', run: offline, browser: null, scheduler: false,
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while IFS= read -r line; do printf "%s\\n" "$line"; done'] }) })
  const ui = connect(server.port)
  let calls = 0
  try {
    await ui.opened; await server.initialized; await seedRoutingQuota(server.core)
    ;(server.core as any).translate = async () => { calls++; return 'Fix the login button' }
    const workspace = server.core.store.createWorkspace('Input bridge', [root])
    await server.core.handle({ type: 'mission.create', workspaceId: workspace.id, title: 'Input bridge', objective: '', mode: 'livre', lead: { cli: 'codex', model: null, title: '' } })
    const pane = server.core.store.snapshot().panes[0]!
    const request = { type: 'pane.submit' as const, dispatch: 'continue' as const, paneId: pane.id, text: 'Corrija o botão de login', requestId: 'bridge-input', translationAccountId: 'codex' }
    ui.send(request)
    await ui.next('pane.submitted', m => m.requestId === request.requestId)
    await ui.next('pane.data', m => m.paneId === pane.id && m.data.includes('Fix the login button'))
    assert(!ui.inbox.filter(m => m.type === 'pane.data').some(m => m.data.includes(request.text)))
    assert.equal(calls, 1)
    ui.send(request)
    await new Promise(r => setTimeout(r, 100))
    assert.equal(calls, 1)
    assert.equal(new InputJournal(root).get(pane.missionId, request.requestId)?.state, 'acked')
  } finally { ui.ws.close(); await server.close(); rmSync(root, { recursive: true, force: true }) }
})

test('private journal rejects traversal and deletes original creation receipts with mission data', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-input-privacy-'))
  try {
    const journal = new InputJournal(root)
    assert.throws(() => journal.get('../outside', 'request'), /inválido/)
    assert.throws(() => journal.get('mission', '../outside'), /inválido/)
    const record = { fingerprint: 'test', original: 'privado', state: 'acked' as const, missionId: 'mission' }
    journal.save('mission', 'request', record); journal.save('new-workspace', 'request', record)
    journal.remove('mission')
    assert.equal(journal.get('mission', 'request'), null)
    assert.equal(journal.get('new-workspace', 'request'), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('scheduled objectives require an explicit translator and launch only the English objective with pt-BR response instruction', async () => {
  let calls = 0
  const f = await fixture(async ({ text }) => { calls++; assert.equal(text, 'Confira os arquivos'); return 'Check the files' })
  try {
    await f.send({ type: 'template.save', template: { name: 'Check', workspaceId: f.workspace.id, title: 'Check', objective: 'Confira os arquivos', mode: 'agentica', squadId: null, isolation: null, lead: { cli: 'codex', model: null, effort: 'medium' }, cards: [] } })
    const template = f.core.store.snapshot().templates[0]!
    await f.send({ type: 'schedule.save', schedule: { name: 'Check', workspaceId: f.workspace.id, templateId: template.id, enabled: true, skipIfRunning: false, when: { kind: 'interval', hours: 6 } } })
    let schedule = f.core.store.schedules()[0]!
    const count = f.core.store.snapshot().missions.length
    await f.send({ type: 'schedule.run', scheduleId: schedule.id })
    assert.equal(f.core.store.snapshot().missions.length, count, 'missing translator must never bypass English preference')
    assert.match(f.core.store.schedule(schedule.id)!.lastResult!, /explicitamente/)
    await f.send({ type: 'schedule.save', schedule: { ...schedule, translationAccountId: 'codex', allowOriginal: false } } as ClientMessage)
    schedule = f.core.store.schedule(schedule.id)!
    await Promise.all([f.send({ type: 'schedule.run', scheduleId: schedule.id }), f.send({ type: 'schedule.run', scheduleId: schedule.id })])
    assert.equal(calls, 1)
    assert.equal(f.core.store.snapshot().missions.length, count + 1)
    const mission = f.core.store.mission(f.core.store.schedule(schedule.id)!.lastMissionId!)!
    assert.equal(mission.objective, 'Check the files')
    assert.match(readFileSync(f.launches.at(-1).taskPath, 'utf8'), /Respond to the user in Brazilian Portuguese/)
  } finally { await f.close() }
})

test('uncertain scheduled translation pauses automatic execution and a deleted schedule is not resurrected', async () => {
  let release!: (value: string) => void, calls = 0
  const f = await fixture(async () => { calls++; if (calls === 1) throw new UncertainTranslation('resultado incerto sintético'); return new Promise<string>(resolve => { release = resolve }) })
  try {
    await f.send({ type: 'template.save', template: { name: 'Check', workspaceId: f.workspace.id, title: 'Check', objective: 'Confira os arquivos', mode: 'agentica', squadId: null, isolation: null, lead: { cli: 'codex', model: null, effort: 'medium' }, cards: [] } })
    const template = f.core.store.snapshot().templates[0]!
    await f.send({ type: 'schedule.save', schedule: { name: 'Check', workspaceId: f.workspace.id, templateId: template.id, enabled: true, skipIfRunning: false, translationAccountId: 'codex', when: { kind: 'interval', hours: 6 } } })
    let schedule = f.core.store.schedules()[0]!
    const count = f.core.store.snapshot().missions.length
    await (f.core as any).runSchedule(schedule, schedule.nextRunAt, false)
    schedule = f.core.store.schedule(schedule.id)!
    assert.equal(schedule.enabled, false); assert.equal(schedule.nextRunAt, null)
    assert.match(schedule.lastResult!, /pausado/)
    f.core.tickSchedules(Date.now() + 86400000)
    assert.equal(calls, 1); assert.equal(f.core.store.snapshot().missions.length, count)
    const running = f.send({ type: 'schedule.run', scheduleId: schedule.id })
    await Promise.resolve()
    await f.send({ type: 'schedule.delete', scheduleId: schedule.id })
    release('Check the files'); await running
    assert.equal(f.core.store.schedule(schedule.id), undefined)
    assert.equal(f.core.store.snapshot().missions.length, count)
  } finally { await f.close() }
})

test('an expanded translation is never silently truncated before initial mission launch', async () => {
  const f = await fixture(async () => 'x'.repeat(4001))
  try {
    const count = f.core.store.snapshot().missions.length
    const result = await f.send({ type: 'mission.create', requestId: 'expanded', workspaceId: f.workspace.id, title: 'Check', objective: 'Confira', mode: 'agentica', translationAccountId: 'codex', lead: { cli: 'codex', model: null, title: '' } })
    assert.equal(result.type, 'mission.create.error'); assert.match(result.message, /4.000/)
    assert.equal(f.core.store.snapshot().missions.length, count)
  } finally { await f.close() }
})

test('mission receipt queries never translate or launch and recover only proven terminal admission failures', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; throw new Error('must never translate') })
  try {
    const journal = new InputJournal(f.root), scope = `new-${f.workspace.id}`
    const records = [
      ['legacy-quota', { state: 'submitting', error: 'Não há conta do Claude com folga para abrir o agente: todas as contas estão no limite.' }, 'failed'],
      ['uncertain', { state: 'submitting', error: 'PTY interrupted' }, 'pending'],
      ['translation', { state: 'translating' }, 'pending'],
      ['failed', { state: 'failed', error: 'Rejected' }, 'failed'],
      ['acked', { state: 'acked', missionId: f.pane.missionId }, 'acked'],
    ] as const
    const launches = f.launches.length
    for (const [id, value, expected] of records) {
      const record = { fingerprint: 'immutable', original: 'Original', ...value }
      journal.save(scope, id, record)
      const result = await f.send({ type: 'mission.check', workspaceId: f.workspace.id, requestId: id })
      assert.equal(result.type, 'mission.checked'); assert.equal(result.state, expected)
      assert.deepEqual(journal.get(scope, id), record, 'consultation preserves original journal')
    }
    assert.equal((await f.send({ type: 'mission.check', workspaceId: f.workspace.id, requestId: 'missing' })).state, 'missing')
    assert.equal(calls, 0); assert.equal(f.launches.length, launches)
  } finally { await f.close() }
})

test('a quota admission rejection is terminal, preserves original, and never repeats the failed launch', async () => {
  let translations = 0
  const f = await fixture(async () => { translations++; throw new Error('unexpected translation') })
  try {
    const now = Date.now()
    for (const account of f.core.store.accounts().filter(a => a.cli === 'claude')) f.core.store.setLimits({ accountId: account.id, cli: account.cli, source: 'provider', fiveHour: { usedPercent: 100, resetsAt: now + 3600000, windowMinutes: 300 }, weekly: null, updatedAt: now, plan: null })
    const message = { type: 'mission.create', workspaceId: f.workspace.id, title: 'Quota QA', objective: '', mode: 'livre', requestId: 'quota-refused', lead: { cli: 'claude', model: null, title: '' } } as const
    const launches = f.launches.length
    const first = await f.send(message)
    assert.equal(first.type, 'mission.create.error'); assert.equal(first.pending, false); assert.match(first.message, /Não há conta/)
    const journal = new InputJournal(f.root).get(`new-${f.workspace.id}`, message.requestId)!
    assert.equal(journal.state, 'failed'); assert.equal(journal.original, '')
    assert.equal((await f.send(message)).pending, false)
    assert.equal((await f.send({ type: 'mission.check', workspaceId: f.workspace.id, requestId: message.requestId })).state, 'failed')
    assert.equal(f.launches.length, launches); assert.equal(translations, 0)
  } finally { await f.close() }
})

test('a translation prepared for an old execution is never submitted into a replacement terminal', async () => {
  let translated!: (value: string) => void
  const f = await fixture(() => new Promise(resolve => { translated = resolve }))
  try {
    const sending = f.send({ type: 'pane.submit', dispatch: 'continue', paneId: f.pane.id, text: 'Mensagem para o processo original', requestId: 'epoch-race', translationAccountId: 'codex' })
    // Same stable pane, different process while the translator is in flight.
    await f.core.handle({ type: 'pane.restart', paneId: f.pane.id, resume: false })
    translated('Message for the original process')
    const result = await sending
    assert.equal(result.type, 'pane.submit.error')
    assert.match(result.message, /execução.*mudou/)
    assert.equal(f.sent.length, 0)
    assert.notEqual(f.core.store.pane(f.pane.id)?.executionEpoch, f.pane.executionEpoch)
  } finally { await f.close() }
})
