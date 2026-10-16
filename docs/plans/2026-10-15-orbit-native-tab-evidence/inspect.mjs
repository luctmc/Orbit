// Read-only PTY snapshot inspection; never sends input to a pane.
import { readFileSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
import headless from '@xterm/headless'
const base = new URL('./', import.meta.url)
const metadata = JSON.parse(readFileSync(new URL('metadata.json', base), 'utf8'))
const ws = new WebSocket(`ws://127.0.0.1:${metadata.port}/ws?token=${metadata.token}`, { origin: 'http://127.0.0.1:5379' })
let seen = 0
ws.on('error', error => { console.error(error.message); process.exitCode = 1 })
ws.on('open', () => metadata.panes.forEach(p => ws.send(JSON.stringify({ type: 'pane.attach', paneId: p.id }))))
ws.on('message', async raw => {
  const msg = JSON.parse(String(raw))
  if (msg.type !== 'pane.snapshot') return
  const t = new headless.Terminal({ cols: msg.cols, rows: msg.rows, allowProposedApi: true })
  await new Promise(r => t.write(msg.data, r))
  const b = t.buffer.active, lines = []
  for (let y = 0; y < b.length; y++) lines.push(b.getLine(y)?.translateToString(true) ?? '')
  const result = { id: msg.paneId, cursor: { row: b.baseY + b.cursorY, column: b.cursorX, before: b.getLine(b.baseY + b.cursorY)?.translateToString(false, 0, b.cursorX), after: b.getLine(b.baseY + b.cursorY)?.translateToString(true, b.cursorX) }, lines }
  const label = process.argv[2] ?? 'inspection'
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid evidence label')
  writeFileSync(new URL(`${label}-${msg.paneId}.json`, base), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result)); t.dispose()
  if (++seen === metadata.panes.length) ws.close()
})
setTimeout(() => ws.close(), 5000).unref()
