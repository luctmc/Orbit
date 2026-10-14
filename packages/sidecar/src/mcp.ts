import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { BROWSER_KEYS, BROWSER_VIEWPORT, CARD_COLUMNS, CARD_LIMITS, EFFORTS, MODEL_ID, type CardColumn, type Effort, type HandoffStatus, type Pane } from '@orbit/protocol'
import type { OrbitCore } from './core.ts'

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type ToolResult = { content: Content[]; isError?: boolean }

/** A tool body may return its own content (e.g. a screenshot) instead of text. */
const isResult = (value: unknown): value is ToolResult => typeof value === 'object' && value !== null && Array.isArray((value as ToolResult).content)

const text = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

/** Runs a tool body, turning domain errors into MCP tool errors the agent can read. */
const guarded = <A>(body: (args: A) => unknown) => async (args: A): Promise<ToolResult> => {
  try {
    const value = await body(args)
    return isResult(value) ? value : text(value)
  } catch (error) {
    return { ...text(error instanceof Error ? error.message : String(error)), isError: true }
  }
}

const agentView = (p: Pane) => ({
  id: p.id,
  role: p.role === 'lead' ? 'líder' : 'ajudante',
  squadRole: p.squadRole,
  taskType: p.taskType,
  title: p.title,
  agent: p.cli,
  model: p.model,
  status: p.status,
  attention: p.attention,
  delivered: p.deliveredAt !== null,
  handoff: p.handoffStatus,
})

const ACCEPT = z.array(z.string().min(1).max(300)).max(8).optional().describe('Critérios de aceite: o que precisa ser verdade para a entrega valer. O ajudante só entrega done respondendo a cada um')

type HelperInput = { title?: string; task: string; role?: string; kind?: string; agent?: 'claude' | 'codex'; model?: string; effort?: Effort; accept?: string[]; folder?: string }

/** In a workspace with several folders, a helper can start in the one its work is in. */
function folderField(core: OrbitCore, caller: Pane): Record<string, z.ZodType> {
  const folders = core.missionWorkspace(caller.missionId)?.folders ?? []
  return folders.length > 1 ? { folder: z.enum(folders as [string, ...string[]]).optional().describe(`Pasta onde o ajudante começa, quando o trabalho é noutro repositório do workspace (padrão: ${folders[0]})`) } : {}
}

/** Opens a helper and returns its line of the reply: number, title and the receipt. */
async function openHelper(core: OrbitCore, caller: Pane, h: HelperInput): Promise<string> {
  const { pane, receipt } = await core.spawnHelper(caller, { title: h.title ?? '', task: h.task, cli: h.agent, model: h.model ?? null, effort: h.effort ?? null, squadRoleId: h.role ?? null, taskTypeId: h.kind ?? null, accept: h.accept, folder: h.folder ?? null })
  return `#${pane.id} ${pane.title}\n${receipt.map((line) => `  ▸ ${line}`).join('\n')}`
}

