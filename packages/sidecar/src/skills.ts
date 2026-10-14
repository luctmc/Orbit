import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { catalogId, type AgentCliForRole, type CatalogItem, type CatalogKind } from '@orbit/protocol'
import type { Run } from './clis.ts'
import type { HookPayload } from './hooks.ts'

const DESCRIPTION_MAX = 300

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

  add(cli: AgentCliForRole, kind: CatalogKind, name: string, description: string, source: string, offInCli = false): void {
    const id = catalogId(cli, kind, name)
    if (!name || this.seen.has(id)) return
    this.seen.add(id)
    this.items.push({ id, cli, kind, name, description: description.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX), source, offInCli })
  }

  /** `<dir>/<skill>/SKILL.md`, named by its front matter (or folder). */
  skills(cli: AgentCliForRole, dir: string, source: string, prefix = ''): void {
    for (const entry of listDir(dir)) {
      if (entry.startsWith('.')) continue
      const text = readText(join(dir, entry, 'SKILL.md'))
      if (text === null) continue
      const meta = frontMatter(text)
      this.add(cli, 'skill', `${prefix}${meta.name || entry}`, meta.description ?? '', source)
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
export async function scanCatalog({ claudeDir, codexDir, folders, run }: ScanInput): Promise<CatalogItem[]> {
  const found = new Collector()

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
    found.skills('claude', join(folder, '.claude', 'skills'), project)
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
