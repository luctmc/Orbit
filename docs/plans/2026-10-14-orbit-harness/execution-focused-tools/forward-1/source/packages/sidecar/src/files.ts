import { execFile } from 'node:child_process'
import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { FILES_LIMITS, type FileChange, type FolderStatus } from '@orbit/protocol'

interface GitResult {
  code: number
  stdout: string
}

/**
 * Runs git with an argument list (never a shell). GIT_OPTIONAL_LOCKS=0 keeps Orbit's reads from
 * taking the index lock while agents commit in the same repository.
 */
function git(cwd: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<GitResult> {
  return new Promise((done) => {
    execFile('git', ['-C', cwd, ...args], { maxBuffer, timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } }, (error, stdout) => {
      done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout) })
    })
  })
}

/** `path` inside `folder`, following symlinks; anything that escapes is refused. */
export function insideFolder(folder: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\0')) throw new Error('Caminho inválido')
  const root = realpathSync(folder)
  const target = resolve(root, path)
  if (target !== root && !target.startsWith(root + sep)) throw new Error('Caminho fora da pasta')
  let real = target
  try {
    real = realpathSync(target)
  } catch {
    return target // gone (a deleted file): the lexical check above is all there is
  }
  if (real !== root && !real.startsWith(root + sep)) throw new Error('Caminho fora da pasta')
  return real
}

/** First bytes contain a NUL: treat as binary. */
function looksBinary(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(8192)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).includes(0)
  } finally {
    closeSync(fd)
  }
}

const KIND: Record<string, FileChange['kind']> = { A: 'novo', D: 'apagado', R: 'renomeado', C: 'novo', U: 'conflito' }

function changeKind(xy: string): FileChange['kind'] {
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflito'
  for (const letter of [xy[0], xy[1]]) if (letter && KIND[letter]) return KIND[letter]!
  return 'modificado'
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseStatus(output: string): Pick<FolderStatus, 'branch' | 'ahead' | 'behind'> & { changes: Array<Omit<FileChange, 'added' | 'removed' | 'by'>> } {
  const fields = output.split('\0')
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const changes: Array<Omit<FileChange, 'added' | 'removed' | 'by'>> = []
  for (let i = 0; i < fields.length; i++) {
    const line = fields[i]!
    if (line.startsWith('# branch.head ')) branch = line.slice(14) === '(detached)' ? null : line.slice(14)
    else if (line.startsWith('# branch.ab ')) {
      const [a, b] = line.slice(12).split(' ')
      ahead = Math.abs(Number(a)) || 0
      behind = Math.abs(Number(b)) || 0
    } else if (line.startsWith('1 ')) {
      const parts = line.split(' ')
      const xy = parts[1]!
      changes.push({ path: parts.slice(8).join(' '), from: null, kind: changeKind(xy), staged: xy[0] !== '.' })
    } else if (line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1]!
      changes.push({ path: parts.slice(9).join(' '), from: fields[++i] ?? null, kind: 'renomeado', staged: xy[0] !== '.' })
    } else if (line.startsWith('u ')) {
      changes.push({ path: line.split(' ').slice(10).join(' '), from: null, kind: 'conflito', staged: false })
    } else if (line.startsWith('? ')) {
      changes.push({ path: line.slice(2), from: null, kind: 'novo', staged: false })
    }
  }
  return { branch, ahead, behind, changes }
}

/** Parses `git diff --numstat -z`: lines added and removed per path (null for binary files). */
export function parseNumstat(output: string): Map<string, { added: number | null; removed: number | null }> {
  const counts = new Map<string, { added: number | null; removed: number | null }>()
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(fields[i]!)
    if (!match) continue
    // Renames come as "a\tb\t" followed by the old and the new path.
    const path = match[3] ? match[3] : (i += 2, fields[i] ?? '')
    counts.set(path, { added: match[1] === '-' ? null : Number(match[1]), removed: match[2] === '-' ? null : Number(match[2]) })
  }
  return counts
}

