import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { offline } from './helpers.ts'

test('shell spawn never opens project package.json (FIFO cannot stall the motor)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-spawn-block-'))
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null, run: offline, broadcast: () => {} })
  let release: ReturnType<typeof spawn> | undefined
  try {
    core.handle({ type: 'workspace.open', path: root })
    core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'Reopen result', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const missionId = core.store.snapshot().missions[0]!.id
    const fifo = join(root, 'package.json')
    execFileSync('/usr/bin/mkfifo', [fifo])
    // A separate process releases an accidental blocking read, so a regression fails instead of hanging CI.
    release = spawn(process.execPath, ['-e', `setTimeout(()=>{require('fs').writeFileSync(process.argv[1],'{}')},700)`, fifo], { stdio: 'ignore' })
    const started = performance.now()
    const replies: any[] = []
    await core.handle({ type: 'pane.spawn', requestId: 'fifo', request: { missionId, role: 'crew', cli: 'shell', model: null, title: 'No metadata needed' } }, m => replies.push(m))
    const elapsed = performance.now() - started
    assert.equal(replies[0]?.type, 'pane.spawned')
    assert.ok(elapsed < 400, `spawn blocked for ${Math.round(elapsed)}ms on package.json`)
  } finally {
    release?.kill('SIGKILL')
    await core.shutdown()
    rmSync(root, { recursive: true, force: true })
  }
})

test('design metadata skips FIFOs, bounds huge manifests and never blocks the event loop', async () => {
  const { projectDesignContext } = await import('../src/designSkills.ts')
  const { writeFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'orbit-design-block-'))
  try {
    const file = join(root, 'package.json')
    execFileSync('/usr/bin/mkfifo', [file])
    let heartbeat = false
    const tick = setTimeout(() => { heartbeat = true }, 0)
    assert.equal(await projectDesignContext([root]), '')
    await new Promise(r => setTimeout(r, 1))
    assert.ok(heartbeat)
    clearTimeout(tick)
    rmSync(file)
    writeFileSync(file, JSON.stringify({ dependencies: { react: 'fixture' }, padding: 'a'.repeat(150000) }))
    assert.equal(await projectDesignContext([root]), '')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
