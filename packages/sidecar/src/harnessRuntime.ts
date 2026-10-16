import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
/** Full bytes, bounded local code only. Missing/racy files disable promotion instead of guessing. */
export function hashHarnessFiles(root: string, files: string[], nodeVersion = process.version): string | null {
  try {
    if (!files.length || files.length > 1000 || new Set(files).size !== files.length) return null
    const hash = createHash('sha256').update(JSON.stringify(['orbit-runtime-v1', nodeVersion]))
    let bytes = 0
    for (const path of [...files].sort()) {
      const name = relative(root, path), before = lstatSync(path)
      if (name.startsWith('..') || isAbsolute(name) || !before.isFile() || before.size > 4 * 1024 * 1024 || (bytes += before.size) > 32 * 1024 * 1024) return null
      const content = readFileSync(path), after = lstatSync(path)
      if (content.length !== before.size || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size) return null
      hash.update(JSON.stringify([name, content.length])).update(content)
    }
    return hash.digest('hex')
  } catch { return null }
}
let cached: string | null | undefined
/** Once per process: source in dev; actual compiled entry plus hooks/resources in the bundle. */
export function harnessRuntimeRevision(refresh = false): string | null {
  if (!refresh && cached !== undefined) return cached
  try {
    const entry = fileURLToPath(import.meta.url), dir = dirname(entry)
    const dev = existsSync(join(dir, 'core.ts'))
    const root = dev ? resolve(dir, '../../..') : resolve(dir, '..')
    const files: string[] = []
    const walk = (path: string) => {
      if (files.length > 1000) throw new Error('Runtime fora do limite')
      for (const e of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.isFile()) files.push(full)
        else throw new Error('Tipo de arquivo não suportado no runtime')
      }
    }
    if (dev) {
      for (const p of ['packages/sidecar/src', 'packages/sidecar/hooks', 'packages/sidecar/resources', 'packages/protocol/src']) walk(join(root, p))
      files.push(join(root, 'package-lock.json'))
    } else {
      files.push(entry)
      for (const p of ['hooks', 'resources']) walk(join(root, p))
    }
    return cached = hashHarnessFiles(root, files)
  } catch { return cached = null }
}
