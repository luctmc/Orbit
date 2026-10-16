import { randomBytes } from 'node:crypto'
import { AGENT_CLIS, MODEL_ID, SLUG, SQUAD_LIMITS, type AgentCliForRole, type Squad, type SquadInput, type SquadRole } from '@orbit/protocol'
import { skillList } from './routing.ts'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'

const role = (id: string, name: string, model: string, brief: string): SquadRole => ({ id, name, cli: 'claude', model, brief, skills: [], onlySkills: false, readOnly: id !== 'construtor' })
const steps = (...lines: string[]) => lines.map((line, i) => `${i + 1}. ${line}`).join('\n')

/** Squads shipped with Orbit. Read-only; the UI offers "duplicate" to customize them. */
export const BUILTIN_SQUADS: readonly Squad[] = [
  {
    id: 'caca-bugs',
    name: 'Caça-bugs',
    description: 'Acha a causa raiz, corrige com um teste que falhava e revisa antes de entregar.',
    builtin: true,
    updatedAt: 0,
    lead: { cli: 'claude', model: OPUS },
    playbook: steps(
      'Abra o Batedor com o relato do bug e espere a causa raiz. Não corrija nada antes disso.',
      'Com a causa confirmada, abra o Construtor passando a causa, o arquivo:linha e como reproduzir.',
      'Quando o Construtor entregar, abra o Revisor com a lista de arquivos alterados e o que o teste novo cobre.',
      'Se o Revisor apontar problemas, mande-os ao Construtor com agent_send e peça nova revisão.',
      'Feche cada ajudante depois de integrar o retorno. Termine com um resumo: causa, correção e testes.',
    ),
    roles: [
      role('batedor', 'Batedor', SONNET, 'Você investiga, não corrige. Reproduza o problema, leia o erro inteiro, siga o valor errado até a origem e teste uma hipótese por vez. Não edite arquivos do projeto (scripts temporários fora dele, tudo bem). Entregue a causa raiz com arquivo:linha, como reproduzir e a correção que sugere.'),
      role('construtor', 'Construtor', SONNET, 'Você corrige. Comece por um teste que falha reproduzindo o bug, depois faça a menor mudança que o faz passar, no estilo do código ao redor. Rode a suíte relevante. Entregue os arquivos alterados, o teste novo e a saída dos testes.'),
      role('revisor', 'Revisor', OPUS, 'Você revisa a mudança do Construtor sem editar nada. Procure regressões, casos de borda e testes que não provam a correção. Entregue uma lista de achados (arquivo:linha, problema, correção sugerida) ou diga explicitamente que não encontrou nada.'),
    ],
  },
  {
    id: 'funcionalidade',
    name: 'Funcionalidade',
    description: 'Planeja, implementa em partes independentes e verifica o resultado como usuário.',
    builtin: true,
    updatedAt: 0,
    lead: { cli: 'claude', model: OPUS },
    playbook: steps(
      'Abra o Arquiteto com o objetivo e espere o plano.',
      'Para cada parte do plano que não divide arquivos com outra, abra um Construtor com a parte e o contexto do plano. Partes independentes podem rodar ao mesmo tempo.',
      'Integre as entregas e abra o Verificador com o objetivo original e o que foi feito.',
      'Mande cada falha ao Construtor responsável e verifique de novo.',
      'Feche os ajudantes e resuma o que foi entregue e o que ficou de fora.',
    ),
    roles: [
      role('arquiteto', 'Arquiteto', OPUS, 'Você planeja, não implementa. Leia o código relacionado e devolva um plano: arquivos a criar ou mudar, ordem, riscos e como verificar cada parte. Divida em partes que não mexam nos mesmos arquivos.'),
      role('construtor', 'Construtor', SONNET, 'Você implementa exatamente a parte que recebeu, seguindo os padrões do código ao redor. Escreva ou ajuste os testes da parte e rode-os. Entregue os arquivos alterados e a saída dos testes.'),
      role('verificador', 'Verificador', SONNET, 'Você verifica a funcionalidade pronta sem corrigir nada: rode o build, os testes e o fluxo principal como um usuário faria. Entregue o que funciona, o que falha (com a evidência) e o que ficou de fora do pedido.'),
    ],
  },
  {
    id: 'auditoria',
    name: 'Auditoria',
    description: 'Três revisores olham o mesmo escopo em paralelo; o líder consolida. Ninguém edita código.',
    builtin: true,
    updatedAt: 0,
    lead: { cli: 'claude', model: OPUS },
    playbook: steps(
      'Defina o escopo (pastas, módulos ou mudança) a partir do objetivo.',
      'Abra Segurança, Performance e Qualidade ao mesmo tempo, todos com o mesmo escopo.',
      'Conforme os retornos chegam, descarte duplicados e achados sem evidência; peça detalhes com agent_send quando precisar.',
      'Entregue ao usuário um relatório único ordenado por gravidade. Não edite código.',
    ),
    roles: [
      role('seguranca', 'Segurança', OPUS, 'Você audita segurança sem editar nada: entradas não validadas, injeção, segredos expostos, permissões e dependências. Cada achado com arquivo:linha, impacto e correção sugerida, do mais grave ao menos grave.'),
      role('performance', 'Performance', SONNET, 'Você audita performance sem editar nada: trabalho repetido, consultas em laço, I/O bloqueante, vazamentos e renderizações desnecessárias. Cada achado com arquivo:linha, custo estimado e correção sugerida.'),
      role('qualidade', 'Qualidade', SONNET, 'Você audita qualidade sem editar nada: erros engolidos, casos de borda, código morto, testes ausentes e desvios do padrão do projeto. Cada achado com arquivo:linha, por que importa e correção sugerida.'),
    ],
  },
]

