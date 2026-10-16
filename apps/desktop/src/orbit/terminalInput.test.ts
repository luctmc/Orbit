import { test } from 'node:test'
import assert from 'node:assert/strict'
import { terminalDeviceReply } from './terminalInput.ts'
test('rendered terminals leave device replies to the engine and preserve real input', () => {
  for (const data of ['\x1b[1;1R', '\x1b[?1;1R', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[0n', '\x1b[?2026;2$y']) assert.equal(terminalDeviceReply(data), true)
  for (const data of ['oi', '\r', '\x1b[A', '\x1b[1;2A', '\x1b[200~paste\x1b[201~', 'text\x1b[1;1R']) assert.equal(terminalDeviceReply(data), false)
})
