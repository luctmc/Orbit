import { useState } from 'react'
import { SCHEDULE_LIMITS, type Mission, type Schedule, type ScheduleWhen } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { relativeTime, untilTime } from '../orbit/time.ts'
import { Dialog } from './Dialog.tsx'
import { PlusIcon } from './icons.tsx'

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export function whenText(when: ScheduleWhen): string {
  if (when.kind === 'once') return `uma vez, ${new Date(when.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
  if (when.kind === 'interval') return `a cada ${when.hours} h`
  const days = when.days.length === 0 || when.days.length === 7 ? 'todo dia' : when.days.length === 5 && [1, 2, 3, 4, 5].every((d) => when.days.includes(d)) ? 'dias úteis' : when.days.map((d) => DAYS[d]).join(', ')
  return `${days} às ${when.time}`
}

/** Base › Agendadas: the templates Orbit starts by itself while it is open. */
export function SchedulesSection({ onOpenMission }: { onOpenMission: (mission: Mission) => void }) {
  const client = useOrbitClient()
  const { schedules, templates, workspaces, missions } = useOrbit()
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null)
  const sorted = [...schedules].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))

  return (
    <section aria-labelledby="home-schedules" className="home__section">
      <div className="home__section-head">
        <h2 id="home-schedules" className="eyebrow">Agendadas</h2>
        <button className="btn btn--ghost btn--sm" onClick={() => setEditing('new')}><PlusIcon size={14} />Agendar missão</button>
      </div>
      {sorted.length === 0 ? (
        <p className="muted home__empty">
          {templates.length === 0 ? 'Salve uma missão como modelo e agende-a para rodar sozinha num horário ou de tempos em tempos.' : 'Nada agendado. Um modelo pode rodar sozinho num horário ou de tempos em tempos, enquanto o Orbit estiver aberto.'}
        </p>
      ) : (
        <ul className="plain-list schedules">
          {sorted.map((s) => {
            const template = templates.find((t) => t.id === s.templateId)
            const workspace = workspaces.find((w) => w.id === s.workspaceId)
            const last = missions.find((m) => m.id === s.lastMissionId)
            return (
              <li key={s.id} className={`schedule${s.enabled ? '' : ' schedule--off'}`}>
                <div className="schedule__main">
                  <strong>{s.name}</strong>
                  <span className="muted">{whenText(s.when)} · {template ? template.name : 'modelo apagado'} · {workspace?.name ?? 'workspace removido'}</span>
                  <span className="schedule__next">
                    {s.enabled && s.nextRunAt ? `próxima ${untilTime(s.nextRunAt)}` : s.enabled ? 'sem próxima' : 'pausada'}
                    {s.lastRunAt && <span className="muted"> · última {relativeTime(s.lastRunAt)}: {s.lastResult}</span>}
                    {last && <> · <button type="button" className="link-btn" onClick={() => onOpenMission(last)}>abrir missão</button></>}
                  </span>
                </div>
                <div className="schedule__actions">
                  <label className="switch" title={s.enabled ? 'Pausar' : 'Ativar'}>
                    <input type="checkbox" role="switch" checked={s.enabled} aria-label={`${s.name} ativa`}
                      onChange={(e) => client.send({ type: 'schedule.save', schedule: { ...s, enabled: e.target.checked, when: s.when.kind === 'once' && s.when.at <= Date.now() ? { kind: 'once', at: Date.now() + 60_000 } : s.when } })} />
                    <span className="switch__track" aria-hidden="true" />
                  </label>
                  <button className="btn btn--ghost btn--sm" disabled={!template} onClick={() => client.send({ type: 'schedule.run', scheduleId: s.id })}>Rodar agora</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditing(s)}>Editar</button>
                  <button className="btn btn--ghost btn--sm btn--danger" onClick={() => { if (confirm(`Apagar o agendamento "${s.name}"?`)) client.send({ type: 'schedule.delete', scheduleId: s.id }) }}>Apagar</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editing && <ScheduleDialog schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

/** "2026-10-14T09:00" for <input type="datetime-local">, in local time. */
function localInput(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ScheduleDialog({ schedule, onClose }: { schedule: Schedule | null; onClose: () => void }) {
  const client = useOrbitClient()
  const { templates, workspaces, accounts, settings } = useOrbit()
  const [templateId, setTemplateId] = useState(schedule?.templateId ?? templates[0]?.id ?? '')
  const template = templates.find((t) => t.id === templateId)
  const [workspaceId, setWorkspaceId] = useState(schedule?.workspaceId ?? template?.workspaceId ?? workspaces[0]?.id ?? '')
  const [name, setName] = useState(schedule?.name ?? '')
  const [kind, setKind] = useState<ScheduleWhen['kind']>(schedule?.when.kind ?? 'daily')
  const [time, setTime] = useState(schedule?.when.kind === 'daily' ? schedule.when.time : '09:00')
  const [days, setDays] = useState<number[]>(schedule?.when.kind === 'daily' ? schedule.when.days : [1, 2, 3, 4, 5])
  const [hours, setHours] = useState(schedule?.when.kind === 'interval' ? schedule.when.hours : 6)
  const [at, setAt] = useState(localInput(schedule?.when.kind === 'once' ? schedule.when.at : Date.now() + 3_600_000))
  const [translationAccountId, setTranslationAccountId] = useState(schedule?.translationAccountId ?? '')
  const [allowOriginal, setAllowOriginal] = useState(schedule?.allowOriginal ?? false)
  const [skipIfRunning, setSkip] = useState(schedule?.skipIfRunning ?? true)
  const [error, setError] = useState<string | null>(null)

  const when = (): ScheduleWhen => kind === 'once' ? { kind, at: new Date(at).getTime() } : kind === 'interval' ? { kind, hours } : { kind, time, days }

  if (templates.length === 0) {
    return (
      <Dialog eyebrow="Agenda" title="Agendar missão" submitLabel="Ok" onClose={onClose} onSubmit={onClose}>
        <p className="muted">Primeiro salve uma missão como modelo (botão de marcador no cabeçalho da missão). Os agendamentos rodam modelos.</p>
      </Dialog>
    )
  }

  return (
    <Dialog eyebrow="Agenda" title={schedule ? 'Editar agendamento' : 'Agendar missão'} submitLabel="Salvar" onClose={onClose} onSubmit={() => {
      if (!templateId) return setError('Escolha o modelo.')
      if (settings?.agentsInEnglish && template?.lead.cli !== 'shell' && template?.objective.trim() && !allowOriginal && !translationAccountId) return setError('Escolha uma conta Codex para traduzir o objetivo a cada execução.')
      client.send({ type: 'schedule.save', schedule: { translationAccountId: translationAccountId || undefined, allowOriginal, id: schedule?.id, name: name.trim() || template?.name || 'Agendamento', templateId, workspaceId, when: when(), enabled: schedule?.enabled ?? true, skipIfRunning } })
      onClose()
    }}>
      <div className="field">
        <label htmlFor="sch-template">Modelo</label>
        <select id="sch-template" value={templateId} onChange={(e) => {
          setTemplateId(e.target.value)
          const t = templates.find((x) => x.id === e.target.value)
          if (t?.workspaceId) setWorkspaceId(t.workspaceId)
        }}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {template && <p className="note">{template.title}{template.objective ? `: ${template.objective.slice(0, 160)}` : ''}</p>}
      </div>
      <div className="field">
        <label htmlFor="sch-ws">Workspace</label>
        <select id="sch-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
          {workspaces.filter((w) => !template?.workspaceId || w.id === template.workspaceId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {settings?.agentsInEnglish && template?.lead.cli !== 'shell' && <div className="field">
        <label htmlFor="sch-translator">Traduzir objetivo em cada execução · Codex / gpt-6.1-sol / medium</label>
        <select id="sch-translator" value={translationAccountId} disabled={allowOriginal} onChange={e => setTranslationAccountId(e.target.value)}>
          <option value="">Escolha a conta Codex</option>
          {accounts.filter(a => a.cli === 'codex' && a.kind === 'assinatura').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label><input type="checkbox" checked={allowOriginal} onChange={e => setAllowOriginal(e.target.checked)} /> Autorizar objetivo original sem tradução</label>
        <p className="note">Sem login ou tradução confirmada, a missão não inicia. Resultado incerto pausa o agendamento para conferência.</p>
      </div>}
      <div className="field">
        <label htmlFor="sch-name">Nome <span className="muted">(opcional)</span></label>
        <input id="sch-name" value={name} maxLength={SCHEDULE_LIMITS.name} placeholder={template?.name ?? 'Toda segunda de manhã'} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset className="field">
        <legend>Quando</legend>
        <div className="segmented">
          <button type="button" aria-pressed={kind === 'daily'} onClick={() => setKind('daily')}>Em dias e horário</button>
          <button type="button" aria-pressed={kind === 'interval'} onClick={() => setKind('interval')}>A cada N horas</button>
          <button type="button" aria-pressed={kind === 'once'} onClick={() => setKind('once')}>Uma vez</button>
        </div>
        {kind === 'daily' && (
          <div className="schedule-when">
            <label className="sr-only" htmlFor="sch-time">Hora</label>
            <input id="sch-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <div className="segmented segmented--wrap" role="group" aria-label="Dias da semana">
              {DAYS.map((label, d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort()))}>{label}</button>
              ))}
            </div>
            <span className="muted">{days.length === 0 ? 'Nenhum dia marcado: roda todo dia.' : ''}</span>
          </div>
        )}
        {kind === 'interval' && (
          <div className="schedule-when">
            <label htmlFor="sch-hours">A cada</label>
            <input id="sch-hours" type="number" min={1} max={SCHEDULE_LIMITS.maxHours} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
            <span>horas, a partir de agora</span>
          </div>
        )}
        {kind === 'once' && (
          <div className="schedule-when">
            <label className="sr-only" htmlFor="sch-at">Data e hora</label>
            <input id="sch-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={skipIfRunning} onChange={(e) => setSkip(e.target.checked)} />
        <span>Pular se a missão anterior deste agendamento ainda tiver agentes trabalhando</span>
      </label>
      <p className="note">Roda enquanto o Orbit estiver aberto. Se ele estava fechado na hora, a missão começa assim que abrir (uma vez só). O líder trabalha sozinho; os avisos mostram quando alguém precisar de você.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}