/** One MCP server per request (stateless), scoped to the calling pane's identity and role. */
function buildServer(core: OrbitCore, caller: Pane): McpServer {
  const server = new McpServer({ name: 'orbit', version: '0.1.0' })
  const self = () => core.missionPanes(caller.missionId).find((p) => p.id === caller.id) ?? caller

  server.registerTool('whoami', {
    description: 'Quem você é no Orbit: seu número de agente, papel, missão, objetivo e as pastas do workspace (a primeira é a principal).',
  }, guarded(() => {
    const mission = core.mission(caller.missionId)
    const workspace = core.missionWorkspace(caller.missionId)
    return { agent: agentView(self()), mission: mission && { title: mission.title, mode: mission.mode, objective: mission.objective }, workspace: workspace && { name: workspace.name, folders: workspace.folders } }
  }))

  server.registerTool('agent_list', {
    description: 'Lista os agentes da sua missão com status (running, idle, waiting = espera o usuário, exited) e se já entregaram o retorno.',
  }, guarded(() => core.missionPanes(caller.missionId).map(agentView)))

  server.registerTool('mission_status', {
    description: 'Resumo da missão: objetivo, agentes e os últimos eventos do fluxo.',
    inputSchema: { events: z.number().int().min(1).max(100).optional().describe('Quantos eventos recentes trazer (padrão 20)') },
  }, guarded(({ events }: { events?: number }) => {
    const mission = core.mission(caller.missionId)
    const squad = core.missionSquad(caller.missionId)
    return {
      mission: mission && { title: mission.title, mode: mission.mode, objective: mission.objective, status: mission.status },
      squad: squad && { name: squad.name, playbook: squad.playbook, roles: squad.roles.map((r) => ({ id: r.id, name: r.name, agent: r.cli, model: r.model })) },
      agents: core.missionPanes(caller.missionId).map(agentView),
      events: core.missionEvents(caller.missionId).slice(-(events ?? 20)).map((e) => ({ at: new Date(e.at).toISOString(), title: e.title, body: e.body })),
    }
  }))

  if (caller.role === 'lead') {
    const squad = core.missionSquad(caller.missionId)
    const roleIds = squad?.roles.map((r) => r.id) ?? []
    // Squad missions route by role; the others by the task table ("who does each task").
    const taskTypes = squad ? [] : core.routing().taskTypes
    const roleField: Record<string, z.ZodType> = roleIds.length
      ? { role: z.enum(roleIds as [string, ...string[]]).optional().describe(`Papel do squad "${squad?.name}" (${squad?.roles.map((r) => `${r.id} = ${r.name}`).join(', ')}). Com papel, o agente, o modelo e as instruções vêm do squad.`) }
      : taskTypes.length
        ? { kind: z.enum(taskTypes.map((t) => t.id) as [string, ...string[]]).optional().describe(`Tipo de tarefa (${taskTypes.map((t) => `${t.id} = ${t.name}`).join(', ')}). Com tipo, o agente, o modelo e o esforço vêm da tabela "quem faz cada tarefa".`) }
        : {}

    const agentic = core.mission(caller.missionId)?.mode === 'agentica'
    const helperFields = {
      title: z.string().max(120).optional().describe('Função curta do ajudante, ex.: "Mapear leituras do token" (padrão: nome do papel ou do tipo)'),
      task: z.string().min(1).max(20000).describe('A tarefa completa e autocontida: contexto, arquivos, o que entregar, como verificar e o que não tocar'),
      ...roleField,
      agent: z.enum(['claude', 'codex']).optional().describe(agentic ? 'Só se o usuário pediu uma CLI específica; sem isso o Orbit escolhe pela tabela' : 'Qual CLI usar sem papel nem tipo (padrão: claude)'),
      model: z.string().regex(MODEL_ID).optional().describe('Só se o usuário pediu um modelo específico'),
      effort: z.enum(EFFORTS as [Effort, ...Effort[]]).optional().describe('Só se o usuário pediu. Claude: low…max; Codex: depende do modelo (low a ultra)'),
      accept: ACCEPT,
      ...folderField(core, caller),
    }
    const open = (h: HelperInput) => openHelper(core, caller, h)

    server.registerTool('agent_spawn', {
      description: 'Abre um ajudante num terminal visível ao usuário, já com a tarefa. O Orbit escolhe a CLI (Claude ou Codex), o modelo, o esforço e a conta com mais folga pelo tipo da tarefa, e devolve um recibo dizendo o que escolheu e por quê. O ajudante entrega com handoff_submit, e o retorno chega sozinho ao seu terminal como "[Orbit] Retorno de #N": depois de delegar, encerre o seu turno e espere.',
      inputSchema: helperFields,
    }, guarded(async (h: HelperInput) => `Aberto:\n${await open(h)}\n\nAgora encerre o turno: o retorno chega sozinho.`))

    server.registerTool('agent_spawn_many', {
      description: 'Abre vários ajudantes de uma vez (até 8), para atividades independentes que podem andar em paralelo. Mesmo funcionamento de agent_spawn para cada um.',
      inputSchema: { helpers: z.array(z.object(helperFields)).min(1).max(8) },
    }, guarded(async ({ helpers }: { helpers: HelperInput[] }) => {
      // One after the other, so each sees the agents the previous ones put on the accounts.
      const lines: string[] = []
      for (const [i, h] of helpers.entries()) {
        try {
          lines.push(await open(h))
        } catch (error) {
          lines.push(`${i + 1}. não abriu (${h.title ?? h.task.slice(0, 40)}): ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return `Abertos:\n${lines.join('\n')}\n\nAgora encerre o turno: os retornos chegam sozinhos.`
    }))

    server.registerTool('accounts_status', {
      description: 'Contas do Claude e do Codex que esta missão pode usar: quanto do limite cada uma já usou, quantos agentes estão nela agora e se dá para abrir mais. O Orbit já distribui sozinho; use para explicar ao usuário ou decidir se vale abrir agora.',
    }, guarded(() => core.capacity(caller.missionId)))

    server.registerTool('agent_close', {
      description: 'Fecha um ajudante (encerra o processo e tira o terminal da tela) depois que você integrou o retorno dele. Não fecha quem ainda não entregou, a menos que force seja true (ajudante realmente travado).',
      inputSchema: { agent: z.number().int().describe('Número do ajudante'), force: z.boolean().optional().describe('Fechar mesmo sem retorno (só se travou)') },
    }, guarded(({ agent, force }: { agent: number; force?: boolean }) => {
      core.closeHelper(caller, agent, force === true)
      return `Ajudante #${agent} fechado.`
    }))

    server.registerTool('agent_interrupt', {
      description: 'Interrompe o que um ajudante está fazendo (como apertar Esc no terminal dele) e, se passar message, dá a nova orientação logo em seguida. Use quando ele foi pelo caminho errado; para só conversar, agent_send.',
      inputSchema: { agent: z.number().int().describe('Número do ajudante'), message: z.string().max(8000).optional().describe('Nova orientação, digitada depois da interrupção') },
    }, guarded(async ({ agent, message }: { agent: number; message?: string }) => {
      await core.interrupt(caller, agent, message ?? null)
      return message ? `#${agent} interrompido e reorientado.` : `#${agent} interrompido. Ele espera no terminal; mande a orientação com agent_send.`
    }))

    server.registerTool('agent_resume', {
      description: 'Retoma um ajudante que parou (processo encerrado, travou, o Orbit foi reaberto) na mesma conversa, com a mensagem para continuar. Ele volta com um número novo e o mesmo branch.',
      inputSchema: { agent: z.number().int().describe('Número do ajudante'), message: z.string().max(8000).optional().describe('O que fazer agora (padrão: continuar a tarefa e entregar)') },
    }, guarded(({ agent, message }: { agent: number; message?: string }) => {
      core.resumeHelper(caller, agent, message ?? null)
      return `#${agent} retomado na mesma conversa. O retorno chega sozinho.`
    }))

    server.registerTool('mission_ready', {
      description: 'Declara a missão pronta, com o objetivo cumprido e verificado. O Orbit marca a missão e avisa o usuário. Recusa enquanto algum ajudante ainda deve retorno, a menos que force seja true.',
      inputSchema: {
        summary: z.string().min(1).max(4000).describe('O que foi feito, por quem, como foi verificado e o que falta'),
        force: z.boolean().optional().describe('Declarar mesmo com ajudantes sem retorno'),
      },
    }, guarded(({ summary, force }: { summary: string; force?: boolean }) => {
      core.missionReady(caller, summary, force === true)
      return 'Missão marcada como pronta; o usuário foi avisado. Diga a ele, em poucas linhas, o resultado.'
    }))

    if (core.mission(caller.missionId)?.git) {
      server.registerTool('branches', {
        description: 'Missão com um branch por agente: o branch da missão (o seu) e o de cada ajudante, com quantos commits ainda não foram integrados ao seu e os arquivos sem commit.',
      }, guarded(() => {
        const summary = core.gitSummary(caller.missionId)
        return { mission: { branch: summary.branch, base: summary.base, commits: summary.commits.length }, helpers: summary.agents.map((a) => ({ agent: `#${a.paneId}`, title: a.title, branch: a.branch, toMerge: a.ahead, uncommitted: a.dirty.length })) }
      }))
    }

    server.registerTool('ask_user', {
      description: 'Pergunta ao usuário algo que só ele decide. O seu terminal fica marcado como "espera você" com a pergunta e as opções em botões, e o usuário recebe um aviso; a resposta chega digitada no seu terminal. Depois de perguntar, encerre o turno.',
      inputSchema: {
        question: z.string().min(1).max(600).describe('A pergunta, com o contexto mínimo para decidir'),
        choices: z.array(z.string().min(1).max(80)).max(6).optional().describe('Respostas sugeridas (até 6)'),
      },
    }, guarded(({ question, choices }: { question: string; choices?: string[] }) => {
      core.askUser(caller, question, choices ?? [])
      return 'Pergunta feita. Encerre o turno: a resposta chega no seu terminal.'
    }))

    const kinds = core.routing().taskTypes
    server.registerTool('routing_propose', {
      description: 'Propõe ao usuário mudar uma linha da tabela "quem faz cada tarefa" (CLI, modelo, esforço, como fazer, só leitura), com o motivo, quando a experiência da missão mostrar que outra escolha seria melhor. O usuário aceita ou recusa nos Ajustes, e a resposta chega no seu terminal. Não muda nada antes disso.',
      inputSchema: {
        kind: z.enum(kinds.map((t) => t.id) as [string, ...string[]]).describe('A linha da tabela'),
        agent: z.enum(['claude', 'codex']).optional(),
        model: z.union([z.string().regex(MODEL_ID), z.null()]).optional().describe('Modelo, ou null para o padrão da CLI'),
        effort: z.union([z.enum(EFFORTS as [Effort, ...Effort[]]), z.null()]).optional(),
        method: z.string().max(1500).optional().describe('Novo "como fazer" (substitui o atual)'),
        readOnly: z.boolean().optional(),
        reason: z.string().min(1).max(600).describe('O que nesta missão mostrou que a mudança vale a pena'),
      },
    }, guarded(({ kind, agent, model, effort, method, readOnly, reason }: { kind: string; agent?: 'claude' | 'codex'; model?: string | null; effort?: Effort | null; method?: string; readOnly?: boolean; reason: string }) => {
      core.proposeRouting(caller, { kind, change: { cli: agent, model, effort, method, readOnly }, reason })
      return 'Proposta enviada ao usuário. A resposta chega no seu terminal; até lá a tabela não muda.'
    }))

    server.registerTool('handoff_list', {
      description: 'Íntegra dos retornos que os ajudantes enviaram nesta missão.',
    }, guarded(() => core.missionEvents(caller.missionId, 'handoff').map((e) => ({ from: e.paneId, at: new Date(e.at).toISOString(), text: e.body }))))
  }

  server.registerTool('agent_send', {
    description: 'Escreve uma mensagem no terminal de outro agente da missão, como se fosse digitada. Use para responder dúvidas ou redirecionar um ajudante.',
    inputSchema: { agent: z.number().int().describe('Número do agente'), message: z.string().min(1).max(8000) },
  }, guarded(({ agent, message }: { agent: number; message: string }) => {
    core.sendTo(caller, agent, message)
    return `Mensagem enviada para #${agent}.`
  }))

  server.registerTool('agent_read', {
    description: 'Lê o que está na tela do terminal de outro agente da missão (texto, sem cores).',
    inputSchema: { agent: z.number().int().describe('Número do agente'), lines: z.number().int().min(1).max(400).optional().describe('Quantas linhas finais (padrão 60)') },
  }, guarded(({ agent, lines }: { agent: number; lines?: number }) => core.readScreen(caller, agent, lines ?? 60) || '(tela vazia)'))

  registerBrowserTools(server, core, caller)
  registerBoardTools(server, core, caller)

  // Helpers the lead opened may open a couple of sub-helpers; their results come back to them.
  if (caller.role === 'crew' && (core.childSlots(caller) > 0 || core.missionPanes(caller.missionId).some((p) => p.assignedBy === caller.id))) {
    const kinds = core.routing().taskTypes
    server.registerTool('agent_spawn', {
      description: 'Abre um sub-ajudante para uma parte grande e independente da sua tarefa (no máximo 2 abertos). O Orbit escolhe CLI, modelo e conta; o retorno dele chega ao seu terminal, e a sua entrega final continua sendo sua.',
      inputSchema: {
        title: z.string().max(120).optional(),
        task: z.string().min(1).max(20000).describe('A parte da tarefa, autocontida: contexto, arquivos, o que entregar, como verificar'),
        kind: z.enum(kinds.map((t) => t.id) as [string, ...string[]]).optional().describe(`Tipo de tarefa (${kinds.map((t) => t.id).join(', ')}); sem ele o Orbit classifica`),
        accept: ACCEPT,
        ...folderField(core, caller),
      },
    }, guarded(async (h: HelperInput) => `Aberto:\n${await openHelper(core, caller, h)}\n\nContinue a sua parte; o retorno dele chega sozinho.`))

    server.registerTool('agent_close', {
      description: 'Fecha um sub-ajudante seu que já entregou. Com force, fecha mesmo sem retorno (só se travou).',
      inputSchema: { agent: z.number().int(), force: z.boolean().optional() },
    }, guarded(({ agent, force }: { agent: number; force?: boolean }) => {
      core.closeHelper(caller, agent, force === true)
      return `Sub-ajudante #${agent} fechado.`
    }))
  }

  if (caller.role === 'crew') {
    server.registerTool('handoff_submit', {
      description: 'Entrega o resultado da sua tarefa a quem pediu (o líder, normalmente). done = terminou, com evidence; blocked = travou, com a pergunta ou o impedimento; progress = aviso no meio do caminho, só registrado (você continua). O resumo é digitado no terminal de quem recebe; os detalhes ficam no fluxo da missão.',
      inputSchema: {
        summary: z.string().min(1).max(2000).describe('Resumo curto: o que mudou, onde, o que ficou pendente'),
        status: z.enum(['done', 'blocked', 'progress']).optional().describe('Padrão: done'),
        evidence: z.string().max(4000).optional().describe('Como verificou: comandos rodados e o resultado, testes, arquivos conferidos. Obrigatório com done'),
        details: z.string().max(20000).optional().describe('Detalhes opcionais (lista de arquivos, saídas de teste…)'),
        to: z.number().int().optional().describe('Entregar a outro agente da missão (ex.: o revisor) em vez de ao líder, quando a sua tarefa mandar'),
        criteria: z.array(z.object({ item: z.number().int().min(1), met: z.boolean(), how: z.string().max(300) })).max(8).optional().describe('Resposta a cada critério de aceite da tarefa: número, se cumpriu e como conferiu'),
      },
    }, guarded(({ summary, status, evidence, details, to, criteria }: { summary: string; status?: HandoffStatus; evidence?: string; details?: string; to?: number; criteria?: Array<{ item: number; met: boolean; how: string }> }) => {
      const result = core.handoff(caller, { summary, status, evidence, details, to, criteria })
      if (result.status === 'progress' && result.deliveredTo === null) return 'Progresso registrado no fluxo da missão. Continue e entregue com done ou blocked ao terminar.'
      return result.deliveredTo === null ? 'Retorno registrado no fluxo da missão (ninguém rodando para receber agora).' : `Retorno entregue a #${result.deliveredTo}.`
    }))
  }

  return server
}

/** The mission's board, shared with the person (who sees and moves the same cards). */
function registerBoardTools(server: McpServer, core: OrbitCore, caller: Pane): void {
  const column = z.enum(CARD_COLUMNS as [CardColumn, ...CardColumn[]])
  server.registerTool('board_list', {
    description: 'Cartões do quadro da missão (afazer, fazendo, feito), na ordem, com quem está em cada um. O usuário vê e mexe no mesmo quadro.',
  }, guarded(() => core.boardList(caller)))

  server.registerTool('board_add', {
    description: 'Cria um cartão no quadro da missão. Use um por atividade; o número (T1, T2…) volta na resposta.',
    inputSchema: {
      title: z.string().min(1).max(CARD_LIMITS.title),
      notes: z.string().max(CARD_LIMITS.notes).optional().describe('Detalhes: contexto, critério de pronto'),
      column: column.optional().describe('Padrão: afazer'),
      assignee: z.number().int().optional().describe('Número do agente responsável'),
    },
  }, guarded(({ title, notes, column: col, assignee }: { title: string; notes?: string; column?: CardColumn; assignee?: number }) => core.boardAdd(caller, { title, notes, column: col, assignee })))

  server.registerTool('board_update', {
    description: 'Atualiza um cartão pelo número: mova para fazendo ao começar e para feito ao terminar; assignee "eu" pega o cartão para você.',
    inputSchema: {
      card: z.union([z.number().int().min(1), z.string().regex(/^T?\d+$/i)]).describe('Número do cartão, ex.: 3 ou "T3"'),
      column: column.optional(),
      title: z.string().min(1).max(CARD_LIMITS.title).optional(),
      notes: z.string().max(CARD_LIMITS.notes).optional(),
      assignee: z.union([z.number().int(), z.literal('eu'), z.null()]).optional().describe('Número do agente, "eu" ou null para ninguém'),
    },
  }, guarded(({ card, column: col, title, notes, assignee }: { card: number | string; column?: CardColumn; title?: string; notes?: string; assignee?: number | 'eu' | null }) =>
    core.boardUpdate(caller, typeof card === 'number' ? card : Number(String(card).replace(/^T/i, '')), { column: col, title, notes, assignee })))
}

/** The mission's browser: one page shared by its agents and shown to the person. */
function registerBrowserTools(server: McpServer, core: OrbitCore, caller: Pane): void {
  const { width, height } = BROWSER_VIEWPORT
  server.registerTool('browser_open', {
    description: `Abre um endereço no navegador da missão (Chromium sem janela, ${width}×${height}); o usuário vê a mesma página no Orbit. Use para conferir a aplicação rodando, ex.: http://localhost:5173. Espera a página carregar.`,
    inputSchema: { url: z.string().min(1).max(2000).describe('Endereço http(s); "localhost:3000" também vale') },
  }, guarded(async ({ url }: { url: string }) => {
    const state = await core.browserOpen(caller, url)
    return { url: state.url, title: state.title, error: state.error }
  }))

  server.registerTool('browser_screenshot', {
    description: 'Captura a tela atual do navegador da missão (PNG). Coordenadas de clique são em pixels desta imagem.',
  }, guarded(async () => ({ content: [{ type: 'image', data: await core.browserScreenshot(caller), mimeType: 'image/png' }] })))

  server.registerTool('browser_text', {
    description: 'Texto visível da página aberta (innerText), com endereço e título.',
    inputSchema: { maxChars: z.number().int().min(100).max(100_000).optional().describe('Limite de caracteres (padrão 20000)') },
  }, guarded(({ maxChars }: { maxChars?: number }) => core.browserText(caller, maxChars ?? 20_000)))

  server.registerTool('browser_click', {
    description: 'Clica num elemento (seletor CSS, de preferência) ou num ponto da tela (x, y da captura).',
    inputSchema: {
      selector: z.string().min(1).max(500).optional().describe('Seletor CSS, ex.: button[type=submit]'),
      x: z.number().min(0).max(width).optional(),
      y: z.number().min(0).max(height).optional(),
    },
  }, guarded(async ({ selector, x, y }: { selector?: string; x?: number; y?: number }) => {
    if (!selector && (x === undefined || y === undefined)) throw new Error('Passe um seletor ou x e y')
    const point = await core.browserClick(caller, selector ? { selector } : { x: x!, y: y! })
    return `Clique em (${point.x}, ${point.y}).`
  }))

  server.registerTool('browser_type', {
    description: 'Digita no campo que está com foco (clique nele antes). Com submit, tecla Enter no fim.',
    inputSchema: { text: z.string().max(10_000), submit: z.boolean().optional() },
  }, guarded(async ({ text: value, submit }: { text: string; submit?: boolean }) => {
    await core.browserType(caller, value, submit ?? false)
    return 'Digitado.'
  }))

  server.registerTool('browser_key', {
    description: 'Pressiona uma tecla na página.',
    inputSchema: { key: z.enum(BROWSER_KEYS as unknown as [string, ...string[]]) },
  }, guarded(async ({ key }: { key: string }) => {
    await core.browserKey(caller, key)
    return `Tecla ${key}.`
  }))

  server.registerTool('browser_scroll', {
    description: 'Rola a página (positivo desce, negativo sobe), em pixels.',
    inputSchema: { dy: z.number().int().min(-5000).max(5000) },
  }, guarded(async ({ dy }: { dy: number }) => {
    await core.browserScroll(caller, dy)
    return 'Rolado.'
  }))

  server.registerTool('browser_console', {
    description: 'Mensagens do console, erros de JavaScript e requisições que falharam na página, das mais antigas às mais novas.',
    inputSchema: { lines: z.number().int().min(1).max(200).optional().describe('Quantas (padrão 50)') },
  }, guarded(({ lines }: { lines?: number }) => core.browserConsole(caller, lines ?? 50).join('\n') || '(nada no console)'))
}

/** POST /mcp — stateless Streamable HTTP; the bearer token picks the calling pane. */
export async function handleMcp(core: OrbitCore, caller: Pane, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const server = buildServer(core, caller)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
