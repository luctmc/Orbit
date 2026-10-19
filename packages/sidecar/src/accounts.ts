import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ACCOUNT_FULL_PERCENT, ACCOUNT_LIMITS, MODEL_ID, type Account, type AccountInput, type AccountLimits, type AccountStatus, type AgentCliForRole } from '@orbit/protocol'
import { shellQuote } from './command.ts'
import type { Run } from './clis.ts'

/** The CLIs' own login on this Mac: no extra environment, the person's usual config folders. */
export const BUILTIN_ACCOUNTS: readonly Account[] = [
  { id: 'claude', cli: 'claude', name: 'Claude deste Mac', kind: 'assinatura', builtin: true, baseUrl: null, model: null, keyHint: null, auto: true, createdAt: 0 },
  { id: 'codex', cli: 'codex', name: 'Codex deste Mac', kind: 'assinatura', builtin: true, baseUrl: null, model: null, keyHint: null, auto: true, createdAt: 0 },
  { id: 'gemini', cli: 'gemini', name: 'Gemini deste Mac', kind: 'assinatura', builtin: true, baseUrl: null, model: null, keyHint: null, auto: true, createdAt: 0 },
  { id: 'antigravity', cli: 'antigravity', name: 'Antigravity deste Mac', kind: 'assinatura', builtin: true, baseUrl: null, model: null, keyHint: null, auto: true, createdAt: 0 },
]

/** CLIs that can have extra accounts besides this Mac's own login. */
export const MULTI_ACCOUNT: readonly AgentCliForRole[] = ['claude', 'codex', 'gemini']

/** What the person set up in their own config folders, shared with every extra account (logins are not). */
const SHARED: Record<AgentCliForRole, string[]> = {
  claude: ['settings.json', 'CLAUDE.md', 'agents', 'skills', 'commands', 'plugins', 'output-styles'],
  codex: ['config.toml', 'AGENTS.md', 'prompts', 'skills'],
  gemini: ['settings.json', 'GEMINI.md', 'extensions', 'skills', 'commands', 'policies', 'trustedFolders.json'],
  antigravity: [],
}

/** Where the CLI keeps its config on this Mac (Gemini: the `.gemini` folder under its home). */
export function userConfigDir(cli: AgentCliForRole): string {
  switch (cli) {
    case 'claude':
      return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    case 'codex':
      return process.env.CODEX_HOME ?? join(homedir(), '.codex')
    case 'gemini':
      return join(process.env.GEMINI_CLI_HOME ?? homedir(), '.gemini')
    case 'antigravity':
      return join(homedir(), '.gemini', 'antigravity-cli')
  }
}

/** Environment variable that moves the CLI's config folder (Gemini's is a home with `.gemini` inside). */
const CONFIG_ENV: Partial<Record<AgentCliForRole, string>> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME', gemini: 'GEMINI_CLI_HOME' }

export function blankAccountStatus(accountId: string): AccountStatus {
  return { accountId, loggedIn: null, method: null, email: null, plan: null, checkedAt: null, busy: null, loginPaneId: null, message: null }
}

/** Validates what the UI sent; `existing` is the account being edited, if any. */
export function normalizeAccount(input: AccountInput, existing: Account | undefined, id: string): Omit<Account, 'keyHint'> {
  if (!MULTI_ACCOUNT.includes(input.cli)) throw new Error(input.cli === 'antigravity' ? 'O Antigravity usa só a conta deste Mac' : 'CLI desconhecida')
  if (input.kind !== 'assinatura' && input.kind !== 'api') throw new Error('Tipo de conta desconhecido')
  if (existing && (existing.cli !== input.cli || existing.kind !== input.kind)) throw new Error('A CLI e o tipo de uma conta não mudam; crie outra')
  const name = (typeof input.name === 'string' ? input.name.trim() : '').slice(0, ACCOUNT_LIMITS.name)
  if (!name) throw new Error('Dê um nome à conta')
  let baseUrl: string | null = null
  if (input.kind === 'api' && input.cli === 'claude' && input.baseUrl?.trim()) {
    const raw = input.baseUrl.trim().slice(0, ACCOUNT_LIMITS.url)
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error(`Endereço inválido: ${raw}`)
    }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Use um endereço https (http só para localhost)')
    baseUrl = raw.replace(/\/+$/, '')
  }
  const model = input.model?.trim() || null
  if (model && !MODEL_ID.test(model)) throw new Error(`Modelo inválido: ${model}`)
  return {
    id,
    cli: input.cli,
    name,
    kind: input.kind,
    builtin: false,
    baseUrl,
    model: input.kind === 'api' ? model : null,
    // API keys cost money: Orbit only picks them by itself when asked to.
    auto: input.auto ?? existing?.auto ?? input.kind === 'assinatura',
    createdAt: existing?.createdAt ?? Date.now(),
  }
}

