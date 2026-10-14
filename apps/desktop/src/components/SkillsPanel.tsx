import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentCliForRole, CatalogItem, CatalogKind } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL } from '../orbit/labels.ts'
import { relativeTime } from '../orbit/time.ts'
import { SearchIcon } from './icons.tsx'

const KINDS: Array<[CatalogKind, string, string]> = [
  ['skill', 'Skills', 'Instruções que o agente carrega quando a tarefa pede.'],
  ['agent', 'Subagentes', 'Agentes que o Claude Code chama para partes do trabalho.'],
  ['mcp', 'Servidores MCP', 'Ferramentas externas (fora o MCP do próprio Orbit, que sempre fica ligado).'],
]
type CliFilter = 'todas' | AgentCliForRole

function Item({ item, enabled, onToggle }: { item: CatalogItem; enabled: boolean; onToggle: (on: boolean) => void }) {
  const id = `catalog-${item.id}`
  return (
    <li className={`catalog-item${enabled ? '' : ' catalog-item--off'}`}>
      <label className="switch" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={enabled} onChange={(e) => onToggle(e.target.checked)} aria-describedby={`${id}-desc`} />
        <span className="switch__track" aria-hidden="true" />
        <span className="sr-only">Usar {item.name} nos agentes do Orbit</span>
      </label>
      <div className="catalog-item__text">
        <div className="catalog-item__name">
          <code>{item.name}</code>
          <span className="chip">{CLI_LABEL[item.cli]}</span>
          <span className="chip">{item.source}</span>
          {item.offInCli && <span className="chip chip--warn" title="A própria CLI está configurada para não usar">desligado na CLI</span>}
        </div>
        <p id={`${id}-desc`} className="muted">{item.description || 'Sem descrição.'}</p>
      </div>
    </li>
  )
}

/** Settings › Skills: what each CLI has installed, and what Orbit's agents may use. */
export function SkillsPanel() {
  const client = useOrbitClient()
  const { skillCatalog } = useOrbit()
  const [query, setQuery] = useState('')
  const [cli, setCli] = useState<CliFilter>('todas')
  const asked = useRef(false)

  // Read again when the panel opens: skills come and go as plugins are installed.
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    client.send({ type: 'catalog.scan' })
  }, [client])

  const disabled = useMemo(() => new Set(skillCatalog.disabled), [skillCatalog.disabled])
  const needle = query.trim().toLowerCase()
  const visible = skillCatalog.items.filter((i) => (cli === 'todas' || i.cli === cli) && (!needle || `${i.name} ${i.description} ${i.source}`.toLowerCase().includes(needle)))
  const offCount = skillCatalog.items.filter((i) => disabled.has(i.id)).length

  return (
    <div className="dialog__body clis">
      <div className="clis__bar">
        <p className="muted">
          O que o Claude Code e o Codex têm instalado (pessoal, plugins e as pastas dos seus workspaces). Desligar aqui vale só para os agentes do Orbit e não muda as CLIs: o Claude é bloqueado pelo hook se tentar usar, o Codex abre com o servidor MCP desligado e os dois são avisados nas instruções.
        </p>
        <span className="spacer" />
        {skillCatalog.scannedAt && <span className="muted clis__when">lido {relativeTime(skillCatalog.scannedAt)}</span>}
        <button className="btn btn--ghost btn--sm" onClick={() => client.send({ type: 'catalog.scan' })}>Ler de novo</button>
      </div>

      <div className="catalog-filters">
        <label className="search">
          <SearchIcon size={15} />
          <span className="sr-only">Buscar skill, subagente ou servidor</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar" />
        </label>
        <div className="segmented" role="group" aria-label="CLI">
          {(['todas', 'claude', 'codex'] as const).map((c) => <button key={c} type="button" aria-pressed={cli === c} onClick={() => setCli(c)}>{c === 'todas' ? 'Todas' : CLI_LABEL[c]}</button>)}
        </div>
        <span className="muted">{skillCatalog.items.length} itens{offCount ? ` · ${offCount} ${offCount === 1 ? 'desligado' : 'desligados'} no Orbit` : ''}</span>
      </div>

      {skillCatalog.scannedAt === null ? (
        <p className="muted">Lendo o que as CLIs têm instalado…</p>
      ) : (
        KINDS.map(([kind, title, hint]) => {
          const items = visible.filter((i) => i.kind === kind)
          if (items.length === 0) return null
          return (
            <section key={kind} className="catalog-section" aria-labelledby={`catalog-${kind}`}>
              <div className="catalog-section__head">
                <h3 id={`catalog-${kind}`} className="eyebrow">{title} <span className="muted">· {items.length}</span></h3>
                <span className="muted">{hint}</span>
              </div>
              <ul className="plain-list catalog-list">
                {items.map((item) => (
                  <Item key={item.id} item={item} enabled={!disabled.has(item.id)} onToggle={(on) => client.send({ type: 'catalog.toggle', id: item.id, enabled: on })} />
                ))}
              </ul>
            </section>
          )
        })
      )}
      {skillCatalog.scannedAt !== null && visible.length === 0 && <p className="muted">Nada encontrado.</p>}
    </div>
  )
}
