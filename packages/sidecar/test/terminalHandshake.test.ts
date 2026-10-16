import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaneManager } from '../src/panes.ts'

test('a native TUI receives terminal cursor replies even when no desktop terminal is attached', async () => {
  const manager = new PaneManager('/bin/sh', () => ({ file: process.execPath, args: ['-e', `
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('data', data => { if (data.toString().includes('R')) { console.log('HANDSHAKE_COMPLETE'); process.exit(0) } });
    process.stdout.write('\\x1b[6n');
  `] }))
  let timer: NodeJS.Timeout | undefined
  const received = new Promise<boolean>(resolve => {
    manager.on('data', (_id, data) => { if (data.includes('HANDSHAKE_COMPLETE')) resolve(true) })
    timer = setTimeout(() => resolve(false), 1000)
  })
  manager.spawn({ id: 1, request: { missionId: 'm', role: 'crew', cli: 'codex', model: null, title: 'Handshake' }, squadRole: null, taskType: null, cwd: '/private/tmp', launch: { cli: 'codex', model: null }, env: {}, hookDriven: false, accountId: null })
  try { assert.equal(await received, true, 'the headless terminal must answer DSR instead of waiting for a UI mount') }
  finally { clearTimeout(timer); manager.killAll(); await manager.waitForExit() }
})
