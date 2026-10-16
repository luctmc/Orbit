import { ACCOUNT_FULL_PERCENT, type CliCatalog, type Difficulty, type Effort, type Account, type AccountLimits, type AccountStatus, type AgentCliForRole, type TaskType } from '@orbit/protocol'
import type { DecisionReceipt, Routing, Squad } from '@orbit/protocol'
import { createHash } from 'node:crypto'

export function decisionReceipt(input: Omit<DecisionReceipt, 'version' | 'policyRevision' | 'at'>, policy: { routing: Routing; squad?: Squad; allowedClis: AgentCliForRole[]; requireReadOnlySandbox: boolean }): DecisionReceipt {
  const { revision: _, ...routing } = policy.routing
  return { ...input, version: 1, policyRevision: createHash('sha256').update(JSON.stringify({ ...policy, routing })).digest('hex'), at: Date.now() }
}

/**
 * The maestro's decisions, kept apart from the core so they can be tested: which task type an
 * activity is, and which account (and, if needed, which CLI) takes the next agent.
 */

/** Words that point to each built-in task type; custom types match by their own name. */
const KEYWORDS: Record<string, RegExp> = {
  operacao: /\b(build|compil|execut|inici|start|run|install|instal|servidor|dev server)/gi,
  bug: /\b(bug|erro|error|fail|fix|broken|falha|quebr|corrig|conserta|regress|exce[cç][aã]o|crash|n[aã]o funciona)/gi,
  testes: /\b(testes?|test|cobertura|spec|unit[aá]rio|e2e|jest|vitest|pytest)\b/gi,
  documentacao: /\b(doc|docs|documenta|readme|changelog|coment[aá]rio|guia|notas de vers)|[\w-]+\.md\b/gi,
  refatoracao: /\b(refator|refactor|reorganiz|limpa|renomei|extrai|simplific)/gi,
  investigacao: /\b(investig|analis|analy|diagnos|research|descobr|entend|mapei|audit|por que|porqu[eê]|diagn[oó]stic|medi[rç])/gi,
  revisao: /\b(revis|review|revisar|conferir|validar o trabalho|cr[ií]tic)/gi,
  funcionalidade: /\b(implement|criar|cria|adicion|nova|novo|feature|funcionalidade|tela|endpoint)/gi,
}

/** On equal scores the first wins (a "test for a bug fix" is a test). */
const ORDER = ['revisao', 'testes', 'bug', 'documentacao', 'refatoracao', 'investigacao', 'funcionalidade', 'operacao']
/** A word in the title says more about the activity than one in the task's details. */
const TITLE_WEIGHT = 3

export interface Classified {
  type: TaskType
  /** Why this row: the words that matched, or "padrão". */
  via: string
  /** One type clearly ahead; false when nothing matched or two types came close. */
  sure: boolean
}

/**
 * The task type of an activity the lead did not classify, from its title and text: each type
 * scores its words (title words weigh more); a clear winner decides, otherwise it is not "sure"
 * and the maestro may ask a model.
 */
export function classifyTask(text: string, types: TaskType[], title = ''): Classified {
  const body = text.slice(0, 4000)
  const head = title.slice(0, 200)
  const words = (re: RegExp, where: string) => [...where.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].map((m) => m[0].trim().toLowerCase())
  const scored = types.map((type) => {
    const re = KEYWORDS[type.id] ?? (() => {
      const names = type.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      return names.length ? new RegExp(`\\b(${names.join('|')})`, 'gi') : null
    })()
    if (!re) return { type, score: 0, hit: [] as string[] }
    const inTitle = words(re, head)
    const inBody = words(re, body)
    return { type, score: inTitle.length * TITLE_WEIGHT + Math.min(5, inBody.length), hit: [...new Set([...inTitle, ...inBody])] }
  })
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length)
  scored.sort((a, b) => b.score - a.score || rank(a.type.id) - rank(b.type.id))
  const [best, second] = scored
  if (!best || best.score === 0) return { type: types.find((t) => t.id === 'funcionalidade') ?? types[0]!, via: 'padrão', sure: false }
  const sure = !second || second.score === 0 || best.score >= 2 * second.score
  const quote = (hit: string[]) => hit.slice(0, 2).map((w) => `"${w}"`).join(', ')
  return {
    type: best.type,
    via: `palavra${best.hit.length > 1 ? 's' : ''} ${quote(best.hit)}${sure ? '' : `; ${second!.type.name} também (${quote(second!.hit)})`}`,
    sure,
  }
}

