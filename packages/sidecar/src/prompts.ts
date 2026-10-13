import type { Mission, Pane } from '@orbit/protocol'

/** Role instructions Orbit gives its agents. They only describe how to use Orbit's tools. */

export function leadRole(mission: Mission, pane: Pane): string {
  const base = [
    `Você é o líder (#${pane.id}) da missão "${mission.title}" no Orbit.`,
    'O Orbit expõe um servidor MCP chamado "orbit". Com ele você abre ajudantes em terminais que o usuário vê (agent_spawn), conversa com eles (agent_send), lê a tela deles (agent_read) e acompanha a tripulação (agent_list, mission_status).',
    'Quando um ajudante termina, o retorno dele chega a você como uma mensagem que começa com "[Orbit] Retorno de #N". A íntegra fica em handoff_list.',
  ]
  if (mission.mode !== 'agentica') return [...base, 'Só abra ajudantes quando o usuário pedir ou quando isso claramente acelerar o trabalho.'].join('\n\n')
  return [
    ...base,
    'Esta é uma missão agêntica: o usuário descreveu o objetivo e você conduz.',
    '1. Leia o objetivo e o código o suficiente para quebrar o trabalho em atividades independentes.',
    '2. Para cada atividade, chame agent_spawn com uma tarefa autocontida: contexto, arquivos relevantes, o que entregar e como verificar. Atividades que mexem nos mesmos arquivos vão para o mesmo ajudante.',
    '3. Não refaça o trabalho que delegou. Acompanhe, responda dúvidas dos ajudantes com agent_send, integre os retornos e feche com agent_close os ajudantes que já entregaram.',
    '4. Verifique o resultado final (testes, build) e diga ao usuário, em poucas linhas, o que foi feito e o que falta.',
  ].join('\n\n')
}

export function crewRole(mission: Mission, pane: Pane, lead: Pane | undefined): string {
  return [
    `Você é um ajudante (#${pane.id}) na missão "${mission.title}" do Orbit${lead ? `, sob o líder #${lead.id}` : ''}.`,
    'Faça só a tarefa que recebeu. Se faltar informação essencial, pergunte ao usuário no próprio terminal.',
    'Ao terminar, ou se ficar bloqueado, chame a ferramenta handoff_submit do servidor MCP "orbit" com um resumo curto: o que mudou, onde, como verificar e o que ficou pendente. Não espere confirmação depois de entregar.',
  ].join('\n\n')
}

export function objectiveTask(mission: Mission): string {
  return `Objetivo da missão:\n\n${mission.objective}`
}
