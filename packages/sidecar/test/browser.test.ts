import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { browserUrl, findBrowser } from '../src/browser.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

test('addresses: http(s) only, with the scheme filled in', () => {
  assert.equal(browserUrl('localhost:5173'), 'http://localhost:5173/')
  assert.equal(browserUrl('127.0.0.1:3000/app'), 'http://127.0.0.1:3000/app')
  assert.equal(browserUrl('exemplo.com'), 'https://exemplo.com/')
  assert.equal(browserUrl('https://exemplo.com:8443/x?y=1'), 'https://exemplo.com:8443/x?y=1')
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', ' ']) assert.throws(() => browserUrl(bad))
})

test('the browser is found by path, or not at all', () => {
  const only = (path: string) => (p: string) => p === path
  assert.equal(findBrowser({}, only('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'))?.name, 'Brave')
  assert.equal(findBrowser({ ORBIT_BROWSER: '/opt/chromium' }, only('/opt/chromium'))?.path, '/opt/chromium')
  assert.equal(findBrowser({}, () => false), null)
})

const PAGE = `<!doctype html><title>Painel</title>
<h1 id="t">Olá do app</h1>
<input id="nome"><button id="b" onclick="document.getElementById('t').textContent = 'Oi, ' + document.getElementById('nome').value; console.log('clicou')">Enviar</button>
<script>fetch('/sumiu')</script>`

const engine = findBrowser()

test('agents and the person share the mission browser', { skip: engine ? false : 'nenhum navegador Chromium instalado' }, async () => {
  const site = createServer((req, res) => {
    if (req.url === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE)
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  const sitePort = (site.address() as { port: number }).port
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, browser: engine })
  const ui = connect(server.port)
  let mcp: Client | null = null
  try {
    await ui.opened
    await ui.next('browser.engine', (m) => m.name === engine!.name)
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Navegador', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    const { pane } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    ui.send({ type: 'pane.input', paneId: pane.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === pane.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const call = async (name: string, args: Record<string, unknown> = {}) => (await mcp!.callTool({ name, arguments: args })) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }

    // Before anything is open, reading says so.
    assert.match((await call('browser_text')).content[0]!.text!, /não está aberto/)

    // The person watches; the agent opens the app.
    ui.send({ type: 'browser.watch', missionId: mission.id, on: true })
    const opened = JSON.parse((await call('browser_open', { url: `localhost:${sitePort}` })).content[0]!.text!)
    assert.equal(opened.title, 'Painel')
    await ui.next('browser.state', (m) => m.browser.missionId === mission.id && m.browser.title === 'Painel' && m.browser.lastActor === `#${pane.id}`)
    await ui.next('event.added', (m) => m.event.kind === 'browser' && m.event.body.includes(`localhost:${sitePort}`))
    const frame = await ui.next('browser.frame', (m) => m.missionId === mission.id, 10_000)
    assert.ok(Buffer.from(frame.data, 'base64').subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'frames are JPEG')

    assert.match((await call('browser_text')).content[0]!.text!, /Olá do app/)
    await call('browser_click', { selector: '#nome' })
    await call('browser_type', { text: 'Lucas' })
    await call('browser_click', { selector: '#b' })
    assert.match((await call('browser_text')).content[0]!.text!, /Oi, Lucas/)
    const consoleText = (await call('browser_console')).content[0]!.text!
    assert.match(consoleText, /log: clicou/)
    assert.match(consoleText, /404/, 'failed requests show up')
    const shot = (await call('browser_screenshot')).content[0]!
    assert.equal(shot.type, 'image')
    assert.ok(Buffer.from(shot.data!, 'base64').subarray(1, 4).equals(Buffer.from('PNG')))
    assert.match((await call('browser_click', { selector: '#nada' })).content[0]!.text!, /Nada na página/)
    assert.match((await call('browser_open', { url: 'file:///etc/hosts' })).content[0]!.text!, /só abre endereços http/)

    // The person clicks and types in the same page (coordinates of the page).
    ui.send({ type: 'browser.navigate', missionId: mission.id, url: `http://127.0.0.1:${sitePort}/` })
    await ui.next('browser.state', (m) => m.browser.lastActor === 'você' && !m.browser.loading && m.browser.url.startsWith('http://127.0.0.1'))

    // Archiving the mission closes its page.
    ui.send({ type: 'mission.archive', missionId: mission.id })
    await ui.next('browser.closed', (m) => m.missionId === mission.id)
  } finally {
    await mcp?.close()
    ui.ws.close()
    await server.close()
    site.close()
  }
})
