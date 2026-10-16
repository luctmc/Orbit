import { CARD_COLUMN_LABEL, CARD_COLUMNS, CLI_NAME, type Card, type FolderStatus, type GitSummary, type Mission, type MissionEvent, type Pane, type PrStatus, type Squad, type Workspace } from '@orbit/protocol'

export interface ReportInput {
  mission: Mission
  workspace: Workspace | undefined
  squad: Squad | undefined
  panes: Pane[]
  /** Accounts' display names by id (only the ones that are not this Mac's). */
  accountNames: Record<string, string>
  cards: Card[]
  events: MissionEvent[]
  /** Worktree missions: the mission branch against its base. */
  git: GitSummary | null
  pr: PrStatus | null
  /** Other missions: what differs from the last commit in the workspace folders now. */
  folders: FolderStatus[]
  now?: number
}

const MODE = { livre: 'Livre', squad: 'Squad', agentica: 'Agêntica' } as const
const CLI = CLI_NAME

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : n >= 1e3 ? `${Math.round(n / 1e3).toLocaleString('pt-BR')} mil` : String(n))
const when = (at: number) => new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const clock = (at: number) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}

/** One line of text for a list item (no line breaks inside Markdown lists). */
const line = (text: string, max = 400) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const HANDOFF_TEXT = { done: 'entregou', blocked: 'entregou bloqueado', auto: 'o Orbit entregou por ele' } as const

