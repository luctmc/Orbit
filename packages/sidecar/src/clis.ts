import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { EFFORTS, type AgentCliForRole, type Catalog, type CliCatalog, type CliStatus, type Effort, type ModelInfo } from '@orbit/protocol'

/** Runs a command line in the user's login shell (their PATH, npm, brew…). */
export type Run = (command: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>

export function loginShellRunner(shell: string): Run {
  return (command, timeoutMs) =>
    new Promise((resolve) => {
      execFile(shell, ['-lc', command], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } }, (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      })
    })
}

const NPM_PACKAGE: Record<AgentCliForRole, string> = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' }
const LABEL: Record<AgentCliForRole, string> = { claude: 'Claude Code', codex: 'Codex' }

export function blankStatus(cli: AgentCliForRole): CliStatus {
  return { cli, installed: false, path: null, version: null, method: 'unknown', latest: null, checkedAt: null, busy: null, message: null, ok: null }
}

export function parseVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+(?:[-.][\w.]+)?)/.exec(output)?.[1] ?? null
}

/** How a CLI was installed, from where its executable really lives. */
export function installMethod(cli: AgentCliForRole, realPath: string): CliStatus['method'] {
  if (realPath.includes(`/node_modules/${NPM_PACKAGE[cli]}/`)) return 'npm'
  if (cli === 'claude' && realPath.includes('/.local/share/claude/')) return 'native'
  if (realPath.includes('/Cellar/') || realPath.includes('/Caskroom/')) return 'brew'
  return 'unknown'
}

/** Installed path, version and method. */
export async function inspectCli(run: Run, cli: AgentCliForRole): Promise<Pick<CliStatus, 'installed' | 'path' | 'version' | 'method'>> {
  const where = await run(`command -v ${cli}`, 15_000)
  const found = where.stdout.trim().split('\n').pop()?.trim()
  if (where.code !== 0 || !found) return { installed: false, path: null, version: null, method: 'unknown' }
  let path = found
  try {
    path = realpathSync(found)
  } catch {
    // keep what the shell said
  }
  const version = await run(`${cli} --version`, 30_000)
  return { installed: true, path, version: version.code === 0 ? parseVersion(version.stdout) : null, method: installMethod(cli, path) }
}

/** The newest published release (npm registry; the native installer follows the same versions). */
export async function latestVersion(run: Run, cli: AgentCliForRole): Promise<string | null> {
  const result = await run(`npm view ${NPM_PACKAGE[cli]} version`, 60_000)
  return result.code === 0 ? parseVersion(result.stdout) : null
}

/** The package directory an npm-installed CLI lives in, from its real executable path. */
function npmPackageDir(cli: AgentCliForRole, realPath: string): string | null {
  const marker = `/node_modules/${NPM_PACKAGE[cli]}/`
  const index = realPath.indexOf(marker)
  return index === -1 ? null : realPath.slice(0, index + marker.length - 1)
}

/**
 * The commands that update a CLI, by install method. npm 12 blocks install scripts in global
 * installs, which leaves Claude Code's npm package without its native binary, so its own
 * installer (`install.cjs`, which only copies the bundled binary) is run afterwards.
 */
export function updateCommands(status: CliStatus): string[] | string {
  const pkg = NPM_PACKAGE[status.cli]
  switch (status.method) {
    case 'native':
      return ['claude update']
    case 'npm': {
      const commands = [`npm install -g ${pkg}@latest`]
      const dir = status.path ? npmPackageDir(status.cli, status.path) : null
      if (status.cli === 'claude' && dir) commands.push(`node '${join(dir, 'install.cjs').replaceAll("'", `'\\''`)}'`)
      return commands
    }
    case 'brew':
      return `${LABEL[status.cli]} foi instalado pelo Homebrew: atualize com \`brew upgrade\`.`
    default:
      return `Não sei como ${LABEL[status.cli]} foi instalado (${status.path ?? 'não encontrado'}); atualize pelo instalador que você usou.`
  }
}

export async function runUpdate(run: Run, status: CliStatus): Promise<{ ok: boolean; output: string }> {
  const commands = updateCommands(status)
  if (typeof commands === 'string') return { ok: false, output: commands }
  const log: string[] = []
  for (const command of commands) {
    const result = await run(command, 10 * 60_000)
    log.push(`$ ${command}`, result.stdout.trim(), result.stderr.trim())
    if (result.code !== 0) return { ok: false, output: log.filter(Boolean).join('\n').slice(-4000) }
  }
  return { ok: true, output: log.filter(Boolean).join('\n').slice(-4000) }
}

// ---- model catalogs ----

const CLAUDE_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Claude Code cannot list its models; these are the aliases it documents and the current ids. */
export const CLAUDE_CATALOG: CliCatalog = {
  source: 'builtin',
  efforts: CLAUDE_EFFORTS,
  models: [
    ['opus', 'Opus (alias do mais recente)'],
    ['sonnet', 'Sonnet (alias do mais recente)'],
    ['haiku', 'Haiku (alias do mais recente)'],
    ['fable', 'Fable (alias do mais recente)'],
    ['claude-opus-5-5', 'Claude Opus 5.5'],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
    ['claude-haiku-5-5', 'Claude Haiku 5.5'],
    ['claude-fable-5-1', 'Claude Fable 5.1'],
  ].map(([id, label]) => ({ id: id!, label: label!, description: '', efforts: CLAUDE_EFFORTS, defaultEffort: null })),
}

/** Used until (or if) `codex debug models` answers. */
export const CODEX_FALLBACK: CliCatalog = { source: 'builtin', efforts: ['low', 'medium', 'high'], models: [] }

interface RawCodexModel {
  slug?: string
  display_name?: string
  description?: string
  visibility?: string
  default_reasoning_level?: string
  supported_reasoning_levels?: Array<{ effort?: string } | string>
}

const asEffort = (value: unknown): Effort | null => (EFFORTS.includes(value as Effort) ? (value as Effort) : null)

/** Parses `codex debug models`: the models Codex lists in its picker, with their effort levels. */
export function parseCodexCatalog(json: string): CliCatalog {
  const data = JSON.parse(json) as { models?: RawCodexModel[] } | RawCodexModel[]
  const raw = Array.isArray(data) ? data : data.models ?? []
  const models: ModelInfo[] = raw
    .filter((m) => m.slug && m.visibility !== 'hide')
    .map((m) => ({
      id: m.slug!,
      label: m.display_name ?? m.slug!,
      description: m.description ?? '',
      efforts: (m.supported_reasoning_levels ?? []).map((l) => asEffort(typeof l === 'string' ? l : l.effort)).filter((e): e is Effort => e !== null),
      defaultEffort: asEffort(m.default_reasoning_level),
    }))
  if (models.length === 0) throw new Error('o catálogo do Codex veio vazio')
  const union = EFFORTS.filter((e) => models.some((m) => m.efforts.includes(e)))
  return { source: 'cli', efforts: union, models }
}

export async function loadCatalog(run: Run): Promise<Catalog> {
  let codex = CODEX_FALLBACK
  const result = await run('codex debug models', 60_000)
  if (result.code === 0) {
    try {
      codex = parseCodexCatalog(result.stdout)
    } catch {
      // keep the fallback
    }
  }
  return { claude: CLAUDE_CATALOG, codex }
}
