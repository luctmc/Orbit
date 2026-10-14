import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Run } from '../src/clis.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

const TARBALL = Buffer.from('conteúdo do Orbit.app.tar.gz')
const MANIFEST = {
  version: '0.2.0',
  notes: 'Novidades',
  pub_date: '2026-10-14T00:00:00Z',
  platforms: { 'darwin-aarch64': { signature: 'assinatura', url: 'Orbit_0.2.0_aarch64.app.tar.gz' } },
}

/** Stands in for `gh`: a release (or none, or no login) and downloads into --dir. */
function fakeGh(state: { release: 'none' | 'ok' | 'logout'; downloads: string[] }): Run {
  return async (command) => {
    if (command.startsWith('gh release view')) {
      if (state.release === 'none') return { code: 1, stdout: '', stderr: 'release not found' }
      if (state.release === 'logout') return { code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }
      return { code: 0, stdout: JSON.stringify({ tagName: 'v0.2.0', assets: [{ name: 'latest.json' }, { name: 'Orbit_0.2.0_aarch64.app.tar.gz' }] }), stderr: '' }
    }
    const download = /^gh release download '([^']+)' --repo [\w./-]+ --pattern '([^']+)' --dir '([^']+)' --clobber$/.exec(command)
    if (download) {
      const [, , name, dir] = download
      state.downloads.push(name!)
      mkdirSync(dir!, { recursive: true })
      writeFileSync(join(dir!, name!), name === 'latest.json' ? JSON.stringify(MANIFEST) : TARBALL)
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
}

test("the updater plugin gets Orbit's releases through the sidecar, with the UI token only", async () => {
  const state: { release: 'none' | 'ok' | 'logout'; downloads: string[] } = { release: 'none', downloads: [] }
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-data-')), shell: '/bin/sh', run: fakeGh(state), browser: null })
  const ui = connect(server.port)
  const base = `http://127.0.0.1:${server.port}`
  const get = (path: string, headers: Record<string, string> = { 'x-orbit-token': TOKEN }) => fetch(`${base}${path}`, { headers })
  try {
    await ui.opened
    await ui.next('update.status', (m) => m.status.repo === 'luctmc/Orbit')

    assert.equal((await get('/update/latest.json', {})).status, 401)
    assert.equal((await get('/update/latest.json', { 'x-orbit-token': 'outro' })).status, 401)
    assert.equal((await get('/update/latest.json', { 'x-orbit-token': TOKEN, origin: 'https://exemplo.com' })).status, 403, 'web pages cannot ask')

    // No release yet: 204 means "up to date" to the plugin.
    assert.equal((await get('/update/latest.json')).status, 204)

    state.release = 'ok'
    const res = await get('/update/latest.json')
    assert.equal(res.status, 200)
    const manifest = await res.json()
    assert.equal(manifest.version, '0.2.0')
    assert.equal(manifest.platforms['darwin-aarch64'].signature, 'assinatura')
    assert.equal(manifest.platforms['darwin-aarch64'].url, `${base}/update/files/v0.2.0/Orbit_0.2.0_aarch64.app.tar.gz`)
    await ui.next('update.status', (m) => m.status.latest === 'v0.2.0' && m.status.error === null)

    const file = await get('/update/files/v0.2.0/Orbit_0.2.0_aarch64.app.tar.gz')
    assert.equal(file.status, 200)
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), TARBALL)
    await get('/update/files/v0.2.0/Orbit_0.2.0_aarch64.app.tar.gz')
    assert.equal(state.downloads.filter((n) => n.endsWith('.tar.gz')).length, 1, 'downloaded once, then served from the cache')
    assert.equal((await get('/update/files/v0.2.0/..%2F..%2Fstate.json')).status, 502)
    assert.equal((await get('/update/files/v9/Orbit_0.2.0_aarch64.app.tar.gz')).status, 502, 'only the release the manifest came from')

    state.release = 'logout'
    const failed = await get('/update/latest.json')
    assert.equal(failed.status, 502)
    assert.match(await failed.text(), /gh auth login/)
    await ui.next('update.status', (m) => /gh auth login/.test(m.status.error ?? ''))
  } finally {
    ui.ws.close()
    await server.close()
  }
})

test('a release folder can stand in for GitHub, to try an update before publishing', async () => {
  const { Updates } = await import('../src/updates.ts')
  const dir = mkdtempSync(join(tmpdir(), 'orbit-release-'))
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(MANIFEST))
  writeFileSync(join(dir, 'Orbit_0.2.0_aarch64.app.tar.gz'), TARBALL)
  const never: Run = async () => assert.fail('gh is not used with a local folder')
  const updates = new Updates(never, mkdtempSync(join(tmpdir(), 'orbit-cache-')), 'luctmc/Orbit', dir)
  const manifest = await updates.manifest('http://127.0.0.1:1')
  assert.equal(manifest!.platforms['darwin-aarch64'].url, 'http://127.0.0.1:1/update/files/v0.2.0/Orbit_0.2.0_aarch64.app.tar.gz')
  assert.deepEqual(readFileSync((await updates.file('v0.2.0', 'Orbit_0.2.0_aarch64.app.tar.gz')).path), TARBALL)
  assert.match(updates.status.repo, /^pasta /)
})
