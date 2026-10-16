import { execFile } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AGENT_INFO, EFFORTS, type AgentCliForRole, type Catalog, type CliCatalog, type CliStatus, type Effort, type ModelInfo } from '@orbit/protocol'

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

/** npm package of each CLI that is published there (Antigravity ships its own installer). */
const NPM_PACKAGE: Partial<Record<AgentCliForRole, string>> = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex', gemini: '@google/gemini-cli' }
const LABEL: Record<AgentCliForRole, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', antigravity: 'Antigravity CLI' }
/** CLIs that update themselves when installed by their own installer. */
const SELF_UPDATE: Partial<Record<AgentCliForRole, string>> = { claude: 'claude update', antigravity: 'agy update' }

export function blankStatus(cli: AgentCliForRole): CliStatus {
  return { cli, installed: false, path: null, version: null, method: 'unknown', latest: null, checkedAt: null, busy: null, message: null, ok: null }
}

export function parseVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+(?:[-.][\w.]+)?)/.exec(output)?.[1] ?? null
}

/** How a CLI was installed, from where its executable really lives. */
export function installMethod(cli: AgentCliForRole, realPath: string): CliStatus['method'] {
  if (realPath.includes('/Cellar/') || realPath.includes('/Caskroom/')) return 'brew'
  const pkg = NPM_PACKAGE[cli]
  if (pkg && realPath.includes(`/node_modules/${pkg}/`)) return 'npm'
  if (cli === 'claude' && realPath.includes('/.local/share/claude/')) return 'native'
  if (cli === 'antigravity' && realPath.includes('/.local/')) return 'native'
  return 'unknown'
}

/** Installed path, version and method. */
export async function inspectCli(run: Run, cli: AgentCliForRole): Promise<Pick<CliStatus, 'installed' | 'path' | 'version' | 'method'>> {
  const bin = AGENT_INFO[cli].bin
  const where = await run(`command -v ${bin}`, 15_000)
  const found = where.stdout.trim().split('\n').pop()?.trim()
  if (where.code !== 0 || !found) return { installed: false, path: null, version: null, method: 'unknown' }
  let path = found
  try {
    path = realpathSync(found)
  } catch {
    // keep what the shell said
  }
  const version = await run(`${bin} --version`, 30_000)
  return { installed: true, path, version: version.code === 0 ? parseVersion(version.stdout) : null, method: installMethod(cli, path) }
}

/** The newest published release (npm registry; the native installer follows the same versions). */
export async function latestVersion(run: Run, cli: AgentCliForRole): Promise<string | null> {
  const pkg = NPM_PACKAGE[cli]
  if (!pkg) return null
  const result = await run(`npm view ${pkg} version`, 60_000)
  return result.code === 0 ? parseVersion(result.stdout) : null
}

/** The package directory an npm-installed CLI lives in, from its real executable path. */
function npmPackageDir(cli: AgentCliForRole, realPath: string): string | null {
  const marker = `/node_modules/${NPM_PACKAGE[cli] ?? '-'}/`
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
    case 'native': {
      const own = SELF_UPDATE[status.cli]
      return own ? [own] : `Não sei atualizar ${LABEL[status.cli]} instalado assim; use o instalador dele.`
    }
    case 'npm': {
      if (!pkg) return `${LABEL[status.cli]} não é publicado no npm; use o instalador dele.`
      const commands = [`npm install -g ${pkg}@latest`]
      const dir = status.path ? npmPackageDir(status.cli, status.path) : null
      if (status.cli === 'claude' && dir) commands.push(`node '${join(dir, 'install.cjs').replaceAll("'", `'\\''`)}'`)
      return commands
    }
    case 'brew':
      return status.cli === 'gemini' ? ['brew upgrade gemini-cli'] : `${LABEL[status.cli]} foi instalado pelo Homebrew: atualize com \`brew upgrade\`.`
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

/** Gemini CLI has no model list command: its aliases and the ids it ships with. No effort levels. */
export const GEMINI_CATALOG: CliCatalog = {
  source: 'builtin',
  efforts: [],
  models: [
    ['auto', 'Automático (o Gemini escolhe por tarefa)'],
    ['pro', 'Pro (alias do mais recente)'],
    ['flash', 'Flash (alias do mais recente)'],
    ['flash-lite', 'Flash-Lite (alias do mais recente)'],
    ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro (prévia)'],
    ['gemini-3.5-flash', 'Gemini 3.5 Flash'],
    ['gemini-3-flash-preview', 'Gemini 3 Flash (prévia)'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
  ].map(([id, label]) => ({ id: id!, label: label!, description: '', efforts: [], defaultEffort: null })),
}

/** Antigravity's levels (agy --effort); its models come from `agy models` once signed in. */
const ANTIGRAVITY_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const ANTIGRAVITY_FALLBACK: CliCatalog = { source: 'builtin', efforts: ANTIGRAVITY_EFFORTS, models: [] }

/**
 * Parses `agy models`: one model per line, its id first and, optionally, a name after it. Lines
 * that are not a model (headers, progress, blank) are skipped.
 */
export function parseAntigravityModels(text: string): CliCatalog {
  const models: ModelInfo[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s*•-]+/, '').trim()
    // Model ids are lowercase (gemini-3.1-pro, claude-sonnet-5-5); messages and headers are not.
    const match = /^([a-z0-9][a-z0-9._/-]{2,80})(?:\s+[-–—|:]?\s*(.+))?$/.exec(line)
    if (!match || /error|sign in|please|fetching|available/i.test(line)) continue
    const id = match[1]!
    if (models.some((m) => m.id === id)) continue
    models.push({ id, label: match[2]?.trim() || id, description: '', efforts: ANTIGRAVITY_EFFORTS, defaultEffort: null })
  }
  if (models.length === 0) throw new Error('nenhum modelo na saída')
  return { source: 'cli', efforts: ANTIGRAVITY_EFFORTS, models }
}

/** The `model = "…"` line of the person's Codex config, if any. */
export function codexDefaultModel(home = process.env.CODEX_HOME ?? join(homedir(), '.codex')): string | null {
  try {
    const line = /^model\s*=\s*"([^"]+)"/m.exec(readFileSync(join(home, 'config.toml'), 'utf8'))
    return line?.[1] ?? null
  } catch {
    return null
  }
}

export async function loadCatalog(run: Run): Promise<Catalog> {
  const ask = async (command: string, parse: (out: string) => CliCatalog, fallback: CliCatalog) => {
    const result = await run(command, 60_000)
    if (result.code !== 0) return fallback
    try {
      return parse(result.stdout)
    } catch {
      return fallback
    }
  }
  const [codex, antigravity] = await Promise.all([
    ask('codex debug models', parseCodexCatalog, CODEX_FALLBACK),
    ask('agy models', parseAntigravityModels, ANTIGRAVITY_FALLBACK),
  ])
  return { claude: CLAUDE_CATALOG, codex: { ...codex, defaultModel: codexDefaultModel() }, gemini: GEMINI_CATALOG, antigravity }
}