export function validKey(key: string): string {
  const clean = key.trim()
  if (!clean) throw new Error('Cole a chave de API')
  if (clean.length > ACCOUNT_LIMITS.key || /\s/.test(clean)) throw new Error('Essa chave não parece válida')
  return clean
}

/** Room left on an account: the fullest of its windows still running (0 when unknown). */
export function usedPercent(limits: AccountLimits | undefined, now = Date.now()): number {
  if (!limits) return 0
  return Math.max(0, ...[limits.fiveHour, limits.weekly].filter((w) => w && w.resetsAt > now).map((w) => w!.usedPercent))
}

/**
 * The account an agent runs as when none was chosen: the subscription with the most room left;
 * API accounts (paid per token) only once every subscription is used up, and only those marked
 * for automatic use. Logged-out accounts are skipped.
 */
export function pickAccount(cli: AgentCliForRole, accounts: Account[], statuses: AccountStatus[], limits: AccountLimits[], now = Date.now()): Account {
  const status = (a: Account) => statuses.find((s) => s.accountId === a.id)
  const usable = accounts.filter((a) => a.cli === cli && a.auto && (a.kind === 'api' ? a.keyHint !== null : status(a)?.loggedIn !== false))
  const used = (a: Account) => usedPercent(limits.find((l) => l.accountId === a.id), now)
  const byRoom = (list: Account[]) => [...list].sort((a, b) => used(a) - used(b) || Number(b.builtin) - Number(a.builtin) || a.createdAt - b.createdAt)
  const subscriptions = byRoom(usable.filter((a) => a.kind === 'assinatura'))
  const open = subscriptions.find((a) => used(a) < ACCOUNT_FULL_PERCENT)
  if (open) return open
  const api = usable.filter((a) => a.kind === 'api').sort((a, b) => a.createdAt - b.createdAt)[0]
  return api ?? subscriptions[0] ?? accounts.find((a) => a.builtin && a.cli === cli)!
}

/** Where Orbit keeps an extra account: its own CLI config folder and, for API accounts, the key. */
export class AccountFiles {
  private readonly root: string

  constructor(dataDir: string) {
    this.root = join(dataDir, 'accounts')
  }

  /** CLAUDE_CONFIG_DIR / CODEX_HOME for the account; null = the CLI's usual folder. */
  configDir(account: Account): string | null {
    return account.builtin ? null : join(this.root, account.id, account.cli)
  }

  keyPath(account: Account): string {
    return join(this.root, account.id, 'key')
  }

  /**
   * Creates the account's config folder. Settings, instructions, skills and agents are linked
   * from the person's usual folder so every account works the same; logins stay apart.
   */
  prepare(account: Account): void {
    const dir = this.configDir(account)
    if (!dir) return
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const source = userConfigDir(account.cli)
    // Gemini reads `<GEMINI_CLI_HOME>/.gemini`.
    const target = account.cli === 'gemini' ? join(dir, '.gemini') : dir
    mkdirSync(target, { recursive: true, mode: 0o700 })
    for (const name of SHARED[account.cli]) {
      const from = join(source, name)
      const to = join(target, name)
      if (!existsSync(from) || existsSync(to)) continue
      try {
        symlinkSync(from, to)
      } catch {
        // a missing link only means that piece is not shared
      }
    }
    // Skips Claude Code's first-run screens (theme, intro) in a folder made by Orbit.
    const state = join(dir, '.claude.json')
    if (account.cli === 'claude' && !existsSync(state)) writeFileSync(state, JSON.stringify({ hasCompletedOnboarding: true }), { mode: 0o600 })
  }

