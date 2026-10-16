import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AGENT_CLIS, ACCOUNT_LIMITS, MODEL_ID, type Account, type AccountKind, type AccountLimits, type AccountStatus, type AgentCliForRole } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { accountLabel, CLI_LABEL } from '../orbit/labels.ts'
import { untilTime } from '../orbit/time.ts'
import { PlusIcon } from './icons.tsx'
import { Terminal } from './LazyTerminal.tsx'
import { limitWindowView, limitReadLabel } from '../orbit/limitPresentation.ts'
import { useLimitClock } from '../orbit/useLimitClock.ts'

/** CLIs that take extra accounts; Antigravity runs only as this Mac's own login. */
const CLIS: AgentCliForRole[] = ['claude', 'codex', 'gemini']
const SUBSCRIPTION: Record<string, string> = { claude: 'Assinatura Claude', codex: 'Conta ChatGPT', gemini: 'Conta Google' }
const LOGIN_HINT: Record<AgentCliForRole, string> = {
  claude: 'O Claude Code abre o navegador para você entrar; se pedir, cole o código aqui no terminal.',
  codex: 'O Codex abre o navegador para você entrar com a conta do ChatGPT.',
  gemini: 'O Gemini CLI pergunta como entrar: escolha "Login with Google" e conclua no navegador. Depois feche com /quit.',
  antigravity: 'O Antigravity CLI abre o login da conta Google; conclua no navegador e depois feche o terminal.',
}

/** Anthropic-compatible endpoints for Claude API accounts. */
const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', url: '', modelHint: 'padrão do Claude Code' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api', modelHint: 'anthropic/claude-sonnet-5.5' },
  { id: 'outro', label: 'Outro', url: null, modelHint: 'id do modelo no provedor' },
] as const
type ProviderId = (typeof PROVIDERS)[number]['id']

interface Draft {
  id?: string
  cli: AgentCliForRole
  kind: AccountKind
  name: string
  provider: ProviderId
  baseUrl: string
  model: string
  key: string
  auto: boolean
}

const blankDraft = (cli: AgentCliForRole = 'claude'): Draft => ({ cli, kind: 'assinatura', name: '', provider: 'anthropic', baseUrl: '', model: '', key: '', auto: true })

function draftOf(account: Account): Draft {
  const provider = !account.baseUrl ? 'anthropic' : PROVIDERS.find((p) => p.url === account.baseUrl)?.id ?? 'outro'
  return { id: account.id, cli: account.cli, kind: account.kind, name: account.name, provider, baseUrl: account.baseUrl ?? '', model: account.model ?? '', key: '', auto: account.auto }
}

function statusText(account: Account, status: AccountStatus | undefined): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (status?.busy === 'login') return { text: 'entrando…', tone: 'muted' }
  if (status?.busy === 'checking') return { text: 'verificando…', tone: 'muted' }
  if (!status || status.loggedIn === null) return { text: status?.message ? 'não deu para verificar' : 'ainda não verificada', tone: 'muted' }
  if (!status.loggedIn) return { text: account.kind === 'api' ? 'sem chave' : 'não logada', tone: 'warn' }
  const who = [status.email, status.plan].filter(Boolean).join(' · ')
  if (account.kind === 'api') return { text: [status.method, account.keyHint].filter(Boolean).join(' '), tone: 'ok' }
  return { text: who ? `logada · ${who}` : `logada${status.method ? ` (${status.method})` : ''}`, tone: 'ok' }
}

function LimitsLine({ limits, now }: { limits: AccountLimits | undefined; now: number }) {
  if (!limits) return <span className="muted">limites ainda não consultados</span>
  const parts = ([['5 h', limits.fiveHour], ['semana', limits.weekly]] as const).flatMap(([label, w]) => {
    if (!w) return []
    const view = limitWindowView(w, limits, now)
    return [view.percent === null ? `${label}: aguardando atualização` : `${view.label}: ${view.percent}% ${view.metric} (renova ${untilTime(w.resetsAt, now)})`]
  })
  return <span className="muted" title={limitReadLabel(limits, now)}>{parts.join(' · ') || 'sem leitura atual'} · {limitReadLabel(limits, now)}</span>
}

