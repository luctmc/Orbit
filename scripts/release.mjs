// Builds a signed Orbit release and, with --publish, creates it on GitHub (private repo, via gh).
//
//   node scripts/release.mjs 0.2.0 --notes "O que mudou" [--publish]
//
// The update signing key comes from TAURI_SIGNING_PRIVATE_KEY or ~/.tauri/orbit-updater.key
// (password, if any, in TAURI_SIGNING_PRIVATE_KEY_PASSWORD). The app only installs updates signed
// with it, so keep it safe: losing it means published apps can no longer be updated.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const desktop = join(root, 'apps/desktop')
const tauriConf = join(desktop, 'src-tauri/tauri.conf.json')
const cargoToml = join(desktop, 'src-tauri/Cargo.toml')
const desktopPkg = join(desktop, 'package.json')
const repo = process.env.ORBIT_UPDATE_REPO ?? 'luctmc/Orbit'

const args = process.argv.slice(2)
const version = args[0]
const notesAt = args.indexOf('--notes')
const notes = notesAt === -1 ? '' : args[notesAt + 1] ?? ''
const publish = args.includes('--publish')

const fail = (message) => {
  console.error(`release: ${message}`)
  process.exit(1)
}
const semver = (v) => v.split('.').map(Number)
const newer = (a, b) => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('passe a versão, ex.: node scripts/release.mjs 0.2.0 --notes "…"')
const conf = JSON.parse(readFileSync(tauriConf, 'utf8'))
if (version !== conf.version && !newer(version, conf.version)) fail(`${version} não é mais nova que ${conf.version}`)

const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? (existsSync(join(homedir(), '.tauri/orbit-updater.key')) ? readFileSync(join(homedir(), '.tauri/orbit-updater.key'), 'utf8') : null)
if (!key) fail('chave de assinatura não encontrada (~/.tauri/orbit-updater.key ou TAURI_SIGNING_PRIVATE_KEY)')

// 1. Version everywhere the app reads it.
if (version !== conf.version) {
  conf.version = version
  writeFileSync(tauriConf, `${JSON.stringify(conf, null, 2)}\n`)
  writeFileSync(cargoToml, readFileSync(cargoToml, 'utf8').replace(/^version = "[^"]+"/m, `version = "${version}"`))
  const pkg = JSON.parse(readFileSync(desktopPkg, 'utf8'))
  pkg.version = version
  writeFileSync(desktopPkg, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`versão → ${version}`)
}

// 2. Signed build with the updater archive (.app.tar.gz + .sig).
const build = spawnSync('npm', ['run', 'app:build', '--', '--config', JSON.stringify({ bundle: { createUpdaterArtifacts: true } })], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' },
})
if (build.status !== 0) fail('o build falhou')

const bundle = join(desktop, 'src-tauri/target/release/bundle/macos')
const archive = join(bundle, 'Orbit.app.tar.gz')
if (!existsSync(archive) || !existsSync(`${archive}.sig`)) fail('o build não gerou Orbit.app.tar.gz e a assinatura')

// 3. Release files: the archive under a versioned name and the manifest the updater reads.
const out = join(root, 'dist-release', `v${version}`)
mkdirSync(out, { recursive: true })
const name = `Orbit_${version}_aarch64.app.tar.gz`
copyFileSync(archive, join(out, name))
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { 'darwin-aarch64': { signature: readFileSync(`${archive}.sig`, 'utf8').trim(), url: name } },
}
writeFileSync(join(out, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`\nArquivos em ${out}:\n  ${name}\n  latest.json`)

// 4. Publish (only when asked).
const files = [join(out, name), join(out, 'latest.json')]
if (!publish) {
  console.log(`\nPara publicar: gh release create v${version} --repo ${repo} --title "Orbit ${version}" --notes "…" ${files.map((f) => `'${f}'`).join(' ')}`)
  process.exit(0)
}
const created = spawnSync('gh', ['release', 'create', `v${version}`, '--repo', repo, '--title', `Orbit ${version}`, '--notes', notes || `Orbit ${version}`, ...files], { stdio: 'inherit' })
if (created.status !== 0) fail('o gh não criou a release')
console.log(`\nPublicada: v${version} em ${repo}. Faça commit da troca de versão.`)
