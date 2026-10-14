import { useEffect, useState } from 'react'
import { effortsFor, type AgentCli, type AgentCliForRole, type Effort } from '@orbit/protocol'
import { useOrbit } from '../orbit/context.tsx'
import { accountLabel, CLI_LABEL, EFFORT_LABEL, modelOptions } from '../orbit/labels.ts'

/** Model field with the CLI's real models as suggestions; any model id can still be typed. */
export function ModelInput({ id, cli, value, onChange, label, disabled, className }: {
  id: string
  cli: AgentCli
  value: string | null
  onChange: (model: string | null) => void
  label?: string
  disabled?: boolean
  className?: string
}) {
  const { catalog } = useOrbit()
  return (
    <>
      {label && <label className="sr-only" htmlFor={id}>{label}</label>}
      <input id={id} className={className} list={`${id}-list`} value={value ?? ''} disabled={disabled} spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim() || null)} placeholder={cli === 'shell' ? '' : `padrão do ${CLI_LABEL[cli]}`} />
      <datalist id={`${id}-list`}>{modelOptions(catalog, cli).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
    </>
  )
}

/** The levels this CLI and model accept, and the model's own default when the catalog knows it. */
export function useEfforts(cli: AgentCli, model: string | null): { allowed: readonly Effort[]; modelDefault: Effort | null } {
  const { catalog } = useOrbit()
  const allowed = effortsFor(catalog, cli, model)
  const modelDefault = cli === 'shell' || !catalog ? null : catalog[cli].models.find((m) => m.id === model)?.defaultEffort ?? null
  return { allowed, modelDefault }
}

/** Drops an effort the newly chosen CLI or model does not accept. */
function useKeepValid(value: Effort | null, allowed: readonly Effort[], onChange: (e: Effort | null) => void) {
  useEffect(() => {
    if (value && allowed.length && !allowed.includes(value)) onChange(null)
  }, [value, allowed, onChange])
}

const defaultLabel = (modelDefault: Effort | null) => (modelDefault ? `padrão (${EFFORT_LABEL[modelDefault]})` : 'padrão')

/** Segmented choice, for forms. */
export function EffortChoice({ cli, model, value, onChange }: { cli: AgentCli; model: string | null; value: Effort | null; onChange: (e: Effort | null) => void }) {
  const { allowed, modelDefault } = useEfforts(cli, model)
  useKeepValid(value, allowed, onChange)
  if (allowed.length === 0) return null
  return (
    <div className="segmented segmented--wrap" role="group" aria-label="Esforço">
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>{defaultLabel(modelDefault)}</button>
      {allowed.map((effort) => (
        <button key={effort} type="button" aria-pressed={value === effort} onClick={() => onChange(effort)}>{EFFORT_LABEL[effort]}</button>
      ))}
    </div>
  )
}

/** Compact button that cycles default → each accepted level, for tables. */
export function EffortCycle({ cli, model, value, onChange, label }: { cli: AgentCli; model: string | null; value: Effort | null; onChange: (e: Effort | null) => void; label: string }) {
  const { allowed, modelDefault } = useEfforts(cli, model)
  useKeepValid(value, allowed, onChange)
  const order: Array<Effort | null> = [null, ...allowed]
  const level = value ? allowed.indexOf(value) + 1 : 0
  return (
    <button type="button" className="effort" aria-label={`${label}: esforço ${value ? EFFORT_LABEL[value] : defaultLabel(modelDefault)}. Clique para trocar`}
      onClick={() => onChange(order[(order.indexOf(value) + 1) % order.length] ?? null)}>
      <span className="effort__bars" aria-hidden="true">{allowed.map((e, i) => <span key={e} className={i < level ? 'on' : ''} />)}</span>
      <span>{value ? EFFORT_LABEL[value] : defaultLabel(modelDefault)}</span>
    </button>
  )
}

/** Which account the agent runs as; "automatic" lets the sidecar pick the one with the most room. */
export function AccountSelect({ id, cli, value, onChange }: { id: string; cli: AgentCliForRole; value: string | null; onChange: (accountId: string | null) => void }) {
  const { accounts, accountStatuses, limits } = useOrbit()
  const mine = accounts.filter((a) => a.cli === cli)
  useEffect(() => {
    if (value && !mine.some((a) => a.id === value)) onChange(null)
  }, [value, mine, onChange])
  if (mine.length < 2) return null
  const describe = (accountId: string) => {
    const status = accountStatuses.find((s) => s.accountId === accountId)
    const l = limits.find((x) => x.accountId === accountId)
    const now = Date.now()
    const used = l ? Math.max(0, ...[l.fiveHour, l.weekly].filter((w) => w && w.resetsAt > now).map((w) => Math.round(w!.usedPercent))) : null
    if (status?.loggedIn === false) return ' — não logada'
    return used === null ? '' : ` — ${used}% usado`
  }
  return (
    <div className="field">
      <label htmlFor={id}>Conta</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Automática (a com mais folga)</option>
        {mine.map((a) => <option key={a.id} value={a.id}>{accountLabel(a, a.cli)}{a.builtin ? ' (deste Mac)' : a.kind === 'api' ? ' (chave de API)' : ''}{describe(a.id)}</option>)}
      </select>
    </div>
  )
}

const splitSkills = (text: string) => [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))]

/**
 * Skills of a task type or squad role, typed as a comma list, and whether the agent may use only
 * those. Names the CLI does not have installed are pointed out (they may come from elsewhere).
 */
export function SkillsField({ id, cli, skills, only, onChange, label, disabled }: {
  id: string
  cli: AgentCliForRole
  skills: string[]
  only: boolean
  onChange: (skills: string[], only: boolean) => void
  label: string
  disabled?: boolean
}) {
  const { skillCatalog } = useOrbit()
  const [text, setText] = useState(skills.join(', '))
  // Follow outside changes (another row, a reset) without fighting the person's typing.
  useEffect(() => {
    if (splitSkills(text).join(',') !== skills.join(',')) setText(skills.join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills])
  const known = new Set(skillCatalog.items.filter((i) => i.cli === cli && i.kind === 'skill').map((i) => i.name))
  const missing = skillCatalog.scannedAt ? skills.filter((name) => !known.has(name) && ![...known].some((k) => k.endsWith(`:${name}`))) : []
  return (
    <div className="skills-field">
      <label className="sr-only" htmlFor={id}>{label}, separadas por vírgula</label>
      <input id={id} className="routing__skills" value={text} placeholder="nenhuma" spellCheck={false} disabled={disabled} list={`${id}-list`}
        onChange={(e) => {
          setText(e.target.value)
          onChange(splitSkills(e.target.value), only)
        }} />
      <datalist id={`${id}-list`}>{[...known].map((name) => <option key={name} value={text.includes(',') ? `${text.slice(0, text.lastIndexOf(',') + 1)} ${name}` : name} />)}</datalist>
      <label className="check check--small">
        <input type="checkbox" checked={only} disabled={disabled} onChange={(e) => onChange(skills, e.target.checked)} />
        <span>só estas</span>
      </label>
      {missing.length > 0 && <span className="skills-field__warn">não instalada{missing.length > 1 ? 's' : ''} no {CLI_LABEL[cli]}: {missing.join(', ')}</span>}
    </div>
  )
}
