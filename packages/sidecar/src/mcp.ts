import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { MODEL_ID, type Pane } from '@orbit/protocol'
import type { OrbitCore } from './core.ts'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

const text = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

/** Runs a tool body, turning domain errors into MCP tool errors the agent can read. */
const guarded = <A>(body: (args: A) => unknown) => async (args: A): Promise<ToolResult> => {
  try {
    return text(await body(args))
  } catch (error) {
    return { ...text(error instanceof Error ? error.message : String(error)), isError: true }
  }
}

const agentView = (p: Pane) => ({
  id: p.id,
  role: p.role === 'lead' ? 'líder' : 'ajudante',
  squadRole: p.squadRole,
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
    description: 'Quem você é no Orbit: seu número de agente, papel, missão e objetivo.',
  }, guarded(() => {
    const mission = core.mission(caller.missionId)
    return { agent: agentView(self()), mission: mission && { title: mission.title, mode: mission.mode, objective: mission.objective } }
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
    const roleField: Record<string, z.ZodType> = roleIds.length
      ? { role: z.enum(roleIds as [string, ...string[]]).optional().describe(`Papel do squad "${squad?.name}" (${squad?.roles.map((r) => `${r.id} = ${r.name}`).join(', ')}). Com papel, o agente, o modelo e as instruções vêm do squad.`) }
      : {}

    server.registerTool('agent_spawn', {
      description: 'Abre um ajudante num terminal visível ao usuário, na mesma pasta, já com a tarefa. A tarefa deve ser autocontida: contexto, arquivos, o que entregar e como verificar. O ajudante devolve o resultado com handoff_submit e ele chega a você como "[Orbit] Retorno de #N".',
      inputSchema: {
        title: z.string().max(120).optional().describe('Função curta do ajudante, ex.: "Mapear leituras do token" (padrão: nome do papel)'),
        task: z.string().min(1).max(20000).describe('A tarefa completa para o ajudante'),
        ...roleField,
        agent: z.enum(['claude', 'codex']).optional().describe('Qual CLI usar quando não há papel (padrão: claude)'),
        model: z.string().regex(MODEL_ID).optional().describe('Modelo quando não há papel, ex.: claude-sonnet-5-5'),
      },
    }, guarded(({ title, task, role, agent, model }: { title?: string; task: string; role?: string; agent?: 'claude' | 'codex'; model?: string }) => {
      const pane = core.spawnHelper(caller, { title: title ?? '', task, cli: agent ?? 'claude', model: model ?? null, squadRoleId: role ?? null })
      return `${pane.squadRole ?? 'Ajudante'} #${pane.id} aberto (${pane.title}). Ele vai mandar o retorno quando terminar.`
    }))

    server.registerTool('agent_close', {
      description: 'Fecha um ajudante da missão (encerra o processo e tira o terminal da tela). Use depois de integrar o retorno dele, ou se ele travou.',
      inputSchema: { agent: z.number().int().describe('Número do ajudante') },
    }, guarded(({ agent }: { agent: number }) => {
      core.closeHelper(caller, agent)
      return `Ajudante #${agent} fechado.`
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
