import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { buildCommand, type AgentLaunch } from '../src/command.ts'
import './helpers.ts'

test('Codex permissions match the activity on launch and restart, independent of CLI defaults', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-codex-permissions-'))
  const launches: AgentLaunch[] = []
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
    broadcast: () => {}, run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
    agentCommand: launch => { launches.push(structuredClone(launch)); return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] } },
  })
  core.setEndpoint('http://127.0.0.1:1')
  try {
    core.handle({ type: 'workspace.open', path: root })
    core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
      title: 'Permission contract', objective: '', mode: 'agentica',
      lead: { cli: 'codex', model: 'gpt-6-luna', effort: 'low', title: 'Lead' },
    })
    const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
    const { pane: worker } = await core.spawnHelper(lead, { cli: 'codex', model: 'gpt-6-luna', effort: 'low', taskTypeId: 'bug', task: 'Implement the bounded fix', title: 'Worker' })
    await core.spawnHelper(lead, { cli: 'codex', model: 'gpt-6-luna', effort: 'low', readOnly: true, requireReadOnlySandbox: true, task: 'Review independently', title: 'Reviewer' })
    assert.deepEqual(launches.map(l => l.sandbox), ['read-only', 'danger-full-access', 'read-only'])
    const writerCommand = buildCommand(launches[1]!, '/bin/sh').args[2]!
    assert.match(writerCommand, /--dangerously-bypass-approvals-and-sandbox/)
    assert.match(writerCommand, /--add-dir/)
    for (const launch of [launches[0]!, launches[2]!]) {
      const line = buildCommand(launch, '/bin/sh').args[2]!
      assert.match(line, /-s read-only -a never/)
      assert.doesNotMatch(line, /--dangerously-bypass-approvals-and-sandbox/)
      assert.doesNotMatch(line, /--add-dir/)
    }
    await core.handle({ type: 'pane.restart', paneId: worker.id, resume: false })
    assert.equal(launches.at(-1)!.sandbox, 'danger-full-access')
    assert.equal(core.store.executionPolicy(worker.id)?.readOnly, false)
    assert.equal(core.store.executionPolicy(lead.id)?.readOnly, true)
  } finally { await core.shutdown() }
})
