import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { OrbitClient, OrbitRequestTimeout } from '../../../apps/desktop/src/orbit/client.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const until = async (check: () => boolean) => {
  const deadline = Date.now() + 8000
  while (!check()) { if (Date.now() > deadline) throw new Error('recovery deadline'); await new Promise(r => setTimeout(r, 10)) }
}

test('real core/WebSocket/PTY: lost receipt reconciles once, reconnect restores Unicode and resize, restart changes port without replaying input', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-recovery-'))
  const start = () => startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, browser: null, scheduler: false })
  let server = await start()
  const setup = connect(server.port)
  await setup.opened
  setup.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-recovery-ws-'))) })
  const { workspace } = await setup.next('workspace.updated')
  setup.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Recovery', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: '' } })
  const { pane } = await setup.next('pane.updated')
  const originalEpoch = pane.executionEpoch
  setup.ws.close()

  const real = globalThis.WebSocket
  const sockets: WebSocket[] = []
  class UiSocket extends WebSocket {
    constructor(url: string) { super(url, { origin: ORIGIN }); sockets.push(this) }
  }
  globalThis.WebSocket = UiSocket as any
  const client = new OrbitClient(async () => `ws://127.0.0.1:${server.port}/ws?token=${TOKEN}`)
  // Deterministically lose just the first wire receipt, after the PTY accepted its Enter.
  const receive = (client as any).receive.bind(client)
  let lost = false
  ;(client as any).receive = (message: any) => {
    if (!lost && message.type === 'pane.submitted') { lost = true; sockets.at(-1)!.terminate(); return }
    receive(message)
  }
  let screen = '', output = '', snapshots = 0, cols = 0, rows = 0
  const detach = client.attachPane(pane.id, { snapshot: m => { screen = m.data; output = ''; snapshots++; cols = m.cols; rows = m.rows }, data: data => { output += data }, resized: (c, r) => { cols = c; rows = r } })
  try {
    await until(() => client.getState().connection === 'open' && snapshots > 0)
    client.inputDrafts.set(`pane-${pane.id}`, { text: 'printf once', accountId: '', allowOriginal: true })
    await assert.rejects(client.submitInput({ paneId: pane.id, text: "printf 'RECOVERY_%s 界 🙂\\n' ONCE", allowOriginal: true }), OrbitRequestTimeout)
    assert(client.inputPending(`pane-${pane.id}`))
    assert.equal(client.getState().snapshotReady, false)
    await until(() => client.getState().connection === 'open')
    await client.checkPendingInput(`pane-${pane.id}`)
    assert(!client.inputPending(`pane-${pane.id}`))
    assert.equal(client.inputReceipts.get(`pane-${pane.id}`)?.executionEpoch, originalEpoch)
    assert.equal(server.core.store.snapshot().panes.length, 1)
    await until(() => (screen + output).includes('RECOVERY_ONCE 界 🙂'))
    assert.equal((screen + output).split('RECOVERY_ONCE 界 🙂').length - 1, 1)
    client.send({ type: 'pane.resize', paneId: pane.id, cols: 72, rows: 19 })
    await until(() => cols === 72 && rows === 19)
    const mirror = await server.core.paneSnapshot(pane.id)
    assert.equal(mirror?.cols, 72); assert.equal(mirror?.rows, 19)
    assert(mirror?.data.includes('RECOVERY_ONCE 界 🙂'))
    const oldPort = server.port
    await server.close()
    server = await start()
    await server.initialized
    assert.notEqual(server.port, oldPort)
    await until(() => client.getState().connection === 'open' && client.getState().panes[0]?.status === 'exited')
    assert.equal(client.getState().panes[0]?.executionEpoch, originalEpoch)
    assert.equal(client.inputReceipts.get(`pane-${pane.id}`)?.executionEpoch, originalEpoch)
    assert.equal(client.getState().panes[0]?.pid, null)
    assert.equal(client.inputPending(`pane-${pane.id}`), false)
    assert.equal(server.core.store.snapshot().panes.length, 1)
  } finally {
    detach(); client.dispose()
    await server.close()
    globalThis.WebSocket = real
  }
})

test('abrupt sidecar process death preserves inventory and does not silently reopen a sessionless orphan', async () => {
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const { readFileSync } = await import('node:fs')
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-crash-'))
  const entry = new URL('../src/server.ts', import.meta.url).href
  const source = `import {startServer} from ${JSON.stringify(entry)};
    const server=await startServer({port:0,token:${JSON.stringify(TOKEN)},allowedOrigins:[${JSON.stringify(ORIGIN)}],dataDir:${JSON.stringify(dataDir)},shell:'/bin/sh',run:async()=>({code:127,stdout:'',stderr:'offline'}),browser:null,scheduler:false});
    await server.initialized; console.log(JSON.stringify({port:server.port}));
    process.on('SIGTERM',async()=>{await server.close();process.exit(0)});`
  const launch = async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', stderr = ''
    child.stderr.on('data', data => { stderr += String(data) })
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`child startup deadline: ${stderr}`)) }, 10_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`child startup exit ${code}: ${stderr}`)) })
      child.stdout.on('data', data => {
        output += String(data)
        if (!output.includes('\n')) return
        clearTimeout(timer)
        try { resolve(JSON.parse(output.split('\n')[0]!).port) } catch (error) { reject(error) }
      })
    })
    return { child, port }
  }
  let host = await launch(), ui = connect(host.port), pid: number | null = null
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-crash-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Crash', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: '' } })
    const { pane } = await ui.next('pane.updated')
    pid = pane.pid
    await until(() => { try { return JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).panes.some((p: any) => p.id === pane.id && p.pid === pid) } catch { return false } })
    const stopped = once(host.child, 'exit')
    host.child.kill('SIGKILL'); await stopped
    ui.ws.terminate()
    host = await launch(); ui = connect(host.port)
    await ui.opened
    const { snapshot } = await ui.next('snapshot')
    assert.equal(snapshot.panes.length, 1)
    const restored = snapshot.panes[0]!
    assert.equal(restored.id, pane.id)
    assert.equal(restored.executionEpoch, pane.executionEpoch)
    assert.equal(restored.status, 'exited')
    assert.equal(restored.pid, null)
    assert.equal(restored.sessionId, null)
    ui.send({ type: 'pane.restart', paneId: pane.id, resume: true })
    assert.match((await ui.next('error')).message, /Não há conversa para retomar/)
  } finally {
    ui.ws.terminate()
    if (host.child.exitCode === null && host.child.signalCode === null) { const stopped = once(host.child, 'exit'); host.child.kill('SIGTERM'); await stopped }
    if (pid) { try { process.kill(pid, 'SIGTERM') } catch { /* PTY hangup already stopped our fixture shell */ } }
  }
})
