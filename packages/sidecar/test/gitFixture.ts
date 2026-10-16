import { gitSync } from '../src/git.ts'

/** An isolated versioned workspace, so parallel writer tests use actual Git worktrees. */
export function initRepository(path: string): string {
  gitSync(path, ['init', '-b', 'main'])
  gitSync(path, ['-c', 'user.name=Orbit Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-m', 'Fixture'])
  return path
}
