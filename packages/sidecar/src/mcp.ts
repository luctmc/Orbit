import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { AGENT_CLIS, BROWSER_KEYS, type AgentCliForRole, type Difficulty, BROWSER_VIEWPORT, CARD_COLUMNS, CARD_LIMITS, EFFORTS, MODEL_ID, type CardColumn, type Effort, type HandoffStatus, type Pane } from '@orbit/protocol'
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

const ACCEPT = z.array(z.string().min(1).max(300)).max(8).optional().describe('Acceptance criteria: what must hold for the delivery to count. The helper can only deliver done by answering each one')

type HelperInput = { title?: string; task: string; role?: string; kind?: string; agent?: AgentCliForRole; model?: string; effort?: Effort; accept?: string[]; folder?: string; difficulty?: Difficulty }

/** In a workspace with several folders, a helper can start in the one its work is in. */
function folderField(core: OrbitCore, caller: Pane): Record<string, z.ZodType> {
  const folders = core.missionWorkspace(caller.missionId)?.folders ?? []
  return folders.length > 1 ? { folder: z.enum(folders as [string, ...string[]]).optional().describe(`Folder the helper starts in, when the work is in another repository of the workspace (default: ${folders[0]})`) } : {}
}

/** Opens a helper and returns its line of the reply: number, title and the receipt. */
async function openHelper(core: OrbitCore, caller: Pane, h: HelperInput): Promise<string> {
  const { pane, receipt } = await core.spawnHelper(caller, { title: h.title ?? '', task: h.task, cli: h.agent, model: h.model ?? null, effort: h.effort ?? null, squadRoleId: h.role ?? null, taskTypeId: h.kind ?? null, accept: h.accept, folder: h.folder ?? null, difficulty: h.difficulty ?? null })
  return `#${pane.id} ${pane.title}\n${receipt.map((line) => `  ▸ ${line}`).join('\n')}`
}