/** The mission as a Markdown report: setup, numbers, agents, board, deliveries, changes, timeline. */
export function missionReport(input: ReportInput): string {
  const { mission, workspace, squad, panes, cards, events, git, pr, folders } = input
  const now = input.now ?? Date.now()
  const last = Math.max(mission.updatedAt, ...events.map((e) => e.at))
  const handoffs = events.filter((e) => e.kind === 'handoff' && e.paneId !== null)
  const done = cards.filter((c) => c.column === 'feito').length
  const out: string[] = []

  out.push(`# ${mission.title}`)
  out.push([
    `**Modo:** ${MODE[mission.mode]}${squad ? ` (squad ${squad.name})` : ''}`,
    workspace && `**Workspace:** ${workspace.name}`,
    `**Início:** ${when(mission.createdAt)}`,
    `**Duração:** ${duration(last - mission.createdAt)}`,
    `**Situação:** ${mission.status === 'archived' ? 'arquivada' : mission.readyAt ? `pronta desde ${when(mission.readyAt)}` : 'em andamento'}`,
  ].filter(Boolean).join(' · '))
  if (mission.objective) out.push(`## Objetivo\n\n${mission.objective}`)
  if (mission.readySummary) out.push(`## Resultado (segundo o líder)\n\n${mission.readySummary}`)

  // Closed agents leave the mission but not its flow: "Agente #N aberto — title — CLI · model · seat".
  const known = new Set(panes.map((p) => p.id))
  const gone = [...new Map(events.filter((e) => e.kind === 'pane.spawned' && e.paneId !== null && !known.has(e.paneId)).map((e) => [e.paneId!, e])).values()]
  const agents = panes.length + gone.length
  const byCli = panes.reduce<Record<string, number>>((acc, p) => ({ ...acc, [CLI[p.cli]]: (acc[CLI[p.cli]] ?? 0) + 1 }), {})
  const cost = mission.usage.costUsd
  out.push(`## Em números\n\n${[
    `- ${agents} ${agents === 1 ? 'agente' : 'agentes'}${panes.length ? ` (${Object.entries(byCli).map(([k, v]) => `${v} ${k}`).join(', ')}${gone.length ? ` abertos agora, ${gone.length} já fechados` : ''})` : agents ? ' (todos já fechados)' : ''}`,
    `- ${tokens(mission.usage.total)} tokens${cost !== null ? ` (US$ ${cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} subtotal informado pelo Claude; outros custos podem estar ausentes)` : ' (custo em USD não informado)'}`,
    mission.budget && `- Orçamento: ${[mission.budget.tokens && `${tokens(mission.budget.tokens)} tokens`, mission.budget.costUsd && `US$ ${mission.budget.costUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`].filter(Boolean).join(' ou ')}${mission.budget.exceeded ? ' (esgotado)' : mission.budget.warned ? ' (passou de 80%)' : ''}`,
    cards.length > 0 && `- ${done} de ${cards.length} cartões feitos`,
    `- ${handoffs.length} ${handoffs.length === 1 ? 'retorno de ajudante' : 'retornos de ajudantes'}`,
    git && `- ${git.commits.length} ${git.commits.length === 1 ? 'commit' : 'commits'} e ${git.files.length} ${git.files.length === 1 ? 'arquivo' : 'arquivos'} no branch \`${git.branch}\``,
  ].filter(Boolean).join('\n')}`)

  if (panes.length || gone.length) {
    const closed = gone.map((e) => `- **#${e.paneId}** ${line(e.body, 200)} (fechado)`)
    out.push(`## Agentes\n\n${[...panes.map((p) => {
      const seat = p.role === 'lead' ? 'líder' : p.squadRole ?? p.taskType ?? 'ajudante'
      const how = [CLI[p.cli], p.accountId && input.accountNames[p.accountId], p.model, p.effort && `esforço ${p.effort}`].filter(Boolean).join(', ')
      const extra = [p.usage && `${tokens(p.usage.total)} tokens`, p.branch && p.branch !== git?.branch && `branch \`${p.branch}\``, p.handoffStatus && p.handoffStatus !== 'progress' && HANDOFF_TEXT[p.handoffStatus]].filter(Boolean).join(' · ')
      return `- **#${p.id} ${line(p.title, 120)}** (${seat}) — ${how}${extra ? ` · ${extra}` : ''}`
    }), ...closed].join('\n')}`)
  }

  if (cards.length) {
    const columns = CARD_COLUMNS.map((column) => {
      const list = cards.filter((c) => c.column === column).sort((a, b) => a.order - b.order)
      if (!list.length) return null
      return `### ${CARD_COLUMN_LABEL[column]}\n\n${list.map((c) => `- ${column === 'feito' ? '[x]' : '[ ]'} T${c.number} ${line(c.title, 200)}${c.assignee !== null ? ` (#${c.assignee})` : ''}`).join('\n')}`
    }).filter(Boolean)
    out.push(`## Quadro\n\n${columns.join('\n\n')}`)
  }

  if (handoffs.length) {
    out.push(`## Retornos\n\n${handoffs.map((e) => {
      const [summary, ...rest] = e.body.split('\n\n')
      const details = rest.join('\n\n').trim()
      return `### ${e.title} · ${clock(e.at)}\n\n${summary?.trim()}${details ? `\n\n<details><summary>Detalhes</summary>\n\n${details}\n\n</details>` : ''}`
    }).join('\n\n')}`)
  }

  if (git) {
    const parts = [`Branch \`${git.branch}\` a partir de \`${git.base}\`.`]
    if (pr) parts.push(`PR [#${pr.number}](${pr.url}): ${pr.state === 'MERGED' ? 'mergeado' : pr.state === 'CLOSED' ? 'fechado' : pr.draft ? 'rascunho' : 'aberto'}${pr.checks.length ? ` · CI: ${pr.checks.filter((c) => c.state === 'ok').length}/${pr.checks.length} passando${pr.checks.some((c) => c.state === 'fail') ? ` (falhou: ${pr.checks.filter((c) => c.state === 'fail').map((c) => c.name).join(', ')})` : ''}` : ''}`)
    if (git.commits.length) parts.push(`**Commits**\n\n${git.commits.map((c) => `- \`${c.sha}\` ${line(c.subject, 200)}`).join('\n')}`)
    if (git.files.length) parts.push(`**Arquivos**\n\n${git.files.map((f) => `- \`${f.path}\`${f.added !== null ? ` +${f.added}` : ''}${f.removed ? ` −${f.removed}` : ''}`).join('\n')}`)
    const pending = git.agents.filter((a) => a.ahead > 0 || a.dirty.length > 0)
    if (pending.length) parts.push(`**Pendências**\n\n${pending.map((a) => `- #${a.paneId}: ${[a.ahead && `${a.ahead} commit(s) em \`${a.branch}\` ainda não integrados`, a.dirty.length && `${a.dirty.length} arquivo(s) sem commit`].filter(Boolean).join('; ')}`).join('\n')}`)
    out.push(`## Mudanças no código\n\n${parts.join('\n\n')}`)
  } else {
    const changed = folders.filter((f) => f.changes.length)
    if (changed.length) {
      out.push(`## Mudanças no código\n\nO que difere do último commit nas pastas do workspace, agora (pode incluir mudanças de fora da missão).\n\n${changed.map((f) => `**${f.folder.split('/').pop()}**${f.branch ? ` (\`${f.branch}\`)` : ''}\n\n${f.changes.map((c) => `- ${c.kind} \`${c.path}\`${c.added ? ` +${c.added}` : ''}${c.removed ? ` −${c.removed}` : ''}${c.by.length ? ` (por ${c.by.map((id) => `#${id}`).join(', ')})` : ''}`).join('\n')}`).join('\n\n')}`)
    }
  }

  const moments = events.filter((e) => e.kind !== 'handoff')
  if (moments.length) out.push(`## Linha do tempo\n\n${moments.slice(-40).map((e) => `- ${clock(e.at)} ${line(e.title, 120)}${e.kind === 'pane.waiting' ? `: ${line(e.body, 160)}` : ''}`).join('\n')}`)

  out.push(`---\nRelatório gerado pelo Orbit em ${when(now)}.`)
  return `${out.join('\n\n')}\n`
}
