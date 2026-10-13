import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server.ts'
import type { AgentLaunch } from '../src/command.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

const folder = (name: string) => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))), name)
  mkdirSync(dir)
  return dir
}

const fakeAgent = (launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `echo "FAKE dirs=${(launch.addDirs ?? []).join(',')}"; exec ${shell}`] })

test('a workspace can hold several folders and every agent gets all of them', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', agentCommand: fakeAgent })
  const ui = connect(server.port)
  try {
    await ui.opened
    await ui.next('snapshot')
    const front = folder('front')
    const back = folder('back')

    // Bad input is refused before anything is stored.
    ui.send({ type: 'workspace.create', name: '', folders: [front, 'relativo/pasta'] })
    assert.match((await ui.next('error')).message, /Pasta não encontrada: relativo\/pasta/)
    ui.send({ type: 'workspace.create', name: '', folders: [] })
    assert.match((await ui.next('error', (m) => /pelo menos uma/.test(m.message))).message, /pelo menos uma pasta/)

    ui.send({ type: 'workspace.create', name: '', folders: [front, back, front] })
    const { workspace } = await ui.next('workspace.updated')
    assert.deepEqual(workspace.folders, [front, back], 'duplicates dropped, order kept')
    assert.equal(workspace.path, front)
    assert.equal(workspace.name, 'front + 1')

    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Duas pastas', objective: '', mode: 'livre', lead: { cli: 'claude', model: null, title: '' } })
    const { pane } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    assert.equal(pane.cwd, front, 'agents start in the main folder')
    await ui.next('pane.data', (m) => m.paneId === pane.id && m.data.includes(`FAKE dirs=${back}`))
    const role = readFileSync(join(dataDir, 'panes', String(pane.id), 'role.md'), 'utf8')
    assert.match(role, /Este workspace tem 2 pastas/)
    assert.ok(role.includes(`- ${front} (pasta principal`) && role.includes(`- ${back}`))

    // Renaming and reordering: the first folder becomes the main one.
    ui.send({ type: 'workspace.update', workspaceId: workspace.id, name: 'Produto', folders: [back, front] })
    const { workspace: updated } = await ui.next('workspace.updated', (m) => m.workspace.name === 'Produto')
    assert.equal(updated.path, back)
    assert.deepEqual(updated.folders, [back, front])
  } finally {
    ui.ws.close()
    await server.close()
  }
})

test('state files from before multi-folder workspaces still load', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const old = folder('antigo')
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify({
    version: 1, nextPaneId: 1, missions: [], panes: [], events: [], customSquads: [],
    workspaces: [{ id: 'w1', path: old, name: 'antigo', lastOpenedAt: 1 }],
  }))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh' })
  const ui = connect(server.port)
  try {
    await ui.opened
    const { snapshot } = await ui.next('snapshot')
    assert.deepEqual(snapshot.workspaces[0]!.folders, [old])
    // Opening the same single folder reuses that workspace.
    ui.send({ type: 'workspace.open', path: old })
    const { workspace } = await ui.next('workspace.updated')
    assert.equal(workspace.id, 'w1')
  } finally {
    ui.ws.close()
    await server.close()
  }
})
