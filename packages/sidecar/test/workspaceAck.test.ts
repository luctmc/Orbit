import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerMessage } from '@orbit/protocol'
import { OrbitCore } from '../src/core.ts'
import { offline } from './helpers.ts'
test('workspace saves reply only after durable persistence and keep failed edits out of memory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-workspace-ack-')), dataDir = join(root, 'data')
  const core = new OrbitCore({ dataDir, shell: '/bin/sh', run: offline, browser: null, broadcast: () => {} })
  const replies: ServerMessage[] = [], reply = (m: ServerMessage) => { replies.push(m) }
  try {
    core.handle({ type: 'workspace.create', name: 'Project', folders: [root], requestId: 'create' }, reply)
    assert.equal(replies.at(-1)?.type, 'workspace.saved')
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).workspaces.length, 1)
    const workspace = core.store.snapshot().workspaces[0]!
    core.handle({ type: 'workspace.update', workspaceId: workspace.id, name: 'Renamed', requestId: 'edit' }, reply)
    assert.equal(replies.at(-1)?.type, 'workspace.saved')
    mkdirSync(join(dataDir, 'state.json.tmp'))
    core.handle({ type: 'workspace.update', workspaceId: workspace.id, name: 'Must roll back', requestId: 'failure' }, reply)
    assert.equal(replies.at(-1)?.type, 'workspace.error')
    assert.equal(core.store.workspace(workspace.id)?.name, 'Renamed')
    rmSync(join(dataDir, 'state.json.tmp'), { recursive: true })
  } finally { await core.shutdown() }
})
