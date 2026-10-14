import { ACCOUNT_FULL_PERCENT, type Account, type AccountLimits, type AccountStatus, type AgentCliForRole, type TaskType } from '@orbit/protocol'

/**
 * The maestro's decisions, kept apart from the core so they can be tested: which task type an
 * activity is, and which account (and, if needed, which CLI) takes the next agent.
 */

/** Words that point to each built-in task type; custom types match by their own name. */
const KEYWORDS: Record<string, RegExp> = {
  bug: /\b(bug|erro|falha|quebr|corrig|conserta|regress|exce[cç][aã]o|crash|n[aã]o funciona)/i,
  testes: /\b(testes?|test|cobertura|spec|unit[aá]rio|e2e|jest|vitest|pytest)\b/i,
  documentacao: /\b(doc|docs|documenta|readme|changelog|coment[aá]rio|guia|notas de vers)/i,
  refatoracao: /\b(refator|refactor|reorganiz|limpa|renomei|extrai|simplific)/i,
  investigacao: /\b(investig|analis|descobr|entend|mapei|audit|por que|porqu[eê]|diagn[oó]stic|medi[rç])/i,
  revisao: /\b(revis|review|revisar|conferir|validar o trabalho|cr[ií]tic)/i,
  funcionalidade: /\b(implement|criar|cria|adicion|nova|novo|feature|funcionalidade|tela|endpoint)/i,
}

/** Order matters: the first match wins (a "test for a bug fix" is a test). */
const ORDER = ['revisao', 'testes', 'bug', 'documentacao', 'refatoracao', 'investigacao', 'funcionalidade']

export interface Classified {
  type: TaskType
  /** Why this row: the word that matched, or "padrão". */
  via: string
}

/** The task type of an activity the lead did not classify, from its title and text. */
export function classifyTask(text: string, types: TaskType[]): Classified {
  const haystack = text.slice(0, 4000)
  for (const id of ORDER) {
    const type = types.find((t) => t.id === id)
    const match = type && KEYWORDS[id]?.exec(haystack)
    if (type && match) return { type, via: `palavra "${match[0].trim().toLowerCase()}"` }
  }
  for (const type of types) {
    if (ORDER.includes(type.id)) continue
    const words = type.name.toLowerCase().split(/\W+/u).filter((w) => w.length >= 4)
    const hit = words.find((w) => haystack.toLowerCase().includes(w))
    if (hit) return { type, via: `palavra "${hit}"` }
  }
  return { type: types.find((t) => t.id === 'funcionalidade') ?? types[0]!, via: 'padrão' }
}

export interface AccountRoom {
  account: Account
  /** Highest use of its running windows, 0–100; null when nothing was read yet. */
  used: number | null
  /** Agents running on it now. */
  live: number
  /** When its fullest window frees up (epoch ms), if it is full. */
  resetsAt: number | null
  full: boolean
}

/** Every usable account of a CLI with its room: logged in (or with a key) and allowed for automatic use. */
export function accountRooms(cli: AgentCliForRole, accounts: Account[], statuses: AccountStatus[], limits: AccountLimits[], live: ReadonlyMap<string, number>, now = Date.now()): AccountRoom[] {
  return accounts
    .filter((a) => a.cli === cli && a.auto && (a.kind === 'api' ? a.keyHint !== null : statuses.find((s) => s.accountId === a.id)?.loggedIn !== false))
    .map((account) => {
      const l = limits.find((x) => x.accountId === account.id)
      const windows = l ? [l.fiveHour, l.weekly].filter((w): w is NonNullable<typeof w> => Boolean(w && w.resetsAt > now)) : []
      const used = l ? Math.max(0, ...windows.map((w) => w.usedPercent)) : null
      const full = account.kind === 'assinatura' && used !== null && used >= ACCOUNT_FULL_PERCENT
      const resetsAt = full ? Math.min(...windows.filter((w) => w.usedPercent >= ACCOUNT_FULL_PERCENT).map((w) => w.resetsAt)) : null
      return { account, used, live: live.get(account.id) ?? 0, resetsAt, full }
    })
}

/** Each running agent weighs like this many points of use, so agents spread across accounts. */
export const LIVE_WEIGHT = 15

export interface AccountChoice {
  account: Account | null
  reason: string
  /** Every subscription is used up and no API key may take over. */
  exhausted: boolean
  /** When the first used-up account frees up again. */
  backAt: number | null
}

/**
 * The account for the next agent: among subscriptions not used up, the one with the most room
 * counting the agents already on it; an API key only when every subscription is used up.
 */
export function chooseAccount(rooms: AccountRoom[]): AccountChoice {
  const label = (r: AccountRoom) => `${r.account.builtin ? 'conta deste Mac' : r.account.name} (${r.used === null ? 'sem leitura de limite' : `${Math.round(r.used)}% usado`}, ${r.live} ${r.live === 1 ? 'agente' : 'agentes'} nela)`
  const open = rooms.filter((r) => r.account.kind === 'assinatura' && !r.full)
    .sort((a, b) => (a.used ?? 0) + a.live * LIVE_WEIGHT - ((b.used ?? 0) + b.live * LIVE_WEIGHT) || Number(b.account.builtin) - Number(a.account.builtin) || a.account.createdAt - b.account.createdAt)
  if (open[0]) return { account: open[0].account, reason: open.length > 1 ? `${label(open[0])}: a de mais folga entre ${open.length}` : label(open[0]), exhausted: false, backAt: null }
  const api = rooms.filter((r) => r.account.kind === 'api').sort((a, b) => a.account.createdAt - b.account.createdAt)[0]
  const resets = rooms.filter((r) => r.resetsAt !== null).map((r) => r.resetsAt!)
  const backAt = resets.length ? Math.min(...resets) : null
  if (api) return { account: api.account, reason: `${api.account.name} (chave de API): as assinaturas estão no limite`, exhausted: false, backAt }
  return { account: null, reason: rooms.length ? 'todas as contas estão no limite' : 'nenhuma conta disponível para uso automático', exhausted: true, backAt }
}

const OTHER: Record<AgentCliForRole, AgentCliForRole> = { claude: 'codex', codex: 'claude' }
export const otherCli = (cli: AgentCliForRole) => OTHER[cli]
