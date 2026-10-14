import { EFFORTS, MODEL_ID, ROUTING_LIMITS, SLUG, type AgentCliForRole, type Effort, type Routing, type TaskType } from '@orbit/protocol'
import { slugify } from './squads.ts'

const row = (id: string, name: string, description: string, model: string, effort: Effort, skills: string[] = []): TaskType =>
  ({ id, name, description, cli: 'claude', model, effort, skills, onlySkills: false })

/** The table Orbit ships with; the user edits a copy in Settings. */
export const DEFAULT_ROUTING: Routing = {
  lead: { cli: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  taskTypes: [
    row('bug', 'Correção de bug', 'Algo quebrou: erro, regressão, comportamento errado.', 'claude-sonnet-5-5', 'medium'),
    row('funcionalidade', 'Funcionalidade', 'Comportamento novo: tela, fluxo, endpoint, opção.', 'claude-sonnet-5-5', 'medium'),
    row('refatoracao', 'Refatoração', 'Mudar a estrutura sem mudar o comportamento.', 'claude-sonnet-5-5', 'medium'),
    row('testes', 'Testes', 'Escrever ou consertar testes, aumentar cobertura.', 'claude-sonnet-5-5', 'low'),
    row('investigacao', 'Investigação', 'Descobrir o porquê, medir, auditar. Não edita código.', 'claude-opus-5-5', 'high'),
    row('documentacao', 'Documentação', 'README, comentários, guias e notas de versão.', 'claude-haiku-5-5', 'low'),
  ],
}

const CLIS: readonly AgentCliForRole[] = ['claude', 'codex']

/** Validates a routing table from the UI. Row ids stay stable so leads can keep using them. */
export function normalizeRouting(input: Routing): Routing {
  const cli = (value: unknown, field: string): AgentCliForRole => {
    if (!CLIS.includes(value as AgentCliForRole)) throw new Error(`Tabela: agente inválido em ${field}`)
    return value as AgentCliForRole
  }
  const model = (value: unknown, field: string): string | null => {
    if (value === null || value === undefined || value === '') return null
    if (typeof value !== 'string' || !MODEL_ID.test(value)) throw new Error(`Tabela: modelo inválido em ${field}`)
    return value
  }
  const effort = (value: unknown, field: string): Effort | null => {
    if (value === null || value === undefined) return null
    if (!EFFORTS.includes(value as Effort)) throw new Error(`Tabela: esforço inválido em ${field}`)
    return value as Effort
  }

  if (!Array.isArray(input?.taskTypes) || input.taskTypes.length === 0) throw new Error('Tabela: inclua pelo menos um tipo de tarefa')
  if (input.taskTypes.length > ROUTING_LIMITS.taskTypes) throw new Error(`Tabela: no máximo ${ROUTING_LIMITS.taskTypes} tipos`)

  const ids = new Set<string>()
  const taskTypes = input.taskTypes.map((t, i) => {
    const name = typeof t.name === 'string' ? t.name.trim() : ''
    if (!name) throw new Error(`Tabela: dê um nome ao tipo ${i + 1}`)
    if (name.length > ROUTING_LIMITS.name) throw new Error(`Tabela: nome longo demais em ${name}`)
    const id = SLUG.test(t.id ?? '') ? t.id : slugify(name)
    if (ids.has(id)) throw new Error(`Tabela: dois tipos com o mesmo identificador (${id})`)
    ids.add(id)
    const skills = skillList(t.skills, `Tabela (${name})`)
    const description = typeof t.description === 'string' ? t.description.trim().slice(0, ROUTING_LIMITS.description) : ''
    return { id, name, description, cli: cli(t.cli, name), model: model(t.model, name), effort: effort(t.effort, name), skills, onlySkills: t.onlySkills === true }
  })

  return {
    lead: { cli: cli(input.lead?.cli, 'líder'), model: model(input.lead?.model, 'líder'), effort: effort(input.lead?.effort, 'líder') },
    taskTypes,
  }
}

/** Skill names for a task type or squad role: trimmed, distinct, within the limits. */
export function skillList(input: unknown, where: string): string[] {
  const skills = [...new Set((Array.isArray(input) ? input : []).map((s) => String(s).trim()).filter(Boolean))]
  if (skills.length > ROUTING_LIMITS.skills) throw new Error(`${where}: no máximo ${ROUTING_LIMITS.skills} skills`)
  if (skills.some((s) => s.length > ROUTING_LIMITS.skill || /\s/.test(s))) throw new Error(`${where}: nome de skill inválido`)
  return skills
}
