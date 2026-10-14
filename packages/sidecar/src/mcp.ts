import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { BROWSER_KEYS, BROWSER_VIEWPORT, CARD_COLUMNS, CARD_LIMITS, EFFORTS, MODEL_ID, type CardColumn, type Effort, type Pane } from '@orbit/protocol'
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
})

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
    }
    type HelperInput = { title?: string; task: string; role?: string; kind?: string; agent?: 'claude' | 'codex'; model?: string; effort?: Effort }
    const open = (h: HelperInput) => {
      const { pane, receipt } = core.spawnHelper(caller, { title: h.title ?? '', task: h.task, cli: h.agent, model: h.model ?? null, effort: h.effort ?? null, squadRoleId: h.role ?? null, taskTypeId: h.kind ?? null })
      return `#${pane.id} ${pane.title}\n${receipt.map((line) => `  ▸ ${line}`).join('\n')}`
    }

    server.registerTool('agent_spawn', {
      description: 'Abre um ajudante num terminal visível ao usuário, já com a tarefa. O Orbit escolhe a CLI (Claude ou Codex), o modelo, o esforço e a conta com mais folga pelo tipo da tarefa, e devolve um recibo dizendo o que escolheu e por quê. O ajudante entrega com handoff_submit, e o retorno chega sozinho ao seu terminal como "[Orbit] Retorno de #N": depois de delegar, encerre o seu turno e espere.',
      inputSchema: helperFields,
    }, guarded((h: HelperInput) => `Aberto:\n${open(h)}\n\nAgora encerre o turno: o retorno chega sozinho.`))

    server.registerTool('agent_spawn_many', {
      description: 'Abre vários ajudantes de uma vez (até 8), para atividades independentes que podem andar em paralelo. Mesmo funcionamento de agent_spawn para cada um.',
      inputSchema: { helpers: z.array(z.object(helperFields)).min(1).max(8) },
    }, guarded(({ helpers }: { helpers: HelperInput[] }) => {
      const lines = helpers.map((h, i) => {
        try {
          return open(h)
        } catch (error) {
          return `${i + 1}. não abriu (${h.title ?? h.task.slice(0, 40)}): ${error instanceof Error ? error.message : String(error)}`
        }
      })
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

    if (core.mission(caller.missionId)?.git) {
      server.registerTool('branches', {
        description: 'Missão com um branch por agente: o branch da missão (o seu) e o de cada ajudante, com quantos commits ainda não foram integrados ao seu e os arquivos sem commit.',
      }, guarded(() => {
        const summary = core.gitSummary(caller.missionId)
        return { mission: { branch: summary.branch, base: summary.base, commits: summary.commits.length }, helpers: summary.agents.map((a) => ({ agent: `#${a.paneId}`, title: a.title, branch: a.branch, toMerge: a.ahead, uncommitted: a.dirty.length })) }
      }))
    }

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

  if (caller.role === 'crew') {
    server.registerTool('handoff_submit', {
      description: 'Entrega o resultado da sua tarefa ao líder. Use ao terminar ou se ficar bloqueado. O resumo é digitado no terminal do líder; os detalhes ficam guardados no fluxo da missão.',
      inputSchema: {
        summary: z.string().min(1).max(2000).describe('Resumo curto: o que mudou, onde, como verificar, o que ficou pendente'),
        details: z.string().max(20000).optional().describe('Detalhes opcionais (lista de arquivos, saídas de teste…)'),
      },
    }, guarded(({ summary, details }: { summary: string; details?: string }) => {
      const { deliveredTo } = core.handoff(caller, summary, details ?? '')
      return deliveredTo === null ? 'Retorno registrado no fluxo da missão (o líder não está rodando).' : `Retorno entregue ao líder #${deliveredTo}.`
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