function countLines(path: string): number | null {
  try {
    if (statSync(path).size > FILES_LIMITS.read || looksBinary(path)) return null
    const text = readFileSync(path, 'utf8')
    return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0
  } catch {
    return null
  }
}

/** Branch, ahead/behind and every changed file with its line counts. */
export async function folderStatus(folder: string, by: (absolutePath: string) => number[] = () => []): Promise<FolderStatus> {
  const status = await git(folder, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  if (status.code !== 0) return { folder, git: false, branch: null, ahead: 0, behind: 0, changes: [], error: null }
  const parsed = parseStatus(status.stdout)
  const top = (await git(folder, ['rev-parse', '--show-toplevel'])).stdout.trim() || folder
  const numstat = await git(folder, ['diff', 'HEAD', '--numstat', '-z', '--relative'])
  const counts = numstat.code === 0 ? parseNumstat(numstat.stdout) : new Map()
  // Status paths are relative to the repository root; show them relative to the folder.
  const rel = relative(realpathSync(top), realpathSync(folder))
  const changes: FileChange[] = parsed.changes
    .filter((c) => !rel || c.path === rel || c.path.startsWith(`${rel}/`))
    .map((c) => {
      const path = rel ? c.path.slice(rel.length + 1) : c.path
      const absolute = join(top, c.path)
      const count = counts.get(path)
      const added = count ? count.added : c.kind === 'novo' ? countLines(absolute) : null
      return { ...c, path, from: c.from && rel ? c.from.slice(rel.length + 1) : c.from, added, removed: count ? count.removed : c.kind === 'novo' ? 0 : null, by: by(absolute) }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  return { folder, git: true, branch: parsed.branch, ahead: parsed.ahead, behind: parsed.behind, changes, error: null }
}

/** Unified diff of one file against the last commit (new files against nothing). */
export async function fileDiff(folder: string, path: string): Promise<{ diff: string; truncated: boolean }> {
  const absolute = insideFolder(folder, path)
  let diff = (await git(folder, ['diff', 'HEAD', '--no-color', '--relative', '--', path])).stdout
  if (!diff.trim()) {
    // Untracked: compare with an empty file (git exits 1 when they differ).
    diff = (await git(folder, ['diff', '--no-color', '--no-index', '--', '/dev/null', absolute])).stdout
  }
  const truncated = diff.length > FILES_LIMITS.diff
  return { diff: truncated ? diff.slice(0, FILES_LIMITS.diff) : diff, truncated }
}

const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.next', '.venv', '__pycache__', '.DS_Store'])

/** Files of a folder: git's view (tracked and new, without ignored) or a bounded walk. */
export async function folderTree(folder: string): Promise<{ files: string[]; truncated: boolean }> {
  const listed = await git(folder, ['ls-files', '-co', '--exclude-standard', '-z'])
  let files: string[]
  if (listed.code === 0) {
    files = listed.stdout.split('\0').filter(Boolean)
  } else {
    files = []
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length > FILES_LIMITS.tree || SKIP.has(entry.name)) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(join(dir, entry.name), rel)
        else if (entry.isFile()) files.push(rel)
      }
    }
    walk(folder, '')
  }
  files.sort((a, b) => a.localeCompare(b))
  return { files: files.slice(0, FILES_LIMITS.tree), truncated: files.length > FILES_LIMITS.tree }
}

/** A text file's contents; binary or oversized files come back without text and with the reason. */
export function readFile(folder: string, path: string): { text: string | null; size: number; reason: string | null } {
  const absolute = insideFolder(folder, path)
  const stat = statSync(absolute)
  if (!stat.isFile()) throw new Error('Não é um arquivo')
  if (stat.size > FILES_LIMITS.read) return { text: null, size: stat.size, reason: 'Arquivo grande demais para mostrar aqui.' }
  if (looksBinary(absolute)) return { text: null, size: stat.size, reason: 'Arquivo binário.' }
  return { text: readFileSync(absolute, 'utf8'), size: stat.size, reason: null }
}
