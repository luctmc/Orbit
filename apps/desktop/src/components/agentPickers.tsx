import { useEffect, useState } from 'react'
import { AGENT_CLIS, AGENT_INFO, CLI_NAME, effortsFor, type AgentCli, type AgentCliForRole, type Effort } from '@orbit/protocol'
import { useOrbit } from '../orbit/context.tsx'
import { accountLabel, CLI_LABEL, EFFORT_LABEL, modelOptions } from '../orbit/labels.ts'

/** Whether an agent CLI is ready on this Mac: installed, and with an account signed in. */
export function useAgentReadiness(): (cli: AgentCliForRole) => { ready: boolean; text: string } {
  const { clis, accounts, accountStatuses } = useOrbit()
  return (cli) => {
    const status = clis.find((c) => c.cli === cli)
    if (!status || status.checkedAt === null) return { ready: true, text: 'verificando…' }
    if (!status.installed) return { ready: false, text: 'não instalado' }
    const mine = accounts.filter((a) => a.cli === cli)
    const login = (a: (typeof mine)[number]) => (a.kind === 'api' ? (a.keyHint !== null ? true : false) : accountStatuses.find((x) => x.accountId === a.id)?.loggedIn ?? null)
    if (mine.some((a) => login(a) === true)) return { ready: true, text: status.version ? `v${status.version}` : 'instalado' }
    if (mine.some((a) => login(a) === null)) return { ready: true, text: 'login a confirmar' }
    return { ready: false, text: 'sem login' }
  }
}

/**
 * The agent, as cards: each CLI with what it is and whether it is ready here. Not-ready ones can
 * still be picked (the note says what is missing); a plain terminal is offered when `shell`.
 */
export function AgentChooser({ value, onChange, shell = false, label }: { value: AgentCli; onChange: (cli: AgentCli) => void; shell?: boolean; label: string }) {
  const readiness = useAgentReadiness()
  const current = value === 'shell' ? null : readiness(value)
  return (
    <>
      <div className="agent-cards" role="radiogroup" aria-label={label}>
        {AGENT_CLIS.map((cli) => {
          const r = readiness(cli)
          return (
            <button key={cli} type="button" role="radio" aria-checked={value === cli} className={`agent-card${r.ready ? '' : ' agent-card--off'}`} onClick={() => onChange(cli)}>
              <strong>{AGENT_INFO[cli].label}</strong>
              <span className="agent-card__product">{AGENT_INFO[cli].product}</span>
              <span className="agent-card__state">{r.text}</span>
            </button>
          )
        })}
        {shell && (
          <button type="button" role="radio" aria-checked={value === 'shell'} className="agent-card" onClick={() => onChange('shell')}>
            <strong>Terminal</strong>
            <span className="agent-card__product">Seu shell, sem agente</span>
            <span className="agent-card__state">sempre disponível</span>
          </button>
        )}
      </div>
      {current && !current.ready && value !== 'shell' && <p className="note note--warn">{AGENT_INFO[value].label}: {current.text}. {current.text === 'não instalado' ? 'Veja como instalar em Ajustes › Agentes e CLIs.' : 'Entre em Ajustes › Contas.'}</p>}
    </>
  )
}

/** Compact agent choice for tables (task table, squad roles). */
export function CliSelect({ id, value, onChange, label, disabled }: { id: string; value: AgentCliForRole; onChange: (cli: AgentCliForRole) => void; label: string; disabled?: boolean }) {
  const readiness = useAgentReadiness()
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} className="cli-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as AgentCliForRole)}>
        {AGENT_CLIS.map((cli) => {
          const r = readiness(cli)
          return <option key={cli} value={cli}>{AGENT_INFO[cli].label}{r.ready ? '' : ` (${r.text})`}</option>
        })}
      </select>
    </>
  )
}

const CUSTOM = '__outro__'

/**
 * The model, from the chosen CLI's own list (read from the CLI when it can tell, else Orbit's):
 * its default first, then each model with its name, and "outro modelo" for any id. `compact`
 * leaves out the description line (tables).
 */
export function ModelSelect({ id, cli, value, onChange, label, disabled, compact = false, className }: {
  id: string
  cli: AgentCli
  value: string | null
  onChange: (model: string | null) => void
  label?: string
  disabled?: boolean
  compact?: boolean
  className?: string
}) {
  const { catalog } = useOrbit()
  const models = modelOptions(catalog, cli)
  const known = value === null || models.some((m) => m.id === value)
  const [typing, setTyping] = useState(!known)
  useEffect(() => {
    if (!known) setTyping(true)
  }, [known])
  if (cli === 'shell') return null
  const info = catalog?.[cli].models.find((m) => m.id === value)
  const fallback = catalog?.[cli].models.find((m) => m.id === catalog[cli].defaultModel)
  const source = catalog?.[cli].source === 'cli' ? `lista lida do ${CLI_NAME[cli]} instalado` : 'lista do Orbit'
  return (
    <div className={`model-select${className ? ` ${className}` : ''}`}>
      {label && <label className="sr-only" htmlFor={id}>{label}</label>}
      <select id={id} value={typing ? CUSTOM : value ?? ''} disabled={disabled}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return setTyping(true)
          setTyping(false)
          onChange(e.target.value || null)
        }}>
        <option value="">Padrão do {CLI_NAME[cli]}{fallback ? ` (${fallback.label})` : ''}</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.label === m.id ? m.id : `${m.label} · ${m.id}`}</option>)}
        <option value={CUSTOM}>Outro modelo…</option>
      </select>
      {typing && (
        <input aria-label={`${label ?? 'Modelo'}: id do modelo`} value={value ?? ''} disabled={disabled} spellCheck={false} autoFocus={!compact}
          placeholder={cli === 'gemini' ? 'gemini-3.1-pro-preview' : cli === 'codex' ? 'gpt-…' : 'id do modelo'} onChange={(e) => onChange(e.target.value.trim() || null)} />
      )}
      {compact && value === null && <p className="note">Padrão da CLI: {fallback?.id ?? 'modelo não confirmado'} · esforço {catalog?.[cli].defaultEffort ? EFFORT_LABEL[catalog[cli].defaultEffort!] : fallback?.defaultEffort ? EFFORT_LABEL[fallback.defaultEffort] : 'não confirmado'}. A conta pode ter configuração própria.</p>}
      {!compact && (
        <p className="note model-select__note">
          {typing ? 'Qualquer id que a CLI aceite.' : value === null ? `O que o ${CLI_NAME[cli]} usa quando ninguém escolhe.` : info?.description || info?.label || value}
          {' '}<span className="muted">({models.length ? `${models.length} modelos, ${source}` : 'a CLI não informou a lista; escolha o padrão ou digite um id'})</span>
        </p>
      )}
    </div>
  )
}

/** The levels this CLI and model accept, and the model's own default when the catalog knows it. */
export function useEfforts(cli: AgentCli, model: string | null): { allowed: readonly Effort[]; modelDefault: Effort | null } {
  const { catalog } = useOrbit()
  const allowed = effortsFor(catalog, cli, model)
  const modelDefault = cli === 'shell' || !catalog ? null : (model === null ? catalog[cli].defaultEffort : null) ?? catalog[cli].models.find((m) => m.id === (model ?? catalog[cli].defaultModel))?.defaultEffort ?? null
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
  if (allowed.length === 0) return cli === 'shell' ? null : <p className="note">O {CLI_NAME[cli]} não tem nível de esforço: o modelo decide sozinho quanto pensar.</p>
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
  if (allowed.length === 0) return <span className="effort effort--none" title={`O ${CLI_NAME[cli]} não tem nível de esforço`}>—</span>
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