  saveKey(account: Account, key: string): void {
    mkdirSync(join(this.root, account.id), { recursive: true, mode: 0o700 })
    writeFileSync(this.keyPath(account), key, { mode: 0o600 })
  }

  hasKey(account: Account): boolean {
    return existsSync(this.keyPath(account))
  }

  remove(account: Account): void {
    if (!account.builtin) rmSync(join(this.root, account.id), { recursive: true, force: true })
  }

  /** Environment an agent of this account starts with. */
  env(account: Account): Record<string, string> {
    const env: Record<string, string> = {}
    const dir = this.configDir(account)
    const variable = CONFIG_ENV[account.cli]
    if (dir && variable) env[variable] = dir
    // Gemini takes its key from the environment; it is the agent's own key, as in Codex's login.
    if (account.cli === 'gemini' && account.kind === 'api' && this.hasKey(account)) env.GEMINI_API_KEY = readFileSync(this.keyPath(account), 'utf8').trim()
    if (account.cli === 'claude' && account.kind === 'api') {
      if (account.baseUrl) env.ANTHROPIC_BASE_URL = account.baseUrl
      if (account.baseUrl === 'https://openrouter.ai/api') {
        env.ANTHROPIC_API_KEY = ''
        env.ANTHROPIC_AUTH_TOKEN = ''
        // Bearer authentication is required by OpenRouter; only this isolated child receives it.
        if (this.hasKey(account)) env.ANTHROPIC_AUTH_TOKEN = readFileSync(this.keyPath(account), 'utf8').trim()
      }
      if (account.model) {
        env.ANTHROPIC_MODEL = account.model
        // Claude Code's aliases and background calls go to the provider's model too.
        for (const tier of ['OPUS', 'SONNET', 'HAIKU']) env[`ANTHROPIC_DEFAULT_${tier}_MODEL`] = account.model
      }
    }
    return env
  }

  /** Native API accounts use apiKeyHelper; OpenRouter requires an isolated bearer environment. */
  apiKeyHelper(account: Account): string | undefined {
    return account.cli === 'claude' && account.kind === 'api' && account.baseUrl !== 'https://openrouter.ai/api' ? `cat ${shellQuote(this.keyPath(account))}` : undefined
  }

  /** `VAR='…' ` prefix for running the CLI as this account in a shell command. */
  envPrefix(account: Account): string {
    return Object.entries(this.env(account)).map(([k, v]) => k === 'ANTHROPIC_AUTH_TOKEN' ? `${k}=\"$(cat ${shellQuote(this.keyPath(account))})\" ` : `${k}=${shellQuote(v)} `).join('')
  }

  /** Logs a Codex API account in with its key, read from the file (never on the command line). */
  async codexKeyLogin(run: Run, account: Account): Promise<{ ok: boolean; message: string | null }> {
    const result = await run(`${this.envPrefix(account)}codex login --with-api-key < ${shellQuote(this.keyPath(account))}`, 60_000)
    return { ok: result.code === 0, message: result.code === 0 ? null : (result.stderr || result.stdout).trim().slice(-400) || 'O Codex recusou a chave.' }
  }

