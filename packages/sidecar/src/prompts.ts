import { EFFORT_LABEL, type Mission, type Pane, type Routing, type Squad, type SquadRole, type TaskType } from '@orbit/protocol'

/** Role instructions Orbit gives its agents. They only describe how to use Orbit's tools. */


function routingTable(routing: Routing): string {
  return routing.taskTypes
    .map((t) => {
      const who = [t.cli === 'claude' ? 'Claude' : 'Codex', t.model, t.effort && `esforço ${EFFORT_LABEL[t.effort]}`].filter(Boolean).join(', ')
      return `- kind "${t.id}" (${t.name}): ${t.description || 'sem descrição'} → ${who}`
    })
    .join('\n')
}

export function leadRole(mission: Mission, pane: Pick<Pane, 'id'>, squad?: Squad, routing?: Routing): string {
  const base = [
    `Você é o líder (#${pane.id}) da missão "${mission.title}" no Orbit.`,
    'O Orbit expõe um servidor MCP chamado "orbit". Com ele você abre ajudantes em terminais que o usuário vê (agent_spawn), conversa com eles (agent_send), lê a tela deles (agent_read), fecha os que terminaram (agent_close) e acompanha a tripulação (agent_list, mission_status).',
    'Quando um ajudante termina, o retorno dele chega a você como uma mensagem que começa com "[Orbit] Retorno de #N". A íntegra fica em handoff_list.',
  ]

  if (mission.mode === 'squad' && squad) {
    const roles = squad.roles.map((r) => `- ${r.name} (role "${r.id}"): ${r.brief}`).join('\n')
    return [
      ...base,
      `Esta missão segue o squad "${squad.name}". Abra cada ajudante com agent_spawn passando role com o identificador do papel: o Orbit aplica o agente, o modelo e as instruções daquele papel. A tarefa que você passar deve ser autocontida (contexto, arquivos, o que entregar).`,
      `Papéis do squad:\n${roles}`,
      `Roteiro (siga nesta ordem, adaptando só quando o objetivo exigir):\n${squad.playbook}`,
      'Não faça você mesmo o trabalho de um papel. Ao terminar, diga ao usuário, em poucas linhas, o que foi feito e o que falta.',
    ].join('\n\n')
  }

  if (mission.mode !== 'agentica') return [...base, 'Só abra ajudantes quando o usuário pedir ou quando isso claramente acelerar o trabalho.'].join('\n\n')
  return [
    ...base,
    'Esta é uma missão agêntica: o usuário descreveu o objetivo e você conduz.',
    '1. Leia o objetivo e o código o suficiente para quebrar o trabalho em atividades independentes.',
    '2. Para cada atividade, chame agent_spawn com uma tarefa autocontida (contexto, arquivos relevantes, o que entregar e como verificar) e com kind = o tipo de tarefa da tabela abaixo que melhor descreve a atividade. O Orbit escolhe o agente, o modelo e o esforço pela tabela. Atividades que mexem nos mesmos arquivos vão para o mesmo ajudante.',
    ...(routing?.taskTypes.length ? [`Quem faz cada tarefa:\n${routingTable(routing)}`] : []),
    '3. Não refaça o trabalho que delegou. Acompanhe, responda dúvidas dos ajudantes com agent_send, integre os retornos e feche com agent_close os ajudantes que já entregaram.',
    '4. Verifique o resultado final (testes, build) e diga ao usuário, em poucas linhas, o que foi feito e o que falta.',
  ].join('\n\n')
}

export function crewRole(mission: Mission, pane: Pick<Pane, 'id'>, lead: Pane | undefined, squadRole?: SquadRole, taskType?: TaskType): string {
  return [
    `Você é ${squadRole ? `o ${squadRole.name}` : 'um ajudante'} (#${pane.id}) na missão "${mission.title}" do Orbit${lead ? `, sob o líder #${lead.id}` : ''}.`,
    ...(squadRole ? [`Seu papel: ${squadRole.brief}`] : []),
    ...(taskType ? [`Tipo de tarefa: ${taskType.name}${taskType.description ? ` (${taskType.description})` : ''}.`] : []),
    ...(taskType?.skills.length ? [`Use estas skills quando estiverem disponíveis: ${taskType.skills.join(', ')}.`] : []),
    'Faça só a tarefa que recebeu. Se faltar informação essencial, pergunte ao usuário no próprio terminal.',
    'Ao terminar, ou se ficar bloqueado, chame a ferramenta handoff_submit do servidor MCP "orbit" com um resumo curto: o que mudou, onde, como verificar e o que ficou pendente. Não espere confirmação depois de entregar.',
  ].join('\n\n')
}

/** Told to every agent of a multi-folder workspace, before its role. Empty for a single folder. */
export function workspaceNote(folders: string[]): string {
  if (folders.length <= 1) return ''
  const [main, ...others] = folders
  return [
    `Este workspace tem ${folders.length} pastas, e todas fazem parte do trabalho:`,
    `- ${main} (pasta principal: você começa nela)`,
    ...others.map((f) => `- ${f}`),
    'Você tem acesso de leitura e escrita a todas. Fora da principal, use caminhos absolutos; ao entregar, diga em qual pasta fica cada mudança.',
    '',
    '',
  ].join('\n')
}

export function objectiveTask(mission: Mission): string {
  return `Objetivo da missão:\n\n${mission.objective}`
}
