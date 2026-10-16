import type { Card, Mission, MissionProgress, Pane } from '@orbit/protocol'

export interface InputSuggestion { id: string; text: string; reason: string }
export interface InlineSuggestion extends InputSuggestion { suffix: string; value: string }
type Context = {
  mission: Pick<Mission, 'id' | 'title' | 'objective' | 'status' | 'budget' | 'readyAt'>
  pane: Pick<Pane, 'missionId' | 'role' | 'cli' | 'status'>
  progress: MissionProgress | null
  cards: Array<Pick<Card, 'missionId' | 'title' | 'column' | 'order'>>
  connected: boolean
  now?: number
}

const label = (text: string, max = 120) => text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')

/** Local suggestions describe possible next steps; they never grant permission or certify work. */
export function inputSuggestions({ mission, pane, progress, cards, connected, now = Date.now() }: Context): InputSuggestion[] {
  if (!connected || mission.id !== pane.missionId || mission.status !== 'active' || pane.role !== 'lead' || !['claude', 'codex'].includes(pane.cli) || ['exited', 'starting', 'waiting'].includes(pane.status) || mission.budget?.exceeded) return []
  const items: InputSuggestion[] = []
  const add = (id: string, text: string, reason: string) => items.push({ id, text, reason })
  const age = progress ? now - progress.observedAt : Infinity
  const current = progress?.missionId === mission.id && age >= -1000 && age <= 30000 ? progress : null
  if (!current) {
    add('check-state', 'Confira o estado atual da missão antes de escolher o próximo passo.', 'O estado das atividades ainda precisa ser atualizado.')
  } else {
    const activities = current.activities.filter(a => a.missionId === mission.id && a.state !== 'waived').sort((a, b) => b.updatedAt - a.updatedAt)
    const blocked = activities.find(a => a.state === 'blocked' || a.state === 'stopped')
    const review = activities.find(a => a.state === 'awaiting_validation')
    const running = activities.some(a => a.state === 'running' || a.state === 'reserved')
    if (blocked) add(`blocked:${blocked.id}`, `Investigue o bloqueio de “${label(blocked.title)}” e proponha uma retomada sem repetir trabalho já entregue.`, 'Há uma atividade interrompida ou bloqueada.')
    else if (review) add(`review:${review.id}`, `Revise a entrega “${label(review.title)}” e confira cada critério de aceite.`, 'A entrega ainda aguarda revisão independente.')
    else if (current.integration.state === 'stale' || current.integration.state === 'unknown') add('check-integration', 'Confira o código atual e refaça a revisão final antes de concluir a missão.', 'A revisão final está desatualizada ou não pôde ser conferida.')
    else if (running) add('progress', 'Mostre o andamento das atividades e os impedimentos da missão.', 'Há trabalho em andamento.')
    else if (current.integration.state === 'current' && mission.readyAt) add('summary', 'Resuma as alterações verificadas, os testes e as limitações restantes.', 'Existe uma revisão final atual nesta consulta.')
    else if (activities.length && activities.every(a => a.state === 'accepted')) add('integration', 'Revise a integração final e confira os critérios de todas as atividades antes de concluir.', 'As entregas foram aceitas; confira a integração e a conclusão.')
    if (current.activities.some(a => a.state === 'waived')) add('waivers', 'Explique quais atividades foram dispensadas e quais limitações permanecem.', 'Há atividades dispensadas no histórico.')
    const next = cards.filter(c => c.missionId === mission.id && c.column === 'afazer').sort((a, b) => a.order - b.order)[0]
    if (next) add('next-card', `Planeje a próxima tarefa “${label(next.title)}”, com critérios de aceite e revisão.`, 'Próximo cartão a fazer no quadro desta missão.')
    const goal = label(mission.objective || mission.title, 180)
    add('plan', `Planeje a execução de “${goal}”, com tarefas, critérios de aceite e revisão.`, 'Sugestão baseada no objetivo desta missão.')
  }
  add('status', 'Resuma o que já foi feito, o que falta e qual é o próximo passo.', 'Uma orientação para consultar o maestro, sem assumir conclusão.')
  return items.slice(0, 3)
}

/** Matching ignores case/accents, but the returned value preserves the person's exact prefix. */
export function inlineSuggestion(draft: string, candidates: InputSuggestion[]): InlineSuggestion | null {
  if (draft.length > 512 || /[\p{Cc}\p{Cf}]/u.test(draft) || draft && (!draft.trim() || /^[\s]*[\/@!>$]/u.test(draft))) return null
  const prefix = fold(draft)
  for (const item of candidates) {
    if (!item.text || item.text.length > 600 || /[\p{Cc}\p{Cf}]/u.test(item.text) || !fold(item.text).startsWith(prefix)) continue
    let end = 0, normalized = ''
    for (const char of item.text) {
      if (normalized.length >= prefix.length) break
      normalized += fold(char); end += char.length
    }
    // Do not split a normalized character or an already complete suggestion.
    if (normalized !== prefix || end >= item.text.length) continue
    const suffix = item.text.slice(end)
    return { ...item, suffix, value: draft + suffix }
  }
  return null
}

export function acceptsSuggestionKey(event: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }): boolean {
  return event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing
}
