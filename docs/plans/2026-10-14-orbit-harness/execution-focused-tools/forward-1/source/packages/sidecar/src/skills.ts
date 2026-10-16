import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_CLIS, catalogId, type AgentCliForRole, type CatalogItem, type CatalogKind } from '@orbit/protocol'
import type { Run } from './clis.ts'
import type { HookPayload } from './hooks.ts'

const DESCRIPTION_MAX = 300
export const SKILL_MAX_BYTES = 64 * 1024
const BUNDLED_SKILLS = fileURLToPath(new URL('../resources/skills', import.meta.url))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) }

/** Bounded discovery/read, refusing symlinks that escape the registered skill root. */
function skillText(root: string, path: string) {
  const realRoot = realpathSync(root), realPath = realpathSync(path)
  if (!inside(realRoot, realPath) || !statSync(realPath).isFile() || statSync(realPath).size > SKILL_MAX_BYTES) throw new Error('Skill fora da raiz ou grande demais')
  const text = readFileSync(realPath, 'utf8')
  if (Buffer.byteLength(text) > SKILL_MAX_BYTES) throw new Error('Skill grande demais')
  return { text, realRoot, realPath }
}

export function readSkill(item: CatalogItem, sha256: string): string {
  const r = item.resource
  if (!r || item.kind !== 'skill' || r.sha256 !== sha256) throw new Error('Skill ou hash não encontrado; atualize o catálogo')
  const { text, realPath, realRoot } = skillText(r.root, r.path)
  if (realPath !== r.path || realRoot !== r.root || hash(text) !== sha256) throw new Error('A skill mudou desde a descoberta; atualize o catálogo antes de carregar')
  return text
}

/** `name:` and `description:` from a Markdown file's front matter (quoted, plain or folded). */
export function frontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return {}
  const out: Record<string, string> = {}
  const lines = match[1]!.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!)
    if (!field) continue
    let value = field[2]!.trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim())
      value = block.join(' ')
    }
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"')
    out[field[1]!] = value
  }
  return out
}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const listDir = (path: string) => {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

class Collector {
  readonly items: CatalogItem[] = []
  private readonly seen = new Set<string>()

  add(cli: AgentCliForRole, kind: CatalogKind, name: string, description: string, source: string, offInCli = false, resource?: CatalogItem['resource']): void {
    const id = catalogId(cli, kind, name)
    if (!name || this.seen.has(id)) return
    this.seen.add(id)
    this.items.push({ id, cli, kind, name, description: description.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX), source, offInCli, ...(resource ? { resource } : {}) })
  }

  /** `<dir>/<skill>/SKILL.md`, named by its front matter (or folder). */
  skills(cli: AgentCliForRole, dir: string, source: string, prefix = '', projectRoot: string | null = null): void {
    for (const entry of listDir(dir)) {
      if (entry.startsWith('.')) continue
      try {
        const { text, realRoot, realPath } = skillText(dir, join(dir, entry, 'SKILL.md'))
        const meta = frontMatter(text)
        const origin = projectRoot ? 'project' : prefix ? 'plugin' : source === 'sistema' ? 'system' : 'personal'
        this.add(cli, 'skill', `${prefix}${meta.name || entry}`, meta.description ?? '', source, false, { path: realPath, root: realRoot, sha256: hash(text), bytes: Buffer.byteLength(text), version: meta.version ?? null, origin, projectRoot: projectRoot ? realpathSync(projectRoot) : null, role: null, compatibility: [cli] })
      } catch { /* unreadable, oversized or escaping links are not eligible resources */ }
    }
  }

  /** `<dir>/<agent>.md` subagents (Claude Code). */
  agents(dir: string, source: string, prefix = ''): void {
    for (const entry of listDir(dir)) {
      if (!entry.endsWith('.md')) continue
      const meta = frontMatter(readText(join(dir, entry)) ?? '')
      this.add('claude', 'agent', `${prefix}${meta.name || entry.slice(0, -3)}`, meta.description ?? '', source)
    }
  }

  /** MCP servers from a Claude config object: names and transport only (env and headers hold secrets). */
  mcpServers(servers: unknown, source: string): void {
    if (!servers || typeof servers !== 'object') return
    for (const [name, raw] of Object.entries(servers as Record<string, Record<string, unknown>>)) {
      this.add('claude', 'mcp', name, transport(raw), source)
    }
  }
}

