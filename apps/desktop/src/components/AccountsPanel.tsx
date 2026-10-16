import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AGENT_CLIS, AGENT_INFO, ACCOUNT_LIMITS, MODEL_ID, type Account, type AccountKind, type AccountLimits, type AccountStatus, type AgentCliForRole } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { accountLabel, CLI_LABEL, modelOptions } from '../orbit/labels.ts'
import { untilTime } from '../orbit/time.ts'
import { QuotaAccess } from './QuotaAccess.tsx'
import { PlusIcon, OrbitMark } from './icons.tsx'
import { ProviderMark } from './ProviderMark.tsx'
import './AccountsPanel.css'
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
  const { connection } = useOrbit()
  const offline = connection !== 'open'
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
        <span className="chip">{liveAgents} {liveAgents === 1 ? 'janela aberta' : 'janelas abertas'}</span>
        {account.kind === 'assinatura' && (
          <button className="btn btn--ghost btn--sm" disabled={offline || !!status?.busy} onClick={() => client.send({ type: 'account.login', accountId: account.id })}>
            {status?.busy === 'login' ? 'Entrando…' : status?.loggedIn ? 'Entrar de novo' : 'Entrar'}
          </button>
        )}
        {!account.builtin && <button className="btn btn--ghost btn--sm" onClick={onEdit}>Editar</button>}
        {!account.builtin && <button className="btn btn--ghost btn--sm btn--danger" disabled={offline} onClick={remove}>Remover</button>}
      </div>
      <div className="account__facts">
        <span className={`account__state account__state--${state.tone}`}>{state.text}</span>
        <LimitsLine limits={limits} now={now} />
      </div>
      <QuotaAccess account={account} limits={limits} status={status} />
      <label className="check">
        <input type="checkbox" checked={account.auto} disabled={offline} onChange={(e) => client.send({ type: 'account.save', account: { id: account.id, cli: account.cli, kind: account.kind, name: account.name, baseUrl: account.baseUrl, model: account.model, auto: e.target.checked } })} />
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
            <button className="btn btn--ghost btn--sm" disabled={offline || !!status?.busy} onClick={() => client.send({ type: 'account.check' })}>Verificar login</button>
            <button className="btn btn--ghost btn--sm" disabled={offline} onClick={() => client.send({ type: 'pane.close', paneId: loginPane })}>Fechar terminal</button>
          </div>
        </div>
      )}
    </article>
  )
}

function AccountForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const client = useOrbitClient()
  const uid = useId()
  const { connection } = useOrbit()
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const editing = Boolean(initial.id)
  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }))
  const provider = PROVIDERS.find((p) => p.id === draft.provider)!
  const claudeApi = draft.cli === 'claude' && draft.kind === 'api'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (connection !== 'open') return setError('Aguarde a conexão com o Orbit para salvar esta conta.')
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
        <button type="submit" className="btn btn--primary btn--sm" disabled={connection !== 'open'}>{editing ? 'Salvar' : 'Adicionar conta'}</button>
      </div>
    </form>
  )
}

/** Small, truthful overview: missing/stale readings never look like available quota. */
function AccountMeter({ account, limits, now }: { account: Account; limits?: AccountLimits; now: number }) {
  return <div className="ias-meter" aria-label={`Limites de ${accountLabel(account, account.cli)}`}>
    <span className="ias-meter__name">{accountLabel(account, account.cli)}</span>
    {([['5 h', limits?.fiveHour], ['Semana', limits?.weekly]] as const).map(([name, window]) => {
      const view = window && limits ? limitWindowView(window, limits, now) : null
      const percent = view?.percent ?? null
      return <div className="ias-meter__row" key={name}>
        <span>{view?.label ?? name}</span>
        <span className="ias-meter__track" aria-hidden="true">{percent !== null && <span style={{ width: `${percent}%` }} />}</span>
        <span title={limits ? limitReadLabel(limits, now) : undefined}>{percent === null ? 'Sem leitura atual' : `${Math.round(percent)}% ${view!.metric}`}</span>
        {window && <small className="ias-meter__renewal">{window.resetsAt <= now ? 'Aguardando nova leitura' : `Renova ${untilTime(window.resetsAt, now)}`}</small>}
      </div>
    })}
    {limits?.refreshError && <p className="ias-meter__notice">Falha na atualização. Confira o painel oficial ou tente novamente.</p>}
  </div>
}

function AgentMark({ cli }: { cli: AgentCliForRole }) {
  // Reuse the bundled official marks. Google CLIs retain a named neutral fallback.
  return cli === 'codex' || cli === 'claude' ? <ProviderMark brand={cli === 'codex' ? 'openai' : 'anthropic'} /> : <span className="ias-mark" aria-hidden="true"><OrbitMark size={24} /></span>
}

