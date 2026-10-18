import type { Mission, MissionProgress, Pane } from '@orbit/protocol'

export type CompanionState = 'idle' | 'working' | 'waiting' | 'blocked' | 'review' | 'done' | 'offline'
export interface MissionSignal { state: CompanionState; title: string; detail: string }

export function missionSignal(mission: Mission, panes: Pane[], progress: MissionProgress | null, connection: 'connecting' | 'open' | 'closed', error: string | null): MissionSignal {
  if (connection !== 'open') return { state: 'offline', title: 'Sem conexão com o motor', detail: 'O estado da missão será conferido quando a conexão voltar.' }
  if (error || !progress || progress.missionId !== mission.id) return { state: 'idle', title: 'Conferindo a missão', detail: error ? 'Não foi possível atualizar. Tente conferir novamente.' : 'Consultando atividades, entregas e revisões.' }
  if (mission.status === 'archived') return { state: 'idle', title: 'Missão arquivada', detail: 'O histórico de trabalho e de revisão continua disponível.' }
  const waiting = panes.find(p => p.status === 'waiting')
  if (waiting) return { state: 'waiting', title: 'Precisa de você', detail: `#${waiting.id} · ${waiting.attention || 'O agente aguarda uma resposta ou permissão.'}` }
  const unresolved = progress.activities.filter(a => a.state !== 'waived')
  const blocked = unresolved.find(a => ['blocked', 'stopped'].includes(a.state))
  if (blocked) return { state: 'blocked', title: 'Atividade precisa de atenção', detail: `${blocked.title} · Confira o último retorno antes de retomar.` }
  if (progress.integration.state === 'stale' || progress.integration.state === 'unknown') return { state: 'review', title: 'Revisão final precisa ser conferida', detail: progress.integration.reason || 'O source atual não tem uma revisão final correspondente.' }
  const reviewing = unresolved.find(a => a.state === 'awaiting_validation' || (a.state === 'accepted' && a.verificationRequired && !progress.validation.find(v => v.activityId === a.id)?.valid))
  if (reviewing) return { state: 'review', title: 'Entrega aguardando revisão', detail: `${reviewing.title} · Entregar o resultado ainda não conclui a validação.` }
  if (unresolved.some(a => ['reserved', 'running'].includes(a.state)) || panes.some(p => ['starting', 'running'].includes(p.status))) return { state: 'working', title: 'Trabalho em andamento', detail: 'Acompanhe a conversa do líder e as atividades atribuídas.' }
  const waived = progress.activities.some(a => a.state === 'waived')
  if (mission.readyAt && progress.integration.state === 'current' && !waived) return { state: 'done', title: 'Entrega verificada nesta consulta', detail: mission.readySummary || 'Resultados aceitos e revisão final correspondente ao source observado.' }
  if (mission.readyAt) return { state: 'idle', title: waived ? 'Conclusão com atividades dispensadas' : 'Conclusão declarada pelo líder', detail: waived ? 'Veja as dispensas no histórico. Elas não equivalem a revisão independente.' : 'Não há revisão final independente atual que certifique esta conclusão.' }
  if (progress.integration.state === 'current') return { state: 'review', title: 'Revisada, aguardando conclusão', detail: 'A revisão corresponde ao source observado. O líder ainda não declarou a missão pronta.' }
  return { state: 'idle', title: 'Pronto para o próximo passo', detail: 'Envie uma orientação ao líder ou consulte o histórico da missão.' }
}
