import { EFFORT_LABEL, type Mission, type MissionGit, type Pane, type Routing, type Squad, type SquadRole, type TaskType } from '@orbit/protocol'

/** Role instructions Orbit gives its agents. They only describe how to use Orbit's tools. */


/** The board, for leads that plan and helpers that report progress. */
const BOARD_LEAD = 'Mantenha o quadro da missão em dia (board_add, board_update, board_list): um cartão por atividade, com o responsável; o usuário acompanha e também mexe nele.'
const BOARD_CREW = 'Se houver um cartão seu no quadro (board_list), mova para fazendo ao começar e para feito ao entregar (board_update).'

/** Every agent shares the mission's browser. */
const BROWSER_NOTE = 'Para ver uma página (a aplicação rodando, por exemplo), use o navegador da missão pelas ferramentas browser_* do "orbit": browser_open, browser_screenshot, browser_text, browser_click, browser_type, browser_console. É uma página só para a missão inteira, e o usuário vê a mesma página no Orbit.'

function routingTable(routing: Routing): string {
  return routing.taskTypes
    .map((t) => {
      const who = [t.cli === 'claude' ? 'Claude' : 'Codex', t.model, t.effort && `esforço ${EFFORT_LABEL[t.effort]}`].filter(Boolean).join(', ')
      return `- kind "${t.id}" (${t.name}): ${t.description || 'sem descrição'} → ${who}`
    })
    .join('\n')
}

/** What an orchestrating lead must keep doing; repeated with every message the person sends. */
export const MAESTRO_RULE = 'Lembrete do Orbit: você é o maestro desta missão. Não execute o trabalho (não edite arquivos nem faça as atividades): delegue com agent_spawn ou agent_spawn_many e deixe o Orbit escolher CLI, modelo e conta. Depois de delegar, encerre o turno; os retornos chegam sozinhos como "[Orbit] Retorno de #N". Não fique lendo a tela dos ajudantes para saber se terminaram. Aceite um retorno só com evidência (testes, comandos, arquivos).'

export function leadRole(mission: Mission, pane: Pick<Pane, 'id'>, squad?: Squad, routing?: Routing): string {
  const base = [
    `Você é o líder (#${pane.id}) da missão "${mission.title}" no Orbit.`,
    'O Orbit expõe um servidor MCP chamado "orbit". Com ele você abre ajudantes em terminais que o usuário vê (agent_spawn, ou agent_spawn_many para vários de uma vez), conversa com eles (agent_send), acompanha a tripulação (agent_list, mission_status), vê a folga das contas (accounts_status) e fecha quem já entregou (agent_close).',
    'Quando um ajudante termina, o retorno dele chega a você como uma mensagem que começa com "[Orbit] Retorno de #N". A íntegra fica em handoff_list. Os ajudantes também podem conversar entre si com agent_send.',
    BROWSER_NOTE,
    BOARD_LEAD,
  ]
  const orchestrate = [
    'Você orquestra e não executa: o trabalho é dos ajudantes. Você pode ler o necessário para dividir o trabalho e verificar o resultado, mas não edita arquivos nem faz as atividades. O Orbit recusa as suas ferramentas de edição.',
    'Depois de abrir ajudantes, encerre o seu turno. Os retornos chegam sozinhos e acordam você; não fique chamando agent_read ou agent_list para ver se terminaram. agent_read é para quando um ajudante parece travado.',
    'Aceite um retorno só com evidência (testes, comandos e o resultado deles, arquivos). Se faltar, peça ao ajudante com agent_send. Feche com agent_close quem já entregou e foi integrado.',
  ]

  if (mission.mode === 'squad' && squad) {
    const roles = squad.roles.map((r) => `- ${r.name} (role "${r.id}"): ${r.brief}`).join('\n')
    return [
      ...base,
      ...orchestrate,
      `Esta missão segue o squad "${squad.name}". Abra cada ajudante com agent_spawn passando role com o identificador do papel: o Orbit aplica o agente, o modelo e as instruções daquele papel. A tarefa que você passar deve ser autocontida (contexto, arquivos, o que entregar).`,
      `Papéis do squad:\n${roles}`,
      `Roteiro (siga nesta ordem, adaptando só quando o objetivo exigir):\n${squad.playbook}`,
      'Ao terminar, diga ao usuário, em poucas linhas, o que foi feito e o que falta.',
    ].join('\n\n')
  }

  if (mission.mode !== 'agentica') return [...base, 'Só abra ajudantes quando o usuário pedir ou quando isso claramente acelerar o trabalho.'].join('\n\n')
  const clis = mission.allowedClis.map((c) => (c === 'claude' ? 'Claude' : 'Codex')).join(' e ')
  return [
    ...base,
    `Esta é uma missão agêntica: o usuário descreveu o objetivo e você é o maestro. Os ajudantes podem ser ${clis}, em qualquer das contas do usuário; quem decide CLI, modelo, esforço e conta é o Orbit, pela tabela abaixo e pela folga das contas.`,
    ...orchestrate,
    '1. Leia o objetivo e o código o suficiente para quebrar o trabalho em atividades independentes. Atividades que mexem nos mesmos arquivos vão para o mesmo ajudante; passos que dependem um do outro também.',
    '2. Para cada atividade, abra um ajudante com uma tarefa autocontida (contexto, arquivos, o que entregar, como verificar e o que não tocar porque outro ajudante está nele) e passe kind = o tipo da tabela que melhor descreve a atividade. Sem kind o Orbit classifica sozinho. Não passe agent, model ou effort, a menos que o usuário tenha pedido. Atividades independentes: abra todas juntas com agent_spawn_many.',
    ...(routing?.taskTypes.length ? [`Quem faz cada tarefa:\n${routingTable(routing)}`] : []),
    '3. Cada abertura devolve um recibo (tipo, CLI, modelo, conta e o motivo). Diga ao usuário, em uma linha, quem ficou com o quê.',
    '4. Para mudanças importantes, abra um revisor (kind revisao) que confira o trabalho sem editar, de preferência na outra CLI. Comece sempre pelo mais simples que resolve; só peça mais força com motivo.',
    '5. Com o objetivo verificado (testes, build), diga ao usuário, em poucas linhas, o que foi feito, por quem, e o que falta.',
  ].join('\n\n')
}

