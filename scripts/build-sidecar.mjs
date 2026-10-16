// Packages the sidecar for the desktop bundle: one ESM file plus the pieces that cannot be bundled
// (node-pty's native addon and the hook script). Output: apps/desktop/build/sidecar/.
import { build } from 'esbuild'
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundledCatalog } from '../packages/sidecar/src/skills.ts'

const root = join(import.meta.dirname, '..')
const out = join(root, 'apps/desktop/build/sidecar')
// Refuse to ship modified/missing skill packages without updating the reviewed manifest.
const skills = bundledCatalog(join(root, 'packages/sidecar/resources/skills'))
if (skills.length !== 20) throw new Error('Orbit requires its five skill packages for all four adapters')
rmSync(out, { recursive: true, force: true })

await build({
  entryPoints: [join(root, 'packages/sidecar/src/index.ts')],
  outfile: join(out, 'dist/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // node-pty loads a native addon; ws only *tries* these optional speedups.
  external: ['node-pty', 'bufferutil', 'utf-8-validate'],
  // CommonJS dependencies inside an ESM bundle still call require().
  banner: { js: "import { createRequire as __orbitRequire } from 'node:module'; const require = __orbitRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
})

cpSync(join(root, 'packages/sidecar/hooks'), join(out, 'hooks'), { recursive: true })
cpSync(join(root, 'packages/sidecar/resources'), join(out, 'resources'), { recursive: true })

const pty = join(root, 'node_modules/node-pty')
const ptyOut = join(out, 'node_modules/node-pty')
mkdirSync(ptyOut, { recursive: true })
for (const entry of ['package.json', 'LICENSE', 'lib']) cpSync(join(pty, entry), join(ptyOut, entry), { recursive: true })
for (const arch of ['darwin-arm64', 'darwin-x64']) {
  cpSync(join(pty, 'prebuilds', arch), join(ptyOut, 'prebuilds', arch), { recursive: true })
  chmodSync(join(ptyOut, 'prebuilds', arch, 'spawn-helper'), 0o755)
}
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'orbit-sidecar', private: true, type: 'module' }, null, 2))
console.log(`sidecar empacotado em ${out}`)
