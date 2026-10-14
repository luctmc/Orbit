import { AGENT_CLIS, EFFORTS, MODEL_ID, ROUTING_LIMITS, SLUG, type AgentCliForRole, type AgentSeat, type Effort, type Routing, type TaskType } from '@orbit/protocol'
import { slugify } from './squads.ts'

/**
 * How each built-in kind of work is done. It goes in the helper's first message, so it reaches
 * Codex as well as Claude (skills only reach whoever has them installed).
 */
export const FACTORY_METHODS: Record<string, { method: string; readOnly: boolean }> = {
  bug: { readOnly: false, method: '1. Reproduce it before changing anything (a failing test or command) and keep the output.\n2. Find the root cause, not just the symptom.\n3. Make the smallest change that fixes it.\n4. Leave a test that failed before and passes now; run the whole suite.\n5. Deliver with the before and after as evidence.' },
  funcionalidade: { readOnly: false, method: '1. Read the surrounding code and follow its style.\n2. Build the minimum that does what was asked, no extras.\n3. Cover the new behavior with tests and run the suite and the build.\n4. Deliver saying where it changed and how to use it.' },
  refatoracao: { readOnly: false, method: '1. Run the tests first and keep the result.\n2. Change the structure without changing behavior, in small steps.\n3. Run the same tests after: the result must be the same.\n4. Do not mix in fixes or features; note what you find and mention it when delivering.' },
  testes: { readOnly: false, method: '1. Test behavior, not implementation details.\n2. Cover the happy path, the edges and the errors.\n3. Check that each new test would fail without the code it protects.\n4. Run the suite and deliver its output (how many pass and fail). Do not change production code without saying so when delivering.' },
  investigacao: { readOnly: true, method: '1. Do not edit files.\n2. Make hypotheses and test each one with evidence: commands, measurements, logs.\n3. Cite file:line for every claim.\n4. Deliver the likely cause, how sure you are and the suggested next step.' },
  documentacao: { readOnly: false, method: '1. Write for someone new: what it is, how to install it, how to use it.\n2. Check every command and path you mention against the repository.\n3. Keep it short and match the tone of the existing docs.' },
  revisao: { readOnly: true, method: '1. Do not edit files.\n2. Read the diff (git show, git diff) and the code around it.\n3. Try to refute it: run the tests, look for edge cases, regressions and security risks.\n4. Check that the new tests fail without the change.\n5. Deliver APPROVED or NEEDS CHANGES, with file:line and the why of each point.' },
}

/** Each built-in kind's equivalent on the other CLI, for the maestro to balance the load. */
export const FACTORY_ALTS: Record<string, AgentSeat> = {
  bug: { cli: 'codex', model: null, effort: 'medium' },
  funcionalidade: { cli: 'codex', model: null, effort: 'medium' },
  refatoracao: { cli: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' },
  testes: { cli: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' },
  investigacao: { cli: 'codex', model: null, effort: 'high' },
  documentacao: { cli: 'codex', model: null, effort: 'low' },
  revisao: { cli: 'claude', model: 'claude-opus-5-5', effort: 'high' },
}

/** How the factory methods began in Portuguese (v0.2.10–0.2.11), to move saved tables to English. */
export const OLD_FACTORY_START: Record<string, string> = {
  bug: '1. Reproduza antes de mexer',
  funcionalidade: '1. Leia o código vizinho',
  refatoracao: '1. Rode os testes antes',
  testes: '1. Teste comportamento',
  investigacao: '1. Não edite arquivos.\n2. Levante',
  documentacao: '1. Escreva para quem chega',
  revisao: '1. Não edite arquivos.\n2. Leia o diff',
}

const row = (id: string, name: string, description: string, model: string | null, effort: Effort, cli: AgentCliForRole = 'claude'): TaskType =>
  ({ id, name, description, cli, model, effort, skills: [], onlySkills: false, method: FACTORY_METHODS[id]?.method ?? '', readOnly: FACTORY_METHODS[id]?.readOnly ?? false, alt: FACTORY_ALTS[id] ?? null })

/** The table Orbit ships with; the user edits a copy in Settings. */
export const DEFAULT_ROUTING: Routing = {
  lead: { cli: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  taskTypes: [
    row('bug', 'Correção de bug', 'Algo quebrou: erro, regressão, comportamento errado.', 'claude-sonnet-5-5', 'medium'),
    row('funcionalidade', 'Funcionalidade', 'Comportamento novo: tela, fluxo, endpoint, opção.', 'claude-sonnet-5-5', 'medium'),
    row('refatoracao', 'Refatoração', 'Mudar a estrutura sem mudar o comportamento.', null, 'medium', 'codex'),
    row('testes', 'Testes', 'Escrever ou consertar testes, aumentar cobertura.', null, 'medium', 'codex'),
    row('investigacao', 'Investigação', 'Descobrir o porquê, medir, auditar. Não edita código.', 'claude-opus-5-5', 'high'),
    row('documentacao', 'Documentação', 'README, comentários, guias e notas de versão.', 'claude-haiku-5-5', 'low'),
    row('revisao', 'Revisão', 'Conferir o trabalho de outro agente: diff, testes, riscos. Não edita; aponta o que corrigir.', null, 'high', 'codex'),
  ],
}

const CLIS: readonly AgentCliForRole[] = AGENT_CLIS

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
    const method = typeof t.method === 'string' ? t.method.trim().slice(0, ROUTING_LIMITS.method) : ''
    const rowCli = cli(t.cli, name)
    const alt = t.alt && t.alt.cli !== rowCli ? { cli: cli(t.alt.cli, `${name} (equivalente)`), model: model(t.alt.model, `${name} (equivalente)`), effort: effort(t.alt.effort, `${name} (equivalente)`) } : null
    return { id, name, description, cli: rowCli, model: model(t.model, name), effort: effort(t.effort, name), skills, onlySkills: t.onlySkills === true, method, readOnly: t.readOnly === true, alt }
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
