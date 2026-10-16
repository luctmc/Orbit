import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import './helpers.ts'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
test('a native delivery stays durable during startup and a permission prompt, then sends once ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-delivery-startup-'))
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
    broadcast: () => {}, run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'printf "READY\\n"; while read line; do :; done'] }),
  })
  core.setEndpoint('http://127.0.0.1:1')
  try {
    core.handle({ type: 'workspace.open', path: root })
    core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
      title: 'Startup delivery', objective: '', mode: 'agentica', lead: { cli: 'claude', model: null, title: 'Lead' } })
    const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
    const { pane } = await core.spawnHelper(lead, { cli: 'claude', model: null, task: 'Synthetic activity', title: 'Worker' })
    const result = core.handoff(pane, { summary: 'Durable work', evidence: 'Synthetic check exit 0' })
    const notice = () => core.store.notifications(lead.missionId)[0]!
    await delay(180)
    assert.equal(notice().state, 'persisted', 'startup is not proof that the native input listener is ready')
    core.hookReport(lead.id, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Needs permission' })
    await delay(1300)
    core.dispatchDeliveries(lead.missionId)
    await delay(180)
    assert.equal(notice().state, 'persisted', 'a result must not be pasted into a permission dialog')
    core.hookReport(lead.id, { hook_event_name: 'SessionStart' })
    core.dispatchDeliveries(lead.missionId)
    await delay(180)
    assert.equal(notice().state, 'pty_accepted')
    assert.equal(notice().resultId, result.resultId)
    assert.equal(notice().deliveries.length, 1)
    assert.equal(core.acknowledgeDelivery(core.store.pane(lead.id)!, notice().id).state, 'agent_acknowledged')
  } finally { await core.shutdown() }
})
