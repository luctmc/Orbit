// Puts the official Node.js binary in apps/desktop/build/node/node for the app bundle.
// The tarball comes from nodejs.org, is checked against the release's SHASUMS256.txt and is
// cached, so later builds work offline. Only `bin/node` is extracted.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = 'v24.21.0'
const ARCH = process.env.ORBIT_NODE_ARCH ?? process.arch
if (ARCH !== 'arm64') {
  console.error(`[fetch-node] só há Node empacotado para Apple Silicon (arm64); esta máquina é ${ARCH}.`)
  process.exit(1)
}

const root = join(import.meta.dirname, '..')
const cacheDir = join(root, 'apps/desktop/build/node-cache', VERSION)
const outDir = join(root, 'apps/desktop/build/node')
const name = `node-${VERSION}-darwin-${ARCH}`
const tarball = join(cacheDir, `${name}.tar.xz`)
const base = `https://nodejs.org/dist/${VERSION}`

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

mkdirSync(cacheDir, { recursive: true })
const sumsFile = join(cacheDir, 'SHASUMS256.txt')
if (!existsSync(sumsFile)) writeFileSync(sumsFile, await download(`${base}/SHASUMS256.txt`))
const expected = readFileSync(sumsFile, 'utf8').split('\n').find((line) => line.endsWith(`  ${name}.tar.xz`))?.split(' ')[0]
if (!expected) throw new Error(`SHASUMS256.txt não lista ${name}.tar.xz`)

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
if (!existsSync(tarball) || sha256(readFileSync(tarball)) !== expected) {
  console.log(`[fetch-node] baixando ${name}.tar.xz de ${base}`)
  const data = await download(`${base}/${name}.tar.xz`)
  if (sha256(data) !== expected) throw new Error(`${name}.tar.xz: SHA-256 não confere; download descartado`)
  writeFileSync(tarball, data)
}

// Extract into a fresh, empty directory and take only the binary out of it.
const scratch = mkdtempSync(join(cacheDir, 'extract-'))
try {
  execFileSync('tar', ['-xJf', tarball, '-C', scratch, `${name}/bin/node`])
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  copyFileSync(join(scratch, name, 'bin/node'), join(outDir, 'node'))
  chmodSync(join(outDir, 'node'), 0o755)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
const version = execFileSync(join(outDir, 'node'), ['--version'], { encoding: 'utf8' }).trim()
console.log(`[fetch-node] Node ${version} (${ARCH}) pronto em ${outDir}`)
