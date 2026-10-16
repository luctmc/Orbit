import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import './helpers.ts'

export async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-epoch-'))
  const create = () => {
    const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
      broadcast: () => {}, run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
      agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'printf "READY\\n"; while read line; do :; done'] }) })
    core.setEndpoint('http://127.0.0.1:1')
    return core
  }
  const core = create()
  core.handle({ type: 'workspace.open', path: root })
  core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'Epoch', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  const { pane } = await core.spawnHelper(lead, { title: 'Worker', task: 'Read synthetic input', cli: 'claude', model: null })
  return { core, pane, lead, create, root }
}