/** One MCP server per request (stateless), scoped to the calling pane's identity and role. */
function buildServer(core: OrbitCore, caller: Pane): McpServer {
  const server = new McpServer({ name: 'orbit', version: '0.1.0' })
  const self = () => core.missionPanes(caller.missionId).find((p) => p.id === caller.id) ?? caller

  server.registerTool('whoami', {
    description: 'Who you are in Orbit: your agent number, role, mission, objective and the workspace folders (the first one is the main one).',
  }, guarded(() => {
    const mission = core.mission(caller.missionId)
    const workspace = core.missionWorkspace(caller.missionId)
    return { agent: agentView(self()), mission: mission && { title: mission.title, mode: mission.mode, objective: mission.objective }, workspace: workspace && { name: workspace.name, folders: workspace.folders } }
  }))

  server.registerTool('agent_list', {
    description: 'Lists your mission\'s agents with status (running, idle, waiting = waiting for the user, exited) and whether they delivered.',
  }, guarded(() => core.missionPanes(caller.missionId).map(agentView)))

  server.registerTool('mission_status', {
    description: 'Mission summary: objective, agents and the latest flow events.',
    inputSchema: { events: z.number().int().min(1).max(100).optional().describe('How many recent events (default 20)') },
  }, guarded(({ events }: { events?: number }) => {
    const mission = core.mission(caller.missionId)
    const squad = core.missionSquad(caller.missionId)
    return {
      mission: mission && { title: mission.title, mode: mission.mode, objective: mission.objective, status: mission.status, used: { tokens: mission.usage.total, costUsd: mission.usage.costUsd }, budget: mission.budget && { tokens: mission.budget.tokens, costUsd: mission.budget.costUsd, warned: mission.budget.warned, exceeded: mission.budget.exceeded } },
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
      title: z.string().max(120).optional().describe('Short role of the helper, e.g. "Map token reads" (default: the role or kind name)'),
      task: z.string().min(1).max(20000).describe('The complete, self-contained task: context, files, what to deliver, how to verify it and what not to touch'),
      ...roleField,
      agent: z.enum(AGENT_CLIS as unknown as [AgentCliForRole, ...AgentCliForRole[]]).optional().describe(agentic ? 'Only if the user asked for a specific CLI; otherwise Orbit picks from the table and the load' : 'Which CLI to use without a role or kind (default: claude)'),
      model: z.string().regex(MODEL_ID).optional().describe('Only if the user asked for a specific model'),
      effort: z.enum(EFFORTS as [Effort, ...Effort[]]).optional().describe('Only if the user asked. Claude: low…max; Codex: depends on the model (low to ultra)'),
      accept: ACCEPT,
      difficulty: z.enum(['simples', 'normal', 'dificil']).optional().describe('simples (small and obvious) goes to the CLI\'s cheaper model; dificil (long reasoning, many files, unknown cause) to the stronger one or more effort; default: normal, as in the table'),
      ...folderField(core, caller),
    }
    const open = (h: HelperInput) => openHelper(core, caller, h)

    server.registerTool('agent_spawn', {
      description: 'Opens a helper in a terminal the user sees, already with its task. Orbit picks the CLI, model, effort and the account with the most room from the kind of work and the load on each CLI, and returns a receipt saying what it chose and why. The helper delivers with handoff_submit, and the result reaches your terminal on its own as "[Orbit] Retorno de #N": after delegating, end your turn and wait.',
      inputSchema: helperFields,
    }, guarded(async (h: HelperInput) => `Aberto:\n${await open(h)}\n\nAgora encerre o turno: o retorno chega sozinho.`))

    server.registerTool('agent_spawn_many', {
      description: 'Opens several helpers at once (up to 8), for independent activities that can run in parallel. Works like agent_spawn for each one.',
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
      description: 'The accounts this mission may use, per CLI: how much of each one\'s limit is used, how many agents run on it now and whether more can be opened. Orbit already shares the work; use it to explain to the user or to decide whether to open more now.',
    }, guarded(() => core.capacity(caller.missionId)))

    server.registerTool('agent_close', {
      description: 'Closes a helper (ends its process and removes its terminal) after you integrated its result. Does not close one that has not delivered, unless force is true (a helper really stuck).',
      inputSchema: { agent: z.number().int().describe('The helper\'s number'), force: z.boolean().optional().describe('Close even without a result (only if stuck)') },
    }, guarded(({ agent, force }: { agent: number; force?: boolean }) => {
      core.closeHelper(caller, agent, force === true)
      return `Ajudante #${agent} fechado.`
    }))

    server.registerTool('agent_interrupt', {
      description: 'Stops what a helper is doing (like pressing Esc in its terminal) and, if you pass message, gives the new direction right after. Use it when it went the wrong way; to just talk, agent_send.',
      inputSchema: { agent: z.number().int().describe('The helper\'s number'), message: z.string().max(8000).optional().describe('New direction, typed after the interruption') },
    }, guarded(async ({ agent, message }: { agent: number; message?: string }) => {
      await core.interrupt(caller, agent, message ?? null)
      return message ? `#${agent} interrompido e reorientado.` : `#${agent} interrompido. Ele espera no terminal; mande a orientação com agent_send.`
    }))

    server.registerTool('agent_resume', {
      description: 'Resumes a helper that stopped (process ended, stuck, Orbit reopened) in the same conversation, with the message to carry on. It keeps its number and branch.',
      inputSchema: { agent: z.number().int().describe('The helper\'s number'), message: z.string().max(8000).optional().describe('What to do now (default: carry on with the task and deliver)') },
    }, guarded(({ agent, message }: { agent: number; message?: string }) => {
      core.resumeHelper(caller, agent, message ?? null)
      return `#${agent} retomado na mesma conversa. O retorno chega sozinho.`
    }))

    server.registerTool('mission_ready', {
      description: 'Declares the mission ready, with the objective met and verified. Orbit marks the mission and tells the user. Refused while a helper still owes a result, unless force is true. Write the summary in Brazilian Portuguese: the user reads it.',
      inputSchema: {
        summary: z.string().min(1).max(4000).describe('What was done, by whom, how it was verified and what is left (in Brazilian Portuguese)'),
        force: z.boolean().optional().describe('Declare it even with helpers owing results'),
      },
    }, guarded(({ summary, force }: { summary: string; force?: boolean }) => {
      core.missionReady(caller, summary, force === true)
      return 'Missão marcada como pronta; o usuário foi avisado. Diga a ele, em poucas linhas, o resultado.'
    }))

    if (core.mission(caller.missionId)?.git) {
      server.registerTool('branches', {
        description: 'Mission with a branch per agent: the mission branch (yours) and each helper\'s, with how many commits are not yet integrated into yours and the uncommitted files.',
      }, guarded(() => {
        const summary = core.gitSummary(caller.missionId)
        return { mission: { branch: summary.branch, base: summary.base, commits: summary.commits.length }, helpers: summary.agents.map((a) => ({ agent: `#${a.paneId}`, title: a.title, branch: a.branch, toMerge: a.ahead, uncommitted: a.dirty.length })) }
      }))
    }

    server.registerTool('mission_briefing', {
      description: 'The mission briefing: objective, decisions written down, board, helpers and what each one owes, results, branches and the recent flow. Read it when you take over as lead and whenever you lose the thread (compacted conversation, resumed session).',
    }, guarded(() => core.missionBriefing(caller.missionId)))

    server.registerTool('mission_note', {
      description: 'Writes down a decision or an important fact of the mission (what was decided and why, what not to do, where something is). Notes pass to any lead after you.',
      inputSchema: { text: z.string().min(1).max(1000) },
    }, guarded(({ text }: { text: string }) => `Anotado (${core.addNote(caller, text).length} notas na missão).`))

    server.registerTool('ask_user', {
      description: 'Asks the user something only they can decide. Your terminal is marked "waiting for you" with the question and the choices as buttons, and the user is notified; the answer is typed into your terminal. Ask in Brazilian Portuguese. After asking, end your turn.',
      inputSchema: {
        question: z.string().min(1).max(600).describe('The question, with the minimum context to decide (in Brazilian Portuguese)'),
        choices: z.array(z.string().min(1).max(80)).max(6).optional().describe('Suggested answers (up to 6)'),
      },
    }, guarded(({ question, choices }: { question: string; choices?: string[] }) => {
      core.askUser(caller, question, choices ?? [])
      return 'Pergunta feita. Encerre o turno: a resposta chega no seu terminal.'
    }))

    const kinds = core.routing().taskTypes
    server.registerTool('routing_propose', {
      description: 'Proposes to the user a change to a row of the "who does each kind of work" table (CLI, model, effort, method, read-only), with the reason, when this mission shows another choice would be better. The user accepts or refuses in Settings, and the answer reaches your terminal. Nothing changes before that.',
      inputSchema: {
        kind: z.enum(kinds.map((t) => t.id) as [string, ...string[]]).describe('The table row'),
        agent: z.enum(AGENT_CLIS as unknown as [AgentCliForRole, ...AgentCliForRole[]]).optional(),
        model: z.union([z.string().regex(MODEL_ID), z.null()]).optional().describe('Model, or null for the CLI\'s default'),
        effort: z.union([z.enum(EFFORTS as [Effort, ...Effort[]]), z.null()]).optional(),
        method: z.string().max(1500).optional().describe('New "how to do it" (replaces the current one)'),
        readOnly: z.boolean().optional(),
        reason: z.string().min(1).max(600).describe('What in this mission showed the change is worth it (in Brazilian Portuguese: the user reads it)'),
      },
    }, guarded(({ kind, agent, model, effort, method, readOnly, reason }: { kind: string; agent?: AgentCliForRole; model?: string | null; effort?: Effort | null; method?: string; readOnly?: boolean; reason: string }) => {
      core.proposeRouting(caller, { kind, change: { cli: agent, model, effort, method, readOnly }, reason })
      return 'Proposta enviada ao usuário. A resposta chega no seu terminal; até lá a tabela não muda.'
    }))

    server.registerTool('handoff_list', {
      description: 'Full text of the results helpers delivered in this mission.',
    }, guarded(() => core.missionEvents(caller.missionId, 'handoff').map((e) => ({ from: e.paneId, at: new Date(e.at).toISOString(), text: e.body }))))
  }

  server.registerTool('agent_send', {
    description: 'Writes a message into another agent\'s terminal of the mission, as if typed. Use it to answer questions or redirect a helper.',
    inputSchema: { agent: z.number().int().describe('The agent\'s number'), message: z.string().min(1).max(8000) },
  }, guarded(({ agent, message }: { agent: number; message: string }) => {
    core.sendTo(caller, agent, message)
    return `Mensagem enviada para #${agent}.`
  }))

  server.registerTool('agent_read', {
    description: 'Reads what is on another agent\'s terminal screen (plain text).',
    inputSchema: { agent: z.number().int().describe('The agent\'s number'), lines: z.number().int().min(1).max(400).optional().describe('How many last lines (default 60)') },
  }, guarded(({ agent, lines }: { agent: number; lines?: number }) => core.readScreen(caller, agent, lines ?? 60) || '(tela vazia)'))

  registerBrowserTools(server, core, caller)
  registerBoardTools(server, core, caller)

  // Helpers the lead opened may open a couple of sub-helpers; their results come back to them.
  if (caller.role === 'crew' && (core.childSlots(caller) > 0 || core.missionPanes(caller.missionId).some((p) => p.assignedBy === caller.id))) {
    const kinds = core.routing().taskTypes
    server.registerTool('agent_spawn', {
      description: 'Opens a sub-helper for a large, independent part of your task (at most 2 open). Orbit picks CLI, model and account; its result reaches your terminal, and your final delivery stays yours.',
      inputSchema: {
        title: z.string().max(120).optional(),
        task: z.string().min(1).max(20000).describe('The part of the task, self-contained: context, files, what to deliver, how to verify it'),
        kind: z.enum(kinds.map((t) => t.id) as [string, ...string[]]).optional().describe(`Kind of work (${kinds.map((t) => t.id).join(', ')}); without it Orbit classifies`),
        accept: ACCEPT,
        ...folderField(core, caller),
      },
    }, guarded(async (h: HelperInput) => `Aberto:\n${await openHelper(core, caller, h)}\n\nContinue a sua parte; o retorno dele chega sozinho.`))

    server.registerTool('agent_close', {
      description: 'Closes a sub-helper of yours that delivered. With force, closes it even without a result (only if stuck).',
      inputSchema: { agent: z.number().int(), force: z.boolean().optional() },
    }, guarded(({ agent, force }: { agent: number; force?: boolean }) => {
      core.closeHelper(caller, agent, force === true)
      return `Sub-ajudante #${agent} fechado.`
    }))
  }

  if (caller.role === 'crew') {
    server.registerTool('handoff_submit', {
      description: 'Delivers your task\'s result to whoever asked (usually the lead). done = finished, with evidence; blocked = stuck, with the question or the blocker; progress = a heads-up midway, only recorded (you carry on). The summary is typed into the receiver\'s terminal; the details stay in the mission flow.',
      inputSchema: {
        summary: z.string().min(1).max(2000).describe('Short summary: what changed, where, what is left'),
        status: z.enum(['done', 'blocked', 'progress']).optional().describe('Default: done'),
        evidence: z.string().max(4000).optional().describe('How you verified it: commands run and their output, tests, files checked. Required with done'),
        details: z.string().max(20000).optional().describe('Optional details (file list, test output…)'),
        to: z.number().int().optional().describe('Deliver to another agent of the mission (e.g. the reviewer) instead of the lead, when your task says so'),
        criteria: z.array(z.object({ item: z.number().int().min(1), met: z.boolean(), how: z.string().max(300) })).max(8).optional().describe('Answer to each acceptance criterion of the task: number, whether it holds and how you checked'),
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
    description: 'The mission board\'s cards (afazer, fazendo, feito), in order, with who owns each. The user sees and moves the same board.',
  }, guarded(() => core.boardList(caller)))

  server.registerTool('board_add', {
    description: 'Creates a card on the mission board. One per activity; its number (T1, T2…) comes back in the answer.',
    inputSchema: {
      title: z.string().min(1).max(CARD_LIMITS.title),
      notes: z.string().max(CARD_LIMITS.notes).optional().describe('Details: context, definition of done'),
      column: column.optional().describe('Default: afazer'),
      assignee: z.number().int().optional().describe('The agent\'s number'),
    },
  }, guarded(({ title, notes, column: col, assignee }: { title: string; notes?: string; column?: CardColumn; assignee?: number }) => core.boardAdd(caller, { title, notes, column: col, assignee })))

  server.registerTool('board_update', {
    description: 'Updates a card by its number: move it to fazendo when you start and to feito when you finish; assignee "eu" takes the card for you.',
    inputSchema: {
      card: z.union([z.number().int().min(1), z.string().regex(/^T?\d+$/i)]).describe('Card number, e.g. 3 or "T3"'),
      column: column.optional(),
      title: z.string().min(1).max(CARD_LIMITS.title).optional(),
      notes: z.string().max(CARD_LIMITS.notes).optional(),
      assignee: z.union([z.number().int(), z.literal('eu'), z.null()]).optional().describe('The agent\'s number'),
    },
  }, guarded(({ card, column: col, title, notes, assignee }: { card: number | string; column?: CardColumn; title?: string; notes?: string; assignee?: number | 'eu' | null }) =>
    core.boardUpdate(caller, typeof card === 'number' ? card : Number(String(card).replace(/^T/i, '')), { column: col, title, notes, assignee })))
}

/** The mission's browser: one page shared by its agents and shown to the person. */
function registerBrowserTools(server: McpServer, core: OrbitCore, caller: Pane): void {
  const { width, height } = BROWSER_VIEWPORT
  server.registerTool('browser_open', {
    description: `Opens an address in the mission browser (headless Chromium, ${width}×${height}); the user sees the same page in Orbit. Use it to check the running app, e.g. http://localhost:5173. Waits for the page to load.`,
    inputSchema: { url: z.string().min(1).max(2000).describe('An http(s) address; "localhost:3000" works too') },
  }, guarded(async ({ url }: { url: string }) => {
    const state = await core.browserOpen(caller, url)
    return { url: state.url, title: state.title, error: state.error }
  }))

  server.registerTool('browser_screenshot', {
    description: 'Captures the mission browser\'s current screen (PNG). Click coordinates are in this image\'s pixels.',
  }, guarded(async () => ({ content: [{ type: 'image', data: await core.browserScreenshot(caller), mimeType: 'image/png' }] })))

  server.registerTool('browser_text', {
    description: 'Visible text of the open page (innerText), with address and title.',
    inputSchema: { maxChars: z.number().int().min(100).max(100_000).optional().describe('Character limit (default 20000)') },
  }, guarded(({ maxChars }: { maxChars?: number }) => core.browserText(caller, maxChars ?? 20_000)))

  server.registerTool('browser_click', {
    description: 'Clicks an element (CSS selector, preferably) or a point on the screen (x, y of the capture).',
    inputSchema: {
      selector: z.string().min(1).max(500).optional().describe('CSS selector, e.g. button[type=submit]'),
      x: z.number().min(0).max(width).optional(),
      y: z.number().min(0).max(height).optional(),
    },
  }, guarded(async ({ selector, x, y }: { selector?: string; x?: number; y?: number }) => {
    if (!selector && (x === undefined || y === undefined)) throw new Error('Passe um seletor ou x e y')
    const point = await core.browserClick(caller, selector ? { selector } : { x: x!, y: y! })
    return `Clique em (${point.x}, ${point.y}).`
  }))

  server.registerTool('browser_type', {
    description: 'Types into the focused field (click it first). With submit, presses Enter at the end.',
    inputSchema: { text: z.string().max(10_000), submit: z.boolean().optional() },
  }, guarded(async ({ text: value, submit }: { text: string; submit?: boolean }) => {
    await core.browserType(caller, value, submit ?? false)
    return 'Digitado.'
  }))

  server.registerTool('browser_key', {
    description: 'Presses a key on the page.',
    inputSchema: { key: z.enum(BROWSER_KEYS as unknown as [string, ...string[]]) },
  }, guarded(async ({ key }: { key: string }) => {
    await core.browserKey(caller, key)
    return `Tecla ${key}.`
  }))

  server.registerTool('browser_scroll', {
    description: 'Scrolls the page (positive goes down, negative up), in pixels.',
    inputSchema: { dy: z.number().int().min(-5000).max(5000) },
  }, guarded(async ({ dy }: { dy: number }) => {
    await core.browserScroll(caller, dy)
    return 'Rolado.'
  }))

  server.registerTool('browser_console', {
    description: 'Console messages, JavaScript errors and failed requests on the page, oldest first.',
    inputSchema: { lines: z.number().int().min(1).max(200).optional().describe('How many (default 50)') },
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