function transport(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  if (typeof raw.url === 'string') {
    try {
      return `${raw.type ?? 'http'} · ${new URL(raw.url).host}`
    } catch {
      return String(raw.type ?? 'http')
    }
  }
  if (typeof raw.command === 'string') return `stdio · ${basename(raw.command)}`
  return typeof raw.type === 'string' ? raw.type : ''
}

export interface ScanInput {
  /** CLAUDE_CONFIG_DIR or ~/.claude */
  claudeDir: string
  /** CODEX_HOME or ~/.codex */
  codexDir: string
  /** Workspace folders: their project skills, agents and MCP servers. */
  folders: string[]
  run: Run
  bundledDir?: string
}

/** Claude Code keeps MCP servers and per-project settings in `.claude.json` next to (or inside) its folder. */
function claudeState(claudeDir: string): Record<string, any> {
  const inside = join(claudeDir, '.claude.json')
  const text = readText(existsSync(inside) ? inside : join(homedir(), '.claude.json'))
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

/** What each CLI has installed that an agent can call. Reads files only; never changes them. */
export async function scanCatalog({ claudeDir, codexDir, folders, run, bundledDir = BUNDLED_SKILLS }: ScanInput): Promise<CatalogItem[]> {
  const found = new Collector()
  // Reserved Orbit names are resolved from the shipped manifest, before third-party packages.
  for (const item of bundledCatalog(bundledDir)) found.add(item.cli, item.kind, item.name, item.description, item.source, false, item.resource)

  // Claude Code: personal, plugin and project skills and agents; MCP servers.
  found.skills('claude', join(claudeDir, 'skills'), 'pessoal')
  found.agents(join(claudeDir, 'agents'), 'pessoal')
  const installed = readText(join(claudeDir, 'plugins', 'installed_plugins.json'))
  if (installed) {
    try {
      const plugins = (JSON.parse(installed) as { plugins?: Record<string, unknown> }).plugins ?? {}
      for (const [key, value] of Object.entries(plugins)) {
        const plugin = key.split('@')[0]!
        for (const install of (Array.isArray(value) ? value : [value]) as Array<{ installPath?: string }>) {
          if (!install?.installPath || !isDir(install.installPath)) continue
          found.skills('claude', join(install.installPath, 'skills'), `plugin ${plugin}`, `${plugin}:`)
          found.agents(join(install.installPath, 'agents'), `plugin ${plugin}`, `${plugin}:`)
        }
      }
    } catch {
      // unreadable plugin list: plugins stay out
    }
  }
  const state = claudeState(claudeDir)
  found.mcpServers(state.mcpServers, 'pessoal')
  for (const folder of folders) {
    const project = `projeto ${basename(folder)}`
    found.skills('claude', join(folder, '.claude', 'skills'), project, '', folder)
    found.skills('codex', join(folder, '.agents', 'skills'), project, '', folder)
    found.skills('codex', join(folder, '.codex', 'skills'), project, '', folder)
    found.agents(join(folder, '.claude', 'agents'), project)
    found.mcpServers(state.projects?.[folder]?.mcpServers, project)
    const mcpJson = readText(join(folder, '.mcp.json'))
    if (mcpJson) {
      try {
        found.mcpServers(JSON.parse(mcpJson).mcpServers, project)
      } catch {
        // not valid JSON
      }
    }
  }

  // Codex: skills, and MCP servers as Codex itself lists them (with plugins and on/off state).
  found.skills('codex', join(codexDir, 'skills'), 'pessoal')
  found.skills('codex', join(codexDir, 'skills', '.system'), 'sistema')
  const listed = await run('codex mcp list --json', 30_000)
  let servers: Array<{ name?: string; enabled?: boolean; transport?: Record<string, unknown> }> | null = null
  try {
    servers = listed.code === 0 ? JSON.parse(listed.stdout) : null
  } catch {
    servers = null
  }
  if (Array.isArray(servers)) {
    for (const s of servers) if (s.name) found.add('codex', 'mcp', s.name, transport(s.transport), 'config', s.enabled === false)
  } else {
    // Without the CLI, the server names in config.toml are still there.
    for (const match of (readText(join(codexDir, 'config.toml')) ?? '').matchAll(/^\[mcp_servers\.("?)([^\]."]+)\1\]\s*$/gm)) found.add('codex', 'mcp', match[2]!, '', 'config')
  }

  return found.items.sort((a, b) => a.cli.localeCompare(b.cli) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}

export function bundledCatalog(dir = BUNDLED_SKILLS): CatalogItem[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { version: number; skills: Array<{ name: string; version: string; role: string; compatibility: AgentCliForRole[]; sha256: string; bytes: number }> }
  if (manifest.version !== 1 || !Array.isArray(manifest.skills)) throw new Error('Manifesto de skills incompatível')
  return manifest.skills.flatMap(s => {
    if (!/^orbit-[a-z0-9-]{1,50}$/.test(s.name) || !s.compatibility?.every(cli => AGENT_CLIS.includes(cli))) throw new Error('Manifesto de skills inválido')
    const { text, realRoot, realPath } = skillText(dir, join(dir, s.name, 'SKILL.md'))
    const meta = frontMatter(text)
    if (meta.name !== s.name || !meta.description || hash(text) !== s.sha256 || Buffer.byteLength(text) !== s.bytes) throw new Error(`Integridade inválida na skill ${s.name}`)
    return s.compatibility.map(cli => ({ id: catalogId(cli, 'skill', s.name), cli, kind: 'skill' as const, name: s.name, description: meta.description!, source: 'Orbit', offInCli: false,
      resource: { path: realPath, root: realRoot, sha256: s.sha256, bytes: s.bytes, version: s.version, origin: 'bundled' as const, projectRoot: null, role: s.role, compatibility: s.compatibility } }))
  })
}

/** Filter project resources to this mission, even when the UI catalog covers several workspaces. */
export function missionSkills(items: CatalogItem[], cli: AgentCliForRole, folders: string[], disabled: ReadonlySet<string>, policy?: SkillPolicy): CatalogItem[] {
  const roots = folders.map(folder => { try { return realpathSync(folder) } catch { return folder } })
  return items.filter(item => item.cli === cli && item.kind === 'skill' && item.resource && !item.offInCli && !disabled.has(item.id)
    && (!item.resource.projectRoot || roots.includes(item.resource.projectRoot))
    && (!policy?.only || policy.only.some(name => item.name === name || item.name.endsWith(`:${name}`))))
}

/** What a pane may use beyond what is switched off for everyone. */
export interface SkillPolicy {
  /** Only these skills (by name), or null for any. */
  only: string[] | null
}

/** MCP tool names carry the server name with anything unusual replaced by `_`. */
const mcpKey = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_')

/**
 * Whether Claude may run a tool, from its PreToolUse hook: skills, subagents and MCP servers that
 * are switched off in Orbit, or outside the agent's own skill list, are refused with a reason.
 */
export function gateTool(payload: HookPayload, disabled: ReadonlySet<string>, policy: SkillPolicy | undefined): string | null {
  if (payload.hook_event_name !== 'PreToolUse' || typeof payload.tool_name !== 'string') return null
  const tool = payload.tool_name
  const input = (payload.tool_input ?? {}) as Record<string, unknown>
  if (tool === 'Skill' && typeof input.skill === 'string') {
    const skill = input.skill
    if (disabled.has(catalogId('claude', 'skill', skill))) return `A skill "${skill}" está desligada no Orbit. Siga sem ela.`
    const only = policy?.only
    if (only && !only.some((name) => name === skill || skill.endsWith(`:${name}`))) {
      return only.length ? `Neste papel você só usa estas skills: ${only.join(', ')}. Siga sem "${skill}".` : `Neste papel você não usa skills. Siga sem "${skill}".`
    }
    return null
  }
  if ((tool === 'Task' || tool === 'Agent') && typeof input.subagent_type === 'string') {
    const agent = input.subagent_type
    return disabled.has(catalogId('claude', 'agent', agent)) ? `O subagente "${agent}" está desligado no Orbit. Siga sem ele.` : null
  }
  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? ''
    if (server === 'orbit') return null
    for (const id of disabled) {
      if (id.startsWith('claude:mcp:') && mcpKey(id.slice('claude:mcp:'.length)) === server) return `O servidor MCP "${id.slice('claude:mcp:'.length)}" está desligado no Orbit. Siga sem ele.`
    }
  }
  return null
}

/** Codex MCP servers switched off in Orbit, as `-c` overrides (only plain names reach the command line). */
export function codexDisabledMcp(disabled: Iterable<string>): string[] {
  return [...disabled].filter((id) => id.startsWith('codex:mcp:')).map((id) => id.slice('codex:mcp:'.length)).filter((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name))
}