const CLIS: readonly AgentCliForRole[] = AGENT_CLIS

/** Validates a squad coming from the UI and returns the normalized custom squad. */
export function normalizeSquad(input: SquadInput, existingIds: ReadonlySet<string>): Squad {
  const text = (value: unknown, field: string, max: number, required = true) => {
    const s = typeof value === 'string' ? value.trim() : ''
    if (required && !s) throw new Error(`Squad: informe ${field}`)
    if (s.length > max) throw new Error(`Squad: ${field} passa de ${max} caracteres`)
    return s
  }
  const cli = (value: unknown, field: string): AgentCliForRole => {
    if (!CLIS.includes(value as AgentCliForRole)) throw new Error(`Squad: agente inválido em ${field}`)
    return value as AgentCliForRole
  }
  const model = (value: unknown, field: string): string | null => {
    if (value === null || value === undefined || value === '') return null
    if (typeof value !== 'string' || !MODEL_ID.test(value)) throw new Error(`Squad: modelo inválido em ${field}`)
    return value
  }

  const name = text(input.name, 'o nome', SQUAD_LIMITS.name)
  if (!Array.isArray(input.roles) || input.roles.length === 0) throw new Error('Squad: inclua pelo menos um papel')
  if (input.roles.length > SQUAD_LIMITS.roles) throw new Error(`Squad: no máximo ${SQUAD_LIMITS.roles} papéis`)

  const roleIds = new Set<string>()
  const roles = input.roles.map((r, i) => {
    const roleName = text(r.name, `o nome do papel ${i + 1}`, 40)
    const id = SLUG.test(r.id ?? '') ? r.id : slugify(roleName)
    if (roleIds.has(id)) throw new Error(`Squad: dois papéis com o mesmo identificador (${id})`)
    roleIds.add(id)
    return {
      id,
      name: roleName,
      cli: cli(r.cli, roleName),
      model: model(r.model, roleName),
      brief: text(r.brief, `as instruções de ${roleName}`, SQUAD_LIMITS.brief),
      skills: skillList(r.skills, `Squad (${roleName})`),
      onlySkills: r.onlySkills === true,
      readOnly: r.readOnly === true,
    }
  })

  // Saving over an existing custom squad keeps its id; anything else (new, or a builtin being
  // duplicated) gets a fresh one.
  const id = typeof input.id === 'string' && existingIds.has(input.id) ? input.id : `${slugify(name)}-${randomBytes(2).toString('hex')}`

  return {
    id,
    name,
    description: text(input.description, 'a descrição', SQUAD_LIMITS.description, false),
    builtin: false,
    lead: { cli: cli(input.lead?.cli, 'líder'), model: model(input.lead?.model, 'líder') },
    playbook: text(input.playbook, 'o roteiro', SQUAD_LIMITS.playbook),
    roles,
    updatedAt: Date.now(),
  }
}

export function slugify(value: string): string {
  const slug = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
  return slug || 'squad'
}
