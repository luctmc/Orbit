import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { SourceRevision, VerificationInput } from '@orbit/protocol'

const MAX_FILES = 20000, MAX_BYTES = 128 * 1024 * 1024, MAX_FILE = 32 * 1024 * 1024
const GENERATED = new Set(['.git', 'node_modules', 'target', 'dist', '.cache', '.DS_Store'])
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const within = (root: string, path: string) => { const r = relative(root, path); return r === '' || (r !== '..' && !r.startsWith('../') && !isAbsolute(r)) }
function git(root: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } })
}

/** No shell, diff drivers, textconv or clean filters: hash actual files and Git's index identities. */
export function sourceRevision(roots: string[], excluded: string[] = []): SourceRevision {
  let count = 0, bytes = 0
  const exclusions = excluded.map(path => { try { return realpathSync(path) } catch { return path } })
  const snapshots = [...new Set(roots.map(root => realpathSync(root)))].sort().map(root => {
    const rootExclusions = exclusions.filter(e => e !== root && within(root, e))
    let head: string | null = null, index = '', paths: string[] = [], kind: 'git' | 'files' = 'files'
    try { head = git(root, ['rev-parse', '--verify', 'HEAD']).trim(); kind = 'git' } catch { /* unversioned directory */ }
    if (kind === 'git') {
      index = git(root, ['ls-files', '--stage', '-z'])
      paths = [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort()
    } else {
      const walk = (dir: string) => {
        for (const name of readdirSync(dir).sort()) {
          const path = join(dir, name)
          if (GENERATED.has(name) || rootExclusions.some(e => within(e, path))) continue
          if (++count > MAX_FILES) throw new Error('Fingerprint excede 20.000 entradas; delimite o repositório')
          if (lstatSync(path).isDirectory()) walk(path)
          else paths.push(relative(root, path))
        }
      }
      walk(root)
    }
    const entries: Array<[string, string, number]> = []
    for (const path of paths) {
      const full = join(root, path)
      if (!within(root, full)) throw new Error('Caminho fora da raiz do fingerprint')
      if (rootExclusions.some(e => within(e, full))) continue
      if (kind === 'git' && ++count > MAX_FILES) throw new Error('Fingerprint excede 20.000 arquivos; delimite o repositório')
      let stat
      try { stat = lstatSync(full) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        entries.push([path, 'missing', 0]); continue
      }
      if (stat.isSymbolicLink()) { entries.push([path, `link:${readlinkSync(full)}`, stat.mode]); continue }
      if (!stat.isFile()) throw new Error(`Fingerprint não suporta diretórios/submódulos em entradas Git: ${path}`)
      if (stat.size > MAX_FILE || bytes + stat.size > MAX_BYTES) throw new Error('Fingerprint excede o limite de 32 MiB por arquivo ou 128 MiB no total')
      const content = readFileSync(full)
      bytes += content.length
      if (content.length > MAX_FILE || bytes > MAX_BYTES) throw new Error('Conteúdo cresceu além do limite de fingerprint')
      entries.push([path, sha(content), stat.mode])
    }
    return { root, kind, head, files: entries.length, digest: sha(JSON.stringify([head, index, entries])) }
  })
  if (!snapshots.length) throw new Error('O resultado não possui raiz de código verificável')
  return { version: 1, roots: snapshots, digest: sha(JSON.stringify(snapshots)) }
}

export function validateReview(input: VerificationInput, acceptance: string[]): void {
  if (!['accepted', 'changes_required', 'unverified'].includes(input.verdict) || !input.summary?.trim() || input.summary.length > 2000) throw new Error('Parecer de revisão inválido')
  if (!Array.isArray(input.checks) || input.checks.length > 20 || input.checks.some(c => typeof c.command !== 'string' || !c.command.trim() || c.command.length > 2000 || !Number.isSafeInteger(c.exitCode) || typeof c.summary !== 'string' || !c.summary.trim() || c.summary.length > 2000)) throw new Error('Checks de revisão inválidos')
  if (!Array.isArray(input.criteria) || input.criteria.length > 8 || input.criteria.some(c => !Number.isSafeInteger(c.item) || c.item < 1 || c.item > acceptance.length || typeof c.met !== 'boolean' || typeof c.how !== 'string' || !c.how.trim() || c.how.length > 500) || new Set(input.criteria.map(c => c.item)).size !== input.criteria.length) throw new Error('Critérios de revisão inválidos')
  if (input.verdict === 'accepted' && (!input.checks.length || input.checks.some(c => c.exitCode !== 0) || acceptance.some((_, i) => !input.criteria.find(c => c.item === i + 1 && c.met)))) throw new Error('Aceite exige checks sem falhas e evidência para cada critério obrigatório')
}
