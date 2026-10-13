import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCommand, paneEnv } from '../src/command.ts'

test('shell panes start a login shell', () => {
  assert.deepEqual(buildCommand('shell', null, '/bin/zsh'), { file: '/bin/zsh', args: ['-l'] })
})

test('agent panes run the CLI with the model, then fall back to a shell', () => {
  assert.deepEqual(buildCommand('claude', 'claude-opus-5-5', '/bin/zsh'), {
    file: '/bin/zsh',
    args: ['-l', '-c', 'claude --model claude-opus-5-5; exec /bin/zsh -l'],
  })
  assert.deepEqual(buildCommand('codex', null, '/bin/bash').args, ['-l', '-c', 'codex; exec /bin/bash -l'])
})

test('model ids that could inject shell syntax are rejected', () => {
  assert.throws(() => buildCommand('claude', 'opus; rm -rf ~', '/bin/zsh'), /Modelo inválido/)
  assert.throws(() => buildCommand('codex', '$(whoami)', '/bin/zsh'), /Modelo inválido/)
})

test('pane env drops Orbit secrets and adds pane identity', () => {
  const env = paneEnv({ PATH: '/usr/bin', ORBIT_TOKEN: 'secret', VITE_ORBIT_TOKEN: 'secret' }, { ORBIT_PANE_ID: '7' })
  assert.equal(env.ORBIT_TOKEN, undefined)
  assert.equal(env.VITE_ORBIT_TOKEN, undefined)
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.ORBIT_PANE_ID, '7')
  assert.equal(env.TERM, 'xterm-256color')
})