function AccountCard({ account, status, limits, liveAgents, onEdit, now }: { account: Account; status: AccountStatus | undefined; limits: AccountLimits | undefined; liveAgents: number; onEdit: () => void; now: number }) {
  const client = useOrbitClient()
  const state = statusText(account, status)
  const loginPane = status?.loginPaneId ?? null
  const remove = () => {
    const extra = liveAgents ? ` ${liveAgents} ${liveAgents === 1 ? 'agente aberto continua' : 'agentes abertos continuam'} rodando até fechar.` : ''
    if (confirm(`Remover a conta ${account.name}? O Orbit sai da conta e apaga a pasta dela (o login e a chave).${extra}`)) client.send({ type: 'account.delete', accountId: account.id })
  }
  return (
    <article className="account" aria-labelledby={`account-${account.id}`}>
      <div className="account__head">
        <span className={`dot ${state.tone === 'ok' ? 'dot--live' : state.tone === 'warn' ? 'dot--wait' : 'dot--off'}`} />
        <h4 id={`account-${account.id}`}>{accountLabel(account, account.cli)}</h4>
        <span className="chip">{account.builtin ? 'deste Mac' : account.kind === 'api' ? 'chave de API' : 'assinatura'}</span>
        {account.model && <span className="chip">{account.model}</span>}
        <span className="spacer" />
        {account.kind === 'assinatura' && (
          <button className="btn btn--ghost btn--sm" disabled={status?.busy === 'login'} onClick={() => client.send({ type: 'account.login', accountId: account.id })}>
            {status?.loggedIn ? 'Entrar de novo' : 'Entrar'}
          </button>
        )}
        {!account.builtin && <button className="btn btn--ghost btn--sm" onClick={onEdit}>Editar</button>}
        {!account.builtin && <button className="btn btn--ghost btn--sm btn--danger" onClick={remove}>Remover</button>}
      </div>
      <div className="account__facts">
        <span className={`account__state account__state--${state.tone}`}>{state.text}</span>
        <LimitsLine limits={limits} now={now} />
      </div>
      <label className="check">
        <input type="checkbox" checked={account.auto} onChange={(e) => client.send({ type: 'account.save', account: { id: account.id, cli: account.cli, kind: account.kind, name: account.name, baseUrl: account.baseUrl, model: account.model, auto: e.target.checked } })} />
        <span>O Orbit pode escolher esta conta sozinho{account.kind === 'api' ? ' (só quando as assinaturas estiverem no limite)' : ''}</span>
      </label>
      {status?.message && !loginPane && <pre className="cli-card__message cli-card__message--error">{status.message}</pre>}
      {loginPane !== null && (
        <div className="account__login">
          <p className="note">
            {LOGIN_HINT[account.cli]}
          </p>
          <div className="account__terminal"><Terminal paneId={loginPane} interactive /></div>
          <div className="account__login-actions">
            <button className="btn btn--ghost btn--sm" onClick={() => client.send({ type: 'account.check' })}>Verificar login</button>
            <button className="btn btn--ghost btn--sm" onClick={() => client.send({ type: 'pane.close', paneId: loginPane })}>Fechar terminal</button>
          </div>
        </div>
      )}
    </article>
  )
}

function AccountForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const client = useOrbitClient()
  const uid = useId()
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const editing = Boolean(initial.id)
  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }))
  const provider = PROVIDERS.find((p) => p.id === draft.provider)!
  const claudeApi = draft.cli === 'claude' && draft.kind === 'api'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name) return setError('Dê um nome à conta (por exemplo, "Trabalho").')
    const baseUrl = claudeApi ? (provider.url ?? draft.baseUrl.trim()) || null : null
    if (claudeApi && draft.provider === 'outro' && !baseUrl) return setError('Informe o endereço do provedor.')
    const model = claudeApi ? draft.model.trim() || null : null
    if (model && !MODEL_ID.test(model)) return setError('Modelo inválido: use só letras, números, ponto, hífen, barra ou dois-pontos.')
    if (draft.kind === 'api' && !editing && !draft.key.trim()) return setError('Cole a chave de API.')
    client.send({ type: 'account.save', account: { id: draft.id, cli: draft.cli, kind: draft.kind, name, baseUrl, model, auto: draft.auto, ...(draft.key.trim() ? { key: draft.key.trim() } : {}) } })
    onDone()
  }

  return (
    <form className="account account--form" onSubmit={submit} aria-labelledby={`${uid}-title`}>
      <h4 id={`${uid}-title`}>{editing ? `Editar ${initial.name}` : 'Nova conta'}</h4>
      {!editing && (
        <div className="account-form__row">
          <fieldset className="field">
            <legend>CLI</legend>
            <div className="segmented">
              {CLIS.map((cli) => <button key={cli} type="button" aria-pressed={draft.cli === cli} onClick={() => patch({ cli })}>{CLI_LABEL[cli]}</button>)}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Tipo</legend>
            <div className="segmented">
              <button type="button" aria-pressed={draft.kind === 'assinatura'} onClick={() => patch({ kind: 'assinatura', auto: true })}>{SUBSCRIPTION[draft.cli]}</button>
              <button type="button" aria-pressed={draft.kind === 'api'} onClick={() => patch({ kind: 'api', auto: false })}>Chave de API</button>
            </div>
          </fieldset>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${uid}-name`}>Nome</label>
        <input id={`${uid}-name`} value={draft.name} maxLength={ACCOUNT_LIMITS.name} onChange={(e) => patch({ name: e.target.value })} placeholder={draft.kind === 'api' ? 'OpenRouter' : 'Trabalho'} autoFocus />
      </div>
      {claudeApi && (
        <>
          <fieldset className="field">
            <legend>Provedor</legend>
            <div className="segmented">
              {PROVIDERS.map((p) => <button key={p.id} type="button" aria-pressed={draft.provider === p.id} onClick={() => patch({ provider: p.id })}>{p.label}</button>)}
            </div>
          </fieldset>
          {draft.provider === 'outro' && (
            <div className="field">
              <label htmlFor={`${uid}-url`}>Endereço <span className="muted">(compatível com a API da Anthropic)</span></label>
              <input id={`${uid}-url`} value={draft.baseUrl} maxLength={ACCOUNT_LIMITS.url} spellCheck={false} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="https://meu-proxy.exemplo.com" />
            </div>
          )}
          <div className="field">
            <label htmlFor={`${uid}-model`}>Modelo <span className="muted">(opcional; vale também para opus, sonnet e haiku)</span></label>
            <input id={`${uid}-model`} value={draft.model} spellCheck={false} onChange={(e) => patch({ model: e.target.value })} placeholder={provider.modelHint} />
          </div>
        </>
      )}
      {draft.kind === 'api' && (
        <div className="field">
          <label htmlFor={`${uid}-key`}>Chave de API {editing && <span className="muted">(vazio mantém a atual)</span>}</label>
          <input id={`${uid}-key`} type="password" autoComplete="off" spellCheck={false} maxLength={ACCOUNT_LIMITS.key} value={draft.key} onChange={(e) => patch({ key: e.target.value })} placeholder={draft.cli === 'claude' ? (draft.provider === 'openrouter' ? 'sk-or-…' : 'sk-ant-…') : draft.cli === 'gemini' ? 'AIza… (Google AI Studio)' : 'sk-…'} />
          <p className="note">Fica só no seu Mac, num arquivo que só você lê. Os agentes recebem a chave pela CLI; ela não volta para a tela.</p>
        </div>
      )}
      {draft.kind === 'assinatura' && !editing && <p className="note">Depois de adicionar, clique em Entrar no cartão da nova conta para concluir o login no navegador. As outras contas continuam conectadas.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="account-form__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>Cancelar</button>
        <button type="submit" className="btn btn--primary btn--sm">{editing ? 'Salvar' : 'Adicionar conta'}</button>
      </div>
    </form>
  )
}

/** Settings › Contas: the logins and API keys agents run as, and how much room each one has. */
export function AccountsPanel() {
  const client = useOrbitClient()
  const { accounts, accountStatuses, limits, panes } = useOrbit()
  const [form, setForm] = useState<Draft | null>(null)
  const asked = useRef(false)
  const canAdd = accounts.length < ACCOUNT_LIMITS.accounts
  const now = useLimitClock()

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    client.send({ type: 'account.check' })
  }, [client])

  return (
    <div className="dialog__body clis">
      <div className="clis__bar">
        <p className="muted">
          Mantenha várias contas conectadas e escolha qual cada agente usa. Para conectar outra assinatura, use Adicionar conta na seção do provedor. A escolha automática prioriza as assinaturas com mais limite disponível; chaves de API só participam se você permitir.
        </p>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => client.send({ type: 'limits.refresh' })}>Atualizar limites</button>
        {!form && canAdd && <button className="btn btn--ghost btn--sm" onClick={() => setForm(blankDraft())}><PlusIcon size={14} />Nova conta</button>}
      </div>
      {form && !form.id && <AccountForm initial={form} onDone={() => setForm(null)} />}
      {AGENT_CLIS.map((cli) => (
        <section key={cli} className="accounts__group" aria-labelledby={`accounts-${cli}`}>
          <div className="accounts__group-head">
            <h3 id={`accounts-${cli}`} className="eyebrow">{CLI_LABEL[cli]}</h3>
            {CLIS.includes(cli) && canAdd && <button type="button" className="btn btn--ghost btn--sm" disabled={form !== null} onClick={() => setForm(blankDraft(cli))}><PlusIcon size={14} />Adicionar conta {CLI_LABEL[cli]}</button>}
          </div>
          {accounts.filter((a) => a.cli === cli).map((account) =>
            form?.id === account.id ? (
              <AccountForm key={account.id} initial={form} onDone={() => setForm(null)} />
            ) : (
              <AccountCard
                key={account.id}
                account={account}
                now={now}
                status={accountStatuses.find((s) => s.accountId === account.id)}
                limits={limits.find((l) => l.accountId === account.id)}
                liveAgents={panes.filter((p) => p.accountId === account.id && p.status !== 'exited').length}
                onEdit={() => setForm(draftOf(account))}
              />
            ),
          )}
        </section>
      ))}
    </div>
  )
}
