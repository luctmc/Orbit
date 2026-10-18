import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import headless from '@xterm/headless'
import type { ServerMessage } from '@orbit/protocol'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, offline } from './helpers.ts'

type Term = InstanceType<typeof headless.Terminal>

const render = async (cols: number, rows: number, data: string): Promise<Term> => {
  const term = new headless.Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
  await new Promise<void>((resolve) => term.write(data, resolve))
  return term
}
const lines = (term: Term) => {
  const buffer = term.buffer.active
  return Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y)?.translateToString(true) ?? '').join('\n').trimEnd()
}

// A TUI-style frame: text placed with absolute cursor moves, like Claude Code's status line.
const FRAME = 'printf "\\033[2J\\033[1;1Hlinha do topo\\033[1;90Hcanto direito\\033[3;1Hresumo final da missao\\n"'

test('a view rebuilt from the snapshot matches the PTY screen; a raw replay at another width does not', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline })
  const ui = connect(server.port)
  try {
    await ui.opened
    await ui.next('snapshot')
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'tela', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: '' } })
    const { pane } = await ui.next('pane.updated')

    ui.send({ type: 'pane.resize', paneId: pane.id, cols: 106, rows: 20 })
    // Every view hears about it, so none keeps drawing at the old width.
    await ui.next('pane.resized', (m) => m.paneId === pane.id && m.cols === 106 && m.rows === 20)
    ui.send({ type: 'pane.input', paneId: pane.id, data: `${FRAME}\r` })
    await ui.next('pane.data', (m) => m.paneId === pane.id && m.data.includes('resumo final'))
    await new Promise((r) => setTimeout(r, 150))

    // What the old code did: replay every raw byte into a fresh 80-column view.
    const raw = ui.inbox.filter((m): m is Extract<ServerMessage, { type: 'pane.data' }> => m.type === 'pane.data' && m.paneId === pane.id).map((m) => m.data).join('')
    const truth = await render(106, 20, raw)
    assert.match(lines(truth), /linha do topo {76}canto direito/)
    assert.notEqual(lines(await render(80, 24, raw)), lines(truth), 'raw replay at another width scrambles the screen')

    ui.send({ type: 'pane.attach', paneId: pane.id })
    const snapshot = await ui.next('pane.snapshot', (m) => m.paneId === pane.id)
    assert.deepEqual([snapshot.cols, snapshot.rows], [106, 20])
    assert.equal(lines(await render(snapshot.cols, snapshot.rows, snapshot.data)), lines(truth))

    // Output after the snapshot keeps flowing to the view.
    ui.send({ type: 'pane.input', paneId: pane.id, data: 'echo depois-do-snapshot\r' })
    await ui.next('pane.data', (m) => m.paneId === pane.id && m.data.includes('depois-do-snapshot') && ui.inbox.indexOf(m) > ui.inbox.indexOf(snapshot))
  } finally {
    ui.ws.close()
    await server.close()
  }
})

test('a closed pane has no snapshot; an exited one keeps its last screen', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline })
  const ui = connect(server.port)
  try {
    await ui.opened
    await ui.next('snapshot')
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'fim', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: '' } })
    const { pane } = await ui.next('pane.updated')
    ui.send({ type: 'pane.input', paneId: pane.id, data: 'echo ultima-linha; exit\r' })
    await ui.next('pane.updated', (m) => m.pane.id === pane.id && m.pane.status === 'exited')

    ui.send({ type: 'pane.attach', paneId: pane.id })
    const snapshot = await ui.next('pane.snapshot', (m) => m.paneId === pane.id)
    assert.match(snapshot.data, /ultima-linha/)

    ui.send({ type: 'pane.close', paneId: pane.id })
    await ui.next('pane.removed')
    const before = ui.inbox.length
    ui.send({ type: 'pane.attach', paneId: pane.id })
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(ui.inbox.slice(before).filter((m) => m.type === 'pane.snapshot').length, 0)
  } finally {
    ui.ws.close()
    await server.close()
  }
})

test('snapshot serializes at its parser boundary, before later output in the same xterm batch', async () => {
  const { PaneManager } = await import('../src/panes.ts')
  const { default: serialize } = await import('@xterm/addon-serialize')
  const manager = new PaneManager('/bin/sh')
  const term = new headless.Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  const serializer = new serialize.SerializeAddon()
  term.loadAddon(serializer)
  // A real xterm mirror, with no process timing involved in this exact parser interleaving.
  ;(manager as any).screens.set(1, { term, serializer })
  try {
    term.write('BEFORE_BOUNDARY\r\n')
    const pending = manager.snapshot(1)
    term.write('AFTER_BOUNDARY 界 🙂\r\n')
    const snapshot = await pending
    assert(snapshot)
    assert.match(snapshot.data, /BEFORE_BOUNDARY/)
    assert.doesNotMatch(snapshot.data, /AFTER_BOUNDARY/)
    await new Promise<void>(resolve => term.write('', resolve))
    assert.match(manager.screenText(1, 100), /AFTER_BOUNDARY 界 🙂/)
    const restored = await render(snapshot.cols, snapshot.rows, snapshot.data + 'AFTER_BOUNDARY 界 🙂\r\n')
    assert.equal(lines(restored).split('AFTER_BOUNDARY').length - 1, 1)
    restored.dispose()
  } finally { term.dispose() }
})
