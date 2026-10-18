import { type AgentCliForRole, type AgentSeat, type Catalog, type Difficulty } from '@orbit/protocol'
import { cliLoad, type AccountRoom, seatForDifficulty } from './maestro.ts'

export type DesignWork = 'frontend' | 'motion' | null
export function designWork(text: string): DesignWork {
  if (/\b(motion|anima(?:tion|tions|ção|ções|cao|coes)|framer[ -]motion|gsap|transiç|microintera)/i.test(text)) return 'motion'
  if (/\b(front[ -]?end|visual|design|interface|ui|ux|css|layout|landing|tipografia|componente|tela|dashboard)\b/i.test(text)) return 'frontend'
  return null
}

/** Seats are drawn from the local catalog. Quota is per account, never per provider. */
export function automaticTaskSeat(input: {
  catalogForAccount?: (account: AccountRoom['account']) => import('@orbit/protocol').CliCatalog
  catalog: Catalog; preferred: AgentSeat; alternate?: AgentSeat | null; difficulty: Difficulty;
  design: DesignWork; allowed: AgentCliForRole[]; rooms: (cli: AgentCliForRole) => AccountRoom[];
}): (AgentSeat & { accountId?: string }) | null {
  const { catalog, preferred, alternate, difficulty, design, allowed, rooms } = input
  if (input.catalogForAccount) {
    const candidates = allowed.flatMap(cli => rooms(cli).flatMap(room => {
      const current = input.catalogForAccount!(room.account)
      if (current.source !== 'cli') return []
      const seat = automaticTaskSeat({...input, catalogForAccount: undefined, catalog: {...catalog,[cli]:current},allowed:[cli],rooms:()=>[room]})
      const load = cliLoad([room])
      return seat && load !== null ? [{...seat,accountId:room.account.id,load}] : []
    }))
    candidates.sort((a,b)=>a.load-b.load || Number(b.cli===preferred.cli)-Number(a.cli===preferred.cli) || a.accountId.localeCompare(b.accountId))
    const best = candidates[0]
    return best ? {cli:best.cli,model:best.model,effort:best.effort,accountId:best.accountId} : null
  }
  const clis = design === 'motion' ? ['claude'] as const : design ? ['claude', 'codex'] as const : [preferred.cli, ...(alternate ? [alternate.cli] : [])]
  const candidates = [...new Set(clis)].flatMap(cli => {
    if (!allowed.includes(cli)) return []
    const load = cliLoad(rooms(cli))
    if (load === null) return []
    const list = catalog[cli].models
    const base = cli === preferred.cli ? preferred : alternate?.cli === cli ? alternate : { cli, model: null, effort: 'medium' as const }
    let seat: AgentSeat
    if (base.pinned) {
      const model = list.find(m => m.id === (base.model ?? catalog[cli].defaultModel))
      if (!model) return []
      const effort = base.effort ?? (base.model === null ? catalog[cli].defaultEffort : null) ?? model.defaultEffort
      if (effort && !model.efforts.includes(effort)) return []
      seat = { cli, model: model.id, effort }
      if (design && !(cli === 'claude' && model.id === 'claude-opus-5-5' || design === 'frontend' && cli === 'codex' && model.id === 'gpt-6.1-sol')) return []
      if (design && !(design === 'motion' ? effort === 'high' : effort === 'medium' || effort === 'high')) return []
    } else if (design) {
      const model = list.find(m => cli === 'claude' ? m.id === 'claude-opus-5-5' : m.id === 'gpt-6.1-sol')
      const effort = design === 'motion' || difficulty === 'dificil' ? 'high' : 'medium'
      if (!model?.efforts.includes(effort)) return []
      seat = { cli, model: model.id, effort }
    } else {
      const levels = (model: string | null) => list.find(m => m.id === model)?.efforts ?? catalog[cli].efforts
      const tier = seatForDifficulty(cli, base.model, base.effort, difficulty, levels, catalog[cli])
      // A null model means the CLI's configured default, which can be an expensive frontier model.
      const normal = list.find(m => /sol|sonnet|workhorse/i.test(`${m.id} ${m.description}`))
      seat = { cli, model: list.some(m => m.id === tier.model) ? tier.model : normal?.id ?? null, effort: tier.effort }
      if (difficulty === 'simples' && /astra|opus|frontier/i.test(seat.model ?? '')) return []
      const model = list.find(m => m.id === seat.model)
      if (!model) return []
      if (!seat.effort && model.efforts.length) seat.effort = model.efforts.includes('medium') ? 'medium' : model.efforts.find(e => e === 'low' || e === 'high') ?? null
      if (model.efforts.length && !seat.effort || seat.effort && !model.efforts.includes(seat.effort)) return []
    }
    return [{ seat, load }]
  })
  candidates.sort((a, b) => a.load - b.load || Number(b.seat.cli === preferred.cli) - Number(a.seat.cli === preferred.cli))
  return candidates[0]?.seat ?? null
}