/** Settings › IAs: provider overview, independent accounts, and real quota actions. */
export function AccountsPanel() {
  const client = useOrbitClient()
  const { accounts, accountStatuses, limits, panes, catalog, clis, connection, lastError } = useOrbit()
  const [form, setForm] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<AgentCliForRole>('codex')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null)
  const refreshBaseline = useRef<{ limits: typeof limits; statuses: typeof accountStatuses; clis: typeof clis } | null>(null)
  const asked = useRef(false)
  const details = useRef<HTMLElement>(null)
  const canAdd = accounts.length < ACCOUNT_LIMITS.accounts
  const now = useLimitClock()
  const connected = accounts.filter(a => accountStatuses.some(s => s.accountId === a.id && s.loggedIn === true))
  const subscriptions = connected.filter(a => a.kind === 'assinatura').length
  const unverified = accounts.filter(a => { const status = accountStatuses.find(s => s.accountId === a.id); return !status || status.loggedIn === null }).length
  const selectedAccounts = accounts.filter(a => a.cli === selected)

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    client.send({ type: 'account.check' })
  }, [client])
  useEffect(() => {
    const before = refreshBaseline.current
    if (!before || !refreshing) return
    // Initial busy/status broadcasts must not unlock the button before limits arrive.
    if (limits !== before.limits && accountStatuses !== before.statuses && clis !== before.clis && !accountStatuses.some(s => s.busy) && !clis.some(c => c.busy)) {
      refreshBaseline.current = null
      setRefreshing(false)
      setRefreshNotice('Consulta concluída. Leituras indisponíveis ou antigas continuam sinalizadas em cada conta.')
    }
  }, [limits, accountStatuses, clis, refreshing])
  useEffect(() => {
    if (!refreshing) return
    const timer = setTimeout(() => {
      refreshBaseline.current = null
      setRefreshing(false)
      setRefreshNotice('A consulta ainda não confirmou todos os dados. Você pode tentar novamente; confira a última leitura de cada conta.')
    }, 12000)
    return () => clearTimeout(timer)
  }, [refreshing])
  const refresh = () => {
    refreshBaseline.current = { limits, statuses: accountStatuses, clis }
    setRefreshNotice(null)
    setRefreshing(true)
    client.send({ type: 'account.check' })
    client.send({ type: 'limits.refresh' })
    client.send({ type: 'cli.check' })
  }
  const select = (cli: AgentCliForRole) => { setSelected(cli); setForm(null) }
  const add = (cli: AgentCliForRole, kind: AccountKind = 'assinatura') => {
    setSelected(cli); setForm({ ...blankDraft(cli), kind, auto: kind === 'assinatura' })
    requestAnimationFrame(() => details.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }))
  }

  return (
    <div className="dialog__body ias">
      <header className="ias-intro"><span className="eyebrow">IAs / contas</span><h2>Suas IAs</h2><p>As IAs que trabalham com você. Conecte suas assinaturas e mantenha cada conta com seu próprio login e limite.</p></header>
      <section className="ias-arsenal" aria-label="Resumo das conexões">
        <div><span className="eyebrow">Seu arsenal</span><h3>{connected.length === 0 && unverified > 0 ? `${accounts.length} ${accounts.length === 1 ? 'conta configurada' : 'contas configuradas'}` : `${connected.length} ${connected.length === 1 ? 'conta conectada' : 'contas conectadas'}`}</h3><p>{subscriptions} assinaturas conectadas · {connected.length - subscriptions} chaves de API · {panes.filter(p => p.status !== 'exited').length} janelas abertas{unverified > 0 && ` · ${unverified} ${unverified === 1 ? 'login a verificar' : 'logins a verificar'}`}</p></div>
        <div className="ias-arsenal__marks" aria-label="Provedores conectados">{AGENT_CLIS.filter(cli => connected.some(a => a.cli === cli)).map(cli => <span key={cli} title={CLI_LABEL[cli]}><AgentMark cli={cli} /><span className="sr-only">{CLI_LABEL[cli]}</span></span>)}</div>
        <p className="ias-arsenal__foot">Contas independentes. A seleção automática usa apenas as contas que você permitir.</p>
      </section>
      <div className="ias-toolbar"><div><h3>Assinaturas que você já paga</h3><p>Selecione uma IA para gerenciar contas, login e resets.</p></div><button type="button" className="btn btn--ghost btn--sm" disabled={refreshing || connection !== 'open'} onClick={refresh} aria-busy={refreshing}>{refreshing && <span className="ias-spinner" aria-hidden="true" />}{refreshing ? 'Atualizando…' : 'Atualizar limites e status'}</button></div>
      {refreshNotice && <p className="ias-refresh-status" role="status">{refreshNotice}</p>}
      {connection !== 'open' && <p role="status" className="ias-notice">Conectando ao Orbit. Os dados serão confirmados quando a conexão voltar.</p>}
      {lastError && <p className="form-error" role="alert">{lastError}</p>}
      <div className="ias-grid" aria-label="Provedores de IA">
        {AGENT_CLIS.map(cli => {
          const mine = accounts.filter(a => a.cli === cli && a.kind === 'assinatura')
          const installed = clis.find(c => c.cli === cli)
          const signed = mine.filter(a => connected.includes(a)).length
          const models = modelOptions(catalog, cli)
          return <article key={cli} className={`ias-provider${selected === cli ? ' ias-provider--selected' : ''}`}>
            <div className="ias-provider__head"><AgentMark cli={cli} /><div><h3>{AGENT_INFO[cli].label}</h3><p>{AGENT_INFO[cli].product} · {mine.length} {mine.length === 1 ? 'conta' : 'contas'}</p></div></div>
            <p className="ias-provider__status"><span className={`dot ${signed ? 'dot--live' : 'dot--off'}`} />{installed?.busy ? 'Verificando CLI…' : installed?.checkedAt == null ? 'Instalação a confirmar' : !installed.installed ? 'Não instalada neste Mac' : signed ? `${signed} ${signed === 1 ? 'conta conectada' : 'contas conectadas'}` : 'Login a confirmar'}</p>
            <div className="ias-provider__meters">{mine.length ? mine.map(account => <AccountMeter key={account.id} account={account} limits={limits.find(l => l.accountId === account.id)} now={now} />) : <p className="ias-provider__empty">Nenhuma assinatura adicionada.</p>}</div>
            <div className="ias-models"><span className="eyebrow">Modelos {catalog?.[cli].source === 'cli' ? '· da CLI' : '· catálogo Orbit'}</span><div>{models.length ? models.map(model => <span className={`ias-model${catalog?.[cli].defaultModel === model.id ? ' ias-model--default' : ''}`} key={model.id} title={model.id}>{model.label}{catalog?.[cli].defaultModel === model.id && <small>padrão</small>}</span>) : <p>Lista ainda não disponível.</p>}</div></div>
            <button type="button" className="btn btn--ghost btn--sm ias-provider__open" aria-pressed={selected === cli} aria-controls="ias-account-details" onClick={() => select(cli)}>{selected === cli ? 'Contas selecionadas' : 'Gerenciar contas'}<span aria-hidden="true">→</span></button>
          </article>
        })}
      </div>
      <section ref={details} id="ias-account-details" className="ias-details" aria-labelledby="ias-selected-title">
        <div className="ias-toolbar"><div><span className="eyebrow">Contas e limites independentes</span><h3 id="ias-selected-title">{CLI_LABEL[selected]} <span className="muted">/ {selectedAccounts.length} {selectedAccounts.length === 1 ? 'conta' : 'contas'}</span></h3></div>{CLIS.includes(selected) && canAdd && <button type="button" className="btn btn--primary btn--sm" disabled={form !== null || connection !== 'open'} onClick={() => add(selected)}><PlusIcon size={14} />Adicionar conta {CLI_LABEL[selected]}</button>}</div>
        {!canAdd && <p className="ias-notice">Limite de {ACCOUNT_LIMITS.accounts} contas atingido. Edite uma conta existente para continuar.</p>}
        {form && !form.id && <AccountForm key={`${form.cli}-${form.kind}`} initial={form} onDone={() => setForm(null)} />}
        {!selectedAccounts.length && !form && <p className="ias-empty">Nenhuma conta {CLI_LABEL[selected]} configurada. {selected === 'antigravity' ? 'O login do Antigravity é o deste Mac.' : 'Adicione uma assinatura ou chave de API para começar.'}</p>}
        {selectedAccounts.map(account => form?.id === account.id ? <AccountForm key={account.id} initial={form} onDone={() => setForm(null)} /> : <AccountCard key={account.id} account={account} now={now} status={accountStatuses.find(s => s.accountId === account.id)} limits={limits.find(l => l.accountId === account.id)} liveAgents={panes.filter(p => p.accountId === account.id && p.status !== 'exited').length} onEdit={() => setForm(draftOf(account))} />)}
      </section>
      <section className="ias-api" aria-labelledby="ias-api-title"><div className="ias-toolbar"><div><h3 id="ias-api-title">Chaves pagas por uso</h3><p>Uso cobrado pelo provedor. Só entram na seleção automática com sua permissão.</p></div></div><div className="ias-api__grid">{CLIS.map(cli => <button key={cli} type="button" className="ias-api__item" disabled={!canAdd || form !== null || connection !== 'open'} onClick={() => add(cli, 'api')}><AgentMark cli={cli} /><span><strong>{CLI_LABEL[cli]}</strong><small>{accounts.filter(a => a.cli === cli && a.kind === 'api').length} chaves · adicionar chave</small></span><PlusIcon size={16} /></button>)}</div></section>
      <p className="ias-footnote">O login adicional abre uma sessão separada. Seus outros logins continuam conectados. Modelos e esforço são escolhidos ao abrir uma janela ou nas regras da missão.</p>
    </div>
  )
}
