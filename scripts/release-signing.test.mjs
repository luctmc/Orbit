import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('release refuses an invalid macOS bundle before creating assets even when the build exits successfully', { skip: process.platform !== 'darwin' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-release-signing-test-'))
  try {
    const scripts = join(root, 'scripts'), desktop = join(root, 'apps/desktop'), tauri = join(desktop, 'src-tauri'), bundle = join(tauri, 'target/release/bundle/macos'), bin = join(root, 'bin')
    for (const dir of [scripts, bundle, bin]) mkdirSync(dir, { recursive: true })
    copyFileSync(new URL('./release.mjs', import.meta.url), join(scripts, 'release.mjs'))
    writeFileSync(join(tauri, 'tauri.conf.json'), JSON.stringify({ version: '0.1.0' }))
    writeFileSync(join(tauri, 'Cargo.lock'), 'name = "orbit-desktop"\nversion = "0.1.0"\n')
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'apps/desktop': { version: '0.1.0' } } }))
    mkdirSync(join(bundle, 'Orbit.app')) // Intentionally unsigned/invalid; never the user's app.
    writeFileSync(join(bundle, 'Orbit.app.tar.gz'), 'synthetic archive')
    writeFileSync(join(bundle, 'Orbit.app.tar.gz.sig'), 'synthetic signature')
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'npm'), 0o700)
    const result = spawnSync(process.execPath, [join(scripts, 'release.mjs'), '0.1.0'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, TAURI_SIGNING_PRIVATE_KEY: 'synthetic-not-a-key', ORBIT_UPDATE_REPO: 'fixture/example' },
    })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /bundle macOS falhou na verificação codesign/)
    assert.equal(existsSync(join(root, 'dist-release')), false, 'no assets may be created for an invalid app')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