/** Conservative local policy. Risk wins over a cheap operation; no model call for obvious work. */
export function assessDifficulty(title: string, task: string): { difficulty: Difficulty; why: string } {
  const text = `${title}\n${task}`.slice(0, 20_200)
  const risk = /architect|arquitet|reestrutur|cross[- ]cutting|v[aá]rios m[oó]dulos|multiple modules|race condition|concurren|concorr|intermittent|intermitente|unknown cause|causa desconhecida|seguran[cç]a|security|migra.{0,30}(banco|database)|distributed|distribu[ií]d/i
  if (risk.test(text)) return { difficulty: 'dificil', why: 'escopo amplo, risco ou diagnóstico complexo' }
  const operation = /\b(run|execute|executar|rodar|inicie|iniciar|start|install|instalar|verificar|check)\b.{0,80}\b(build|compil|npm|pnpm|yarn|test|testes|projeto|project|servidor|server|depend)/i
  const small = /\b(typo|ortografia|renomear|rename|small|pequeno|simples|simple)\b/i
  const changes = /implement|refactor|refator|reestrutur|diagnos|investig|corrig|fix|adicion|add\b|create|criar/i
  if ((operation.test(text) || small.test(text)) && !changes.test(text)) return { difficulty: 'simples', why: 'operação delimitada sem implementação ou diagnóstico' }
  return { difficulty: 'normal', why: 'escopo sem sinais suficientes para reduzir ou elevar o modelo' }
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

/** Cheaper and stronger models of each CLI, where the CLI has a ladder Orbit knows. */
const LADDER: Partial<Record<AgentCliForRole, { cheap: string; strong: string }>> = {
  claude: { cheap: 'claude-haiku-5-5', strong: 'claude-opus-5-5' },
  gemini: { cheap: 'flash', strong: 'pro' },
}

/**
 * The seat for an activity's difficulty: simple goes to the CLI's cheaper model (or less effort),
 * hard to its stronger model with more effort (or just more effort). `efforts` are the levels the
 * resulting model takes, in order; an effort it does not take is dropped.
 */
export function seatForDifficulty(cli: AgentCliForRole, model: string | null, effort: Effort | null, difficulty: Difficulty, effortsOf: (model: string | null) => readonly Effort[], catalog?: CliCatalog): { model: string | null; effort: Effort | null; changed: boolean } {
  if (difficulty === 'normal') return { model, effort, changed: false }
  const ladder = LADDER[cli]
  // Catalog order is the CLI's preference. Select known families only, never invent a Codex id.
  const candidates = catalog?.models ?? []
  const family = difficulty === 'simples' ? /luna|mini|haiku|flash|fast and affordable|lightweight|cost.efficient/i : /astra|opus|frontier|most demanding/i
  const candidate = !ladder ? candidates.find((m) => family.test(`${m.id} ${m.description}`)) : undefined
  const nextModel = candidate?.id ?? (ladder ? (difficulty === 'simples' ? ladder.cheap : ladder.strong) : model)
  const levels = effortsOf(nextModel)
  const at = effort ? levels.indexOf(effort) : -1
  let nextEffort: Effort | null = effort
  if (levels.length) {
    if (difficulty === 'simples') nextEffort = levels[0]!
    else nextEffort = levels[Math.min(levels.length - 1, Math.max(at, levels.indexOf('medium')) + 1)] ?? effort
  }
  if (nextEffort && !levels.includes(nextEffort)) nextEffort = null
  return { model: nextModel, effort: nextEffort, changed: nextModel !== model || nextEffort !== effort }
}

/** Each running agent weighs like this many points of use, so agents spread across accounts. */
export const LIVE_WEIGHT = 15
/** A CLI this many points busier than the other sends the work to the other's equivalent. */
export const BALANCE_GAP = 30

/**
 * How busy a CLI is for the next agent: the best subscription's use plus its agents (points);
 * null when every subscription is used up. API keys do not count: they are the last resort.
 */
export function cliLoad(rooms: AccountRoom[]): number | null {
  const open = rooms.filter((r) => r.account.kind === 'assinatura' && !r.full).map((r) => (r.used ?? 0) + r.live * LIVE_WEIGHT)
  return open.length ? Math.min(...open) : null
}

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

