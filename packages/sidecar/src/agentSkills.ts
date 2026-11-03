import { lstatSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** Links installed skills without redistributing their contents or executing them. */
export function prepareAgentSkills(dataDir: string, allowlist: string[], home = homedir(), log: (message: string) => void = console.warn): string | undefined {
  try {
    const data = realpathSync(dataDir)
    let directory = data
    for (const part of ['agent-skills', '.claude', 'skills']) {
      const next = join(directory, part)
      try { mkdirSync(next, { mode: 0o700 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      if (lstatSync(next).isSymbolicLink() || !lstatSync(next).isDirectory()) throw new Error('Unsafe skill directory')
      directory = realpathSync(next)
      if (!directory.startsWith(data + sep)) throw new Error('Skill directory escaped Orbit data')
    }
    const selected = new Set(allowlist.filter(name => typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)))
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (!lstatSync(path).isSymbolicLink()) { log('[agent-skills] Non-link entry ignored'); continue }
      if (!selected.has(name)) unlinkSync(path)
    }
    for (const name of allowlist) {
      if (!selected.has(name)) { log('[agent-skills] Invalid skill name skipped'); continue }
      const link = resolve(directory, name)
      if (!link.startsWith(directory + sep)) throw new Error('Skill link escaped managed directory')
      try {
        const target = realpathSync(join(home, '.claude', 'skills', name))
        if (!statSync(target).isDirectory() || !statSync(join(target, 'SKILL.md')).isFile()) throw new Error('Missing SKILL.md')
        try {
          if (realpathSync(link) === target) continue
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        try { unlinkSync(link) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        symlinkSync(target, link, 'dir')
      } catch {
        // A previously installed skill must not remain selected after its source becomes invalid.
        try { unlinkSync(link) } catch {}
        log(`[agent-skills] Skill unavailable: ${name}`)
      }
    }
    return join(data, 'agent-skills')
  } catch {
    log('[agent-skills] Could not prepare the managed skill directory')
    return undefined
  }
}