  /** Asks the CLI about this account's login. */
  async check(run: Run, account: Account): Promise<Partial<AccountStatus>> {
    if ((account.cli === 'claude' || account.cli === 'gemini') && account.kind === 'api') {
      return { loggedIn: this.hasKey(account), method: account.baseUrl ? `chave · ${new URL(account.baseUrl).host}` : 'chave de API', email: null, plan: null }
    }
    if (account.cli === 'gemini') {
      // Gemini CLI has no status command: its Google login leaves this file behind.
      const home = this.configDir(account) ?? process.env.GEMINI_CLI_HOME ?? homedir()
      if (account.builtin && process.env.GEMINI_API_KEY) return { loggedIn: true, method: 'chave de API (ambiente)', email: null, plan: null, message: null }
      // A Google login is there, but Google moved personal accounts from Gemini CLI to
      // Antigravity: only company (Code Assist) and Vertex logins still work, and Orbit cannot tell.
      if (existsSync(join(home, '.gemini', 'oauth_creds.json'))) {
        return { loggedIn: null, method: 'conta Google', email: null, plan: null, message: 'O login Google do Gemini CLI só vale para contas de empresa ou Vertex; contas pessoais passaram para o Antigravity. Com conta pessoal, use uma chave do Google AI Studio (Nova conta › Gemini › Chave de API).' }
      }
      return { loggedIn: false, method: null, message: 'Use uma chave do Google AI Studio (Nova conta › Gemini › Chave de API) ou entre com conta Google de empresa pelo botão Entrar.' }
    }
    if (account.cli === 'antigravity') {
      const result = await run('agy models', 30_000)
      const text = `${result.stdout}\n${result.stderr}`
      if (/command not found|not found: agy/i.test(text)) return { loggedIn: false, method: null, message: 'O Antigravity CLI (agy) não está instalado.' }
      if (/sign in/i.test(text)) return { loggedIn: false, method: null, message: 'Entre pelo botão Entrar (abre o Antigravity CLI).' }
      return result.code === 0 ? { loggedIn: true, method: 'conta Google', email: null, plan: null, message: null } : { loggedIn: null, message: text.trim().slice(-300) || 'O Antigravity não respondeu.' }
    }
    if (account.cli === 'claude') {
      const result = await run(`${this.envPrefix(account)}claude auth status`, 30_000)
      try {
        const status = JSON.parse(result.stdout) as { loggedIn?: boolean; authMethod?: string; email?: string; subscriptionType?: string; orgName?: string }
        return {
          loggedIn: status.loggedIn === true,
          method: status.authMethod && status.authMethod !== 'none' ? status.authMethod : null,
          email: status.email ?? null,
          plan: [status.subscriptionType, status.orgName?.trim()].filter(Boolean).join(' · ') || null,
          message: null,
        }
      } catch {
        return { loggedIn: null, message: (result.stderr || result.stdout).trim().slice(-300) || 'O Claude Code não respondeu.' }
      }
    }
    const result = await run(`${this.envPrefix(account)}codex login status`, 30_000)
    const text = `${result.stdout}\n${result.stderr}`
    if (/not logged in/i.test(text)) return { loggedIn: false, method: null, message: null }
    const using = /logged in using (an? )?([^\n-]+)/i.exec(text)
    if (using) return { loggedIn: true, method: /api key/i.test(using[2]!) ? 'chave de API' : using[2]!.trim(), message: null }
    return { loggedIn: null, message: text.trim().slice(-300) || 'O Codex não respondeu.' }
  }

  /** Signs the CLI out of an extra account before its folder goes away (Claude keeps logins in the Keychain). */
  async logout(run: Run, account: Account): Promise<void> {
    if (account.builtin || account.cli !== 'codex' && (account.kind === 'api' || account.cli !== 'claude')) return
    await run(`${this.envPrefix(account)}${account.cli === 'claude' ? 'claude auth logout' : 'codex logout'}`, 30_000)
  }
}

/** Last four characters, for the UI to tell keys apart. */
export function keyHint(key: string): string {
  return `…${key.slice(-4)}`
}

/** Older limits were per CLI; they belong to the built-in accounts. */
export function migrateLimits(limits: Array<AccountLimits | Omit<AccountLimits, 'accountId'>>): AccountLimits[] {
  return limits.map((l) => ('accountId' in l && l.accountId ? l : { ...l, accountId: l.cli }))
}
