import { EFFORTS, MODEL_ID, ROUTING_LIMITS, SLUG, type AgentCliForRole, type Effort, type Routing, type TaskType } from '@orbit/protocol'
import { slugify } from './squads.ts'

/**
 * How each built-in kind of work is done. It goes in the helper's first message, so it reaches
 * Codex as well as Claude (skills only reach whoever has them installed).
 */
export const FACTORY_METHODS: Record<string, { method: string; readOnly: boolean }> = {
  bug: { readOnly: false, method: '1. Reproduza antes de mexer (um teste ou comando que falha) e guarde a saída.\n2. Ache a causa raiz, não só o sintoma.\n3. Faça a menor mudança que corrige.\n4. Deixe um teste que falhava antes e passa agora; rode a suíte inteira.\n5. Entregue com o antes e o depois como evidência.' },
  funcionalidade: { readOnly: false, method: '1. Leia o código vizinho e siga o estilo dele.\n2. Implemente o mínimo que cumpre o pedido, sem extras.\n3. Cubra o comportamento novo com testes e rode a suíte e o build.\n4. Entregue dizendo onde mudou e como usar.' },
  refatoracao: { readOnly: false, method: '1. Rode os testes antes e guarde o resultado.\n2. Mude a estrutura sem mudar o comportamento, em passos pequenos.\n3. Rode os mesmos testes depois: o resultado tem de ser igual.\n4. Não misture correções nem funcionalidades; anote o que achar e conte na entrega.' },
  testes: { readOnly: false, method: '1. Teste comportamento, não detalhes de implementação.\n2. Cubra o caminho feliz, as bordas e os erros.\n3. Confira que cada teste novo falharia sem o código que ele protege.\n4. Rode a suíte e entregue a saída (quantos passam e falham). Não mude código de produção sem dizer na entrega.' },
  investigacao: { readOnly: true, method: '1. Não edite arquivos.\n2. Levante hipóteses e teste cada uma com evidência: comandos, medidas, logs.\n3. Cite arquivo:linha em cada afirmação.\n4. Entregue a causa provável, o grau de certeza e o próximo passo sugerido.' },
  documentacao: { readOnly: false, method: '1. Escreva para quem chega agora: o que é, como instalar, como usar.\n2. Confira no repositório cada comando e caminho que citar.\n3. Seja curto e siga o tom dos documentos que já existem.' },
  revisao: { readOnly: true, method: '1. Não edite arquivos.\n2. Leia o diff (git show, git diff) e o código em volta.\n3. Tente refutar: rode os testes, procure bordas, regressões e riscos de segurança.\n4. Confira que os testes novos falham sem a mudança.\n5. Entregue APROVADO ou A CORRIGIR, com arquivo:linha e o porquê de cada ponto.' },
}

const row = (id: string, name: string, description: string, model: string | null, effort: Effort, cli: AgentCliForRole = 'claude'): TaskType =>
  ({ id, name, description, cli, model, effort, skills: [], onlySkills: false, method: FACTORY_METHODS[id]?.method ?? '', readOnly: FACTORY_METHODS[id]?.readOnly ?? false })

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
    const method = typeof t.method === 'string' ? t.method.trim().slice(0, ROUTING_LIMITS.method) : ''
    return { id, name, description, cli: cli(t.cli, name), model: model(t.model, name), effort: effort(t.effort, name), skills, onlySkills: t.onlySkills === true, method, readOnly: t.readOnly === true }
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