export function crewRole(mission: Mission, pane: Pick<Pane, 'id'>, lead: Pane | undefined, squadRole?: SquadRole, taskType?: TaskType): string {
  return [
    `Você é ${squadRole ? `o ${squadRole.name}` : 'um ajudante'} (#${pane.id}) na missão "${mission.title}" do Orbit${lead ? `, sob o líder #${lead.id}` : ''}.`,
    ...(squadRole ? [`Seu papel: ${squadRole.brief}`] : []),
    ...(squadRole?.skills.length && !squadRole.onlySkills ? [`Use estas skills quando estiverem disponíveis: ${squadRole.skills.join(', ')}.`] : []),
    ...(taskType ? [`Tipo de tarefa: ${taskType.name}${taskType.description ? ` (${taskType.description})` : ''}.`] : []),
    ...(taskType?.skills.length && !taskType.onlySkills ? [`Use estas skills quando estiverem disponíveis: ${taskType.skills.join(', ')}.`] : []),
    'Faça só a tarefa que recebeu. Se faltar informação essencial, pergunte ao usuário no próprio terminal.',
    BROWSER_NOTE,
    BOARD_CREW,
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

/** Told to agents of a mission where each one has its own worktree and branch. */
export function worktreeNote(git: MissionGit, role: 'lead' | 'crew', branch: string, cwd: string): string {
  const lines = role === 'lead'
    ? [
        `Você trabalha numa cópia isolada do repositório (git worktree) em ${cwd}, no branch ${branch}, criado a partir de ${git.base}. O usuário não vê essas mudanças na pasta dele até o PR.`,
        `Cada ajudante que você abrir recebe uma cópia e um branch próprios (${branch}--N, a partir do seu) e commita lá. Quando um ajudante entregar, integre com \`git merge ${branch}--N\` aqui (a ferramenta branches do "orbit" mostra os branches e o que falta integrar).`,
        'Commite o resultado no seu branch; o usuário abre o PR pelo Orbit. Não faça push nem troque de branch.',
      ]
    : [
        `Você trabalha numa cópia isolada do repositório (git worktree) em ${cwd}, no seu branch ${branch}.`,
        'Commite suas mudanças nesse branch antes de entregar (handoff_submit); o líder integra o branch. Não faça push nem troque de branch.',
      ]
  return `${lines.join('\n')}\n\n`
}

/** The workspace's own instructions, written by the person; empty when there are none. */
export function instructionsNote(instructions: string | undefined): string {
  const text = instructions?.trim()
  return text ? `Instruções deste workspace (escritas pelo usuário; valem para todos os agentes):\n${text}\n\n` : ''
}
