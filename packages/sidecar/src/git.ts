import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** git with an argument list (never a shell); throws with git's own message when it fails. */
export function gitSync(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new Error(stderr ? stderr.split('\n').slice(-3).join(' ') : `git ${args[0]} falhou`)
  }
}

export interface RepoInfo {
  /** Repository root (real path). */
  top: string
  /** Where the folder sits inside it ('' at the root). */
  sub: string
  /** Current branch; null when detached. */
  branch: string | null
}

/** The repository a folder belongs to, or an error saying it is not one. */
export function repoInfo(folder: string): RepoInfo {
  let top: string
  try {
    top = realpathSync(gitSync(folder, ['rev-parse', '--show-toplevel']).trim())
  } catch {
    throw new Error(`${folder} não é um repositório git`)
  }
  try {
    gitSync(folder, ['rev-parse', '--verify', 'HEAD'])
  } catch {
    throw new Error('O repositório ainda não tem nenhum commit')
  }
  const branch = gitSync(folder, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  return { top, sub: relative(top, realpathSync(folder)), branch: branch === 'HEAD' ? null : branch }
}

/** Branch names Orbit creates: plain ASCII, no ref-directory clashes between mission and agents. */
export const BRANCH = /^orbit\/[a-z0-9][a-z0-9-]{0,60}(--\d{1,6})?$/

/**
 * A working copy of `top` at `path` on `branch`, created from `from` when the branch is new and
 * reused when it already exists there (an agent reopened).
 */
export function addWorktree(top: string, path: string, branch: string, from: string): void {
  if (!BRANCH.test(branch)) throw new Error(`Branch inválido: ${branch}`)
  if (existsSync(join(path, '.git'))) return
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const exists = gitSync(top, ['branch', '--list', branch]).trim() !== ''
  gitSync(top, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, from])
}

/** Uncommitted files in a working copy (paths, at most a few). */
export function dirtyFiles(path: string): string[] {
  if (!existsSync(path)) return []
  return gitSync(path, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((l) => l.slice(3))
}

/** Removes a working copy only when nothing is left uncommitted in it; the branch always stays. */
export function removeWorktree(top: string, path: string): boolean {
  if (!existsSync(path)) return true
  if (dirtyFiles(path).length) return false
  gitSync(top, ['worktree', 'remove', path])
  return true
}

/** Commits on `branch` that `base` does not have, newest first. */
export function commitsAhead(top: string, base: string, branch: string, max = 50): Array<{ sha: string; subject: string }> {
  const out = gitSync(top, ['log', `--max-count=${max}`, '--format=%h%x09%s', `${base}..${branch}`]).trim()
  return out ? out.split('\n').map((line) => {
    const [sha, ...rest] = line.split('\t')
    return { sha: sha!, subject: rest.join('\t') }
  }) : []
}

/** Files that differ between `base` and `branch` (merge-base diff, what a PR would show). */
export function filesChanged(top: string, base: string, branch: string): Array<{ path: string; added: number | null; removed: number | null }> {
  return gitSync(top, ['diff', '--numstat', `${base}...${branch}`]).trim().split('\n').filter(Boolean).map((line) => {
    const [a, r, ...path] = line.split('\t')
    return { path: path.join('\t'), added: a === '-' ? null : Number(a), removed: r === '-' ? null : Number(r) }
  })
}

/** Pushes a branch to `origin` and sets its upstream. */
export function pushBranch(path: string, branch: string): void {
  if (!BRANCH.test(branch)) throw new Error(`Branch inválido: ${branch}`)
  gitSync(path, ['push', '-u', 'origin', branch])
}

export function hasRemote(top: string): boolean {
  return gitSync(top, ['remote']).split('\n').includes('origin')
}
