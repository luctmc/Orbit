import { useEffect, useRef } from 'react'
import { EFFORT_LABEL, type CliStatus } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, pathText } from '../orbit/labels.ts'
import { relativeTime } from '../orbit/time.ts'
import { useAppUpdater } from '../orbit/updater.ts'

const METHOD_LABEL: Record<CliStatus['method'], string> = {
  npm: 'instalado pelo npm',
  native: 'instalador nativo',
  brew: 'instalado pelo Homebrew',
  unknown: 'instalação desconhecida',
}

/** -1, 0 or 1 comparing dotted versions; prerelease suffixes are ignored. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0]!.split('.').map(Number)
  const pb = b.split(/[-+]/)[0]!.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

function CliCard({ status, liveAgents }: { status: CliStatus; liveAgents: number }) {
  const client = useOrbitClient()
  const name = CLI_LABEL[status.cli]
  const outdated = status.version && status.latest ? compareVersions(status.latest, status.version) > 0 : false
  const canUpdate = status.installed && (status.method === 'npm' || status.method === 'native')

  return (
    <article className="cli-card" aria-labelledby={`cli-${status.cli}`}>
      <div className="cli-card__head">
        <div className="cli-card__title">
          <h3 id={`cli-${status.cli}`}>{name}</h3>
          {status.busy ? (
            <span className="chip" role="status">{status.busy === 'checking' ? 'Verificando…' : 'Atualizando…'}</span>
          ) : status.checkedAt === null ? null : !status.installed ? (
            <span className="chip chip--warn">não encontrado</span>
          ) : outdated ? (
            <span className="chip chip--warn">{status.latest} disponível</span>
          ) : status.latest ? (
            <span className="chip chip--main">atualizado</span>
          ) : null}
        </div>
        <div className="cli-card__actions">
          {canUpdate && outdated && (
            <button className="btn btn--primary btn--sm" disabled={Boolean(status.busy)} onClick={() => client.send({ type: 'cli.update', cli: status.cli })}>
              Atualizar para {status.latest}
            </button>
          )}
        </div>
      </div>
      <dl className="cli-card__facts">
        <div><dt>Versão</dt><dd>{status.version ?? '—'}</dd></div>
        <div><dt>Mais recente</dt><dd>{status.latest ?? '—'}</dd></div>
        <div><dt>Instalação</dt><dd>{status.installed ? METHOD_LABEL[status.method] : '—'}</dd></div>
        <div className="cli-card__path"><dt>Caminho</dt><dd title={status.path ?? ''}>{status.path ? pathText(status.path) : '—'}</dd></div>
      </dl>
      {outdated && status.installed && !canUpdate && <p className="note">{name} não foi instalado por npm nem pelo instalador nativo; atualize pelo meio que você usou.</p>}
      {outdated && canUpdate && liveAgents > 0 && (
        <p className="note">{liveAgents} {liveAgents === 1 ? 'agente aberto continua' : 'agentes abertos continuam'} na versão atual até ser{liveAgents === 1 ? '' : 'em'} reaberto{liveAgents === 1 ? '' : 's'}.</p>
      )}
      {status.message && <pre className={`cli-card__message${status.ok === false ? ' cli-card__message--error' : ''}`}>{status.message}</pre>}
    </article>
  )
}

/** Orbit itself: its version, the latest release and the update, when the desktop app runs. */
function OrbitCard() {
  const updater = useAppUpdater()
  const { updateStatus } = useOrbit()
  const error = updater.error ?? updateStatus?.error ?? null
  return (
    <article className="cli-card orbit-card" aria-labelledby="cli-orbit">
      <div className="cli-card__head">
        <div className="cli-card__title">
          <h3 id="cli-orbit">Orbit</h3>
          {updater.checking ? <span className="chip" role="status">Verificando…</span>
            : updater.available ? <span className="chip chip--warn">{updater.available.version} disponível</span>
            : updateStatus?.checkedAt && !error ? <span className="chip chip--main">atualizado</span> : null}
        </div>
        <div className="cli-card__actions">
          {updater.supported && !updater.available && <button className="btn btn--ghost btn--sm" disabled={updater.checking} onClick={() => void updater.check()}>Verificar agora</button>}
          {updater.available && (
            <button className="btn btn--primary btn--sm" disabled={updater.installing} onClick={() => void updater.install()}>
              {updater.installing ? (updater.progress !== null ? `Baixando ${Math.round(updater.progress * 100)}%` : 'Instalando…') : `Instalar ${updater.available.version} e reiniciar`}
            </button>
          )}
        </div>
      </div>
      <dl className="cli-card__facts">
        <div><dt>Versão</dt><dd>{updater.current ?? '—'}</dd></div>
        <div><dt>Mais recente</dt><dd>{updateStatus?.latest ?? (updateStatus?.checkedAt ? 'nenhuma publicada' : '—')}</dd></div>
        <div><dt>Releases</dt><dd title={updateStatus?.repo}>{updateStatus?.repo ?? '—'}</dd></div>
      </dl>
      {!updater.supported && <p className="note">As atualizações são instaladas pelo app do Orbit; no navegador elas não aparecem.</p>}
      {updater.available?.notes && <pre className="cli-card__message">{updater.available.notes}</pre>}
      {updater.installing && updater.progress !== null && <div className="progress" role="progressbar" aria-valuenow={Math.round(updater.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${updater.progress * 100}%` }} /></div>}
      {error && <pre className="cli-card__message cli-card__message--error">{error}</pre>}
      <p className="note">O Orbit busca as versões com o seu GitHub CLI (gh) e só instala o que estiver assinado com a chave do projeto.</p>
    </article>
  )
}

/** Settings › Agentes e CLIs: versions, updates and the models (with their effort levels) each CLI offers. */
export function ClisPanel() {
  const client = useOrbitClient()
  const { clis, catalog, panes } = useOrbit()
  const asked = useRef(false)

  // Look the CLIs up the first time the panel opens in this run of the app.
  useEffect(() => {
    if (asked.current || clis.some((c) => c.checkedAt !== null || c.busy)) return
    asked.current = true
    client.send({ type: 'cli.check' })
  }, [client, clis])

  const busy = clis.some((c) => c.busy)
  const lastCheck = Math.max(0, ...clis.map((c) => c.checkedAt ?? 0))

  return (
    <div className="dialog__body clis">
      <div className="clis__bar">
        <p className="muted">Orbit abre agentes com as CLIs instaladas no seu Mac. Daqui você vê as versões, atualiza e confere os modelos e esforços que cada uma aceita.</p>
        <span className="spacer" />
        {lastCheck > 0 && <span className="muted clis__when">verificado {relativeTime(lastCheck)}</span>}
        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => client.send({ type: 'cli.check' })}>Buscar atualizações</button>
      </div>

      <div className="clis__cards">
        <OrbitCard />
        {clis.map((status) => (
          <CliCard key={status.cli} status={status} liveAgents={panes.filter((p) => p.cli === status.cli && p.status !== 'exited').length} />
        ))}
      </div>

      <section className="clis__catalog" aria-labelledby="catalog-title">
        <h3 id="catalog-title" className="eyebrow">Modelos e esforços</h3>
        {!catalog ? (
          <p className="muted">Lendo os modelos das CLIs…</p>
        ) : (
          <div className="catalog-grid">
            {(['claude', 'codex'] as const).map((cli) => (
              <div key={cli} className="catalog-col">
                <div className="catalog-col__head">
                  <span>{CLI_LABEL[cli]}</span>
                  <span className="muted">{catalog[cli].source === 'cli' ? 'lido da CLI' : 'lista do Orbit'}</span>
                </div>
                {catalog[cli].models.length === 0 && <p className="muted">A CLI não informou modelos; o Orbit usa o padrão dela.</p>}
                <ul className="plain-list">
                  {catalog[cli].models.map((m) => (
                    <li key={m.id} className="catalog-model">
                      <div className="catalog-model__name"><span>{m.label}</span><code>{m.id}</code></div>
                      <div className="catalog-model__efforts">
                        {m.efforts.map((e) => <span key={e} className={`chip${e === m.defaultEffort ? ' chip--main' : ''}`} title={e === m.defaultEffort ? 'padrão do modelo' : undefined}>{EFFORT_LABEL[e]}</span>)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
