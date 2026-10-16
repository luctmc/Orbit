import { realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import type { ExecutionPolicy } from '@orbit/protocol'
import { repoInfo } from './git.ts'

/** A subfolder shares its checkout's index and files; a worktree has its own physical root. */
export function copyRoots(folders: string[]): string[] {
  return [...new Set(folders.map(folder => {
    const real = realpathSync(folder)
    try { return repoInfo(real).top } catch { return real }
  }))].sort()
}
const contains = (root: string, child: string) => {
  const r = relative(root, child)
  return r === '' || (r !== '..' && !r.startsWith('../') && !isAbsolute(r))
}
export function writerConflict(a: ExecutionPolicy, b: ExecutionPolicy): boolean {
  return !a.readOnly && !b.readOnly && a.roots.some(root => b.roots.some(other => contains(root, other) || contains(other, root)))
}

export function assertNoDependencyCycle(activityId: string, dependencies: string[], graph: Array<{ id: string; dependencies?: Array<{ activityId: string }> }>): void {
  const visit = (id: string, seen: Set<string>): boolean => {
    if (id === activityId) return true
    if (seen.has(id)) return false
    seen.add(id)
    return (graph.find(a => a.id === id)?.dependencies ?? []).some(d => visit(d.activityId, seen))
  }
  if (dependencies.some(id => visit(id, new Set()))) throw new Error('Dependência circular: uma atividade não pode depender de si ou de seus descendentes')
}
