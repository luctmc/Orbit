import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Mission } from '@orbit/protocol'
import { isTauri, useOrbitClient } from '../orbit/context.tsx'
import { openExternal } from '../orbit/open.ts'
import { CloseIcon } from './icons.tsx'

/** **bold**, `code` and [links](https://…) inside a line; everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\))/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(part)
    if (link) return <a key={i} href={link[2]} onClick={(e) => { e.preventDefault(); void openExternal(link[2]!) }}>{link[1]}</a>
    return part
  })
}

/** The subset of Markdown the report uses: headings, lists, checkboxes, rules, details. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let list: ReactNode[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list}</ul>)
    list = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('<details>')) {
      flush()
      const body: string[] = []
      while (i + 1 < lines.length && !lines[i + 1]!.startsWith('</details>')) body.push(lines[++i]!)
      i++
      blocks.push(<details key={`d${i}`}><summary>Detalhes</summary><Markdown text={body.join('\n')} /></details>)
      continue
    }
    const task = /^- \[( |x)\] (.*)$/.exec(line)
    if (task) {
      list.push(<li key={i} className={task[1] === 'x' ? 'report__done' : 'report__todo'}><span aria-hidden="true">{task[1] === 'x' ? '✓' : '○'}</span> {inline(task[2]!)}</li>)
      continue
    }
    if (line.startsWith('- ')) {
      list.push(<li key={i}>{inline(line.slice(2))}</li>)
      continue
    }
    flush()
    if (!line.trim()) continue
    if (line.startsWith('### ')) blocks.push(<h4 key={i}>{inline(line.slice(4))}</h4>)
    else if (line.startsWith('## ')) blocks.push(<h3 key={i}>{inline(line.slice(3))}</h3>)
    else if (line.startsWith('# ')) blocks.push(<h2 key={i}>{inline(line.slice(2))}</h2>)
    else if (line === '---') blocks.push(<hr key={i} />)
    else blocks.push(<p key={i}>{inline(line)}</p>)
  }
  flush()
  return <>{blocks}</>
}

const fileName = (title: string) => `${title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'missao'}-relatorio.md`

/** The mission's report: preview, copy, save as .md. */
export function ReportDialog({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const client = useOrbitClient()
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    client.ask({ type: 'report.get', missionId: mission.id }, 'report', (m) => m.missionId === mission.id, 60_000).then((m) => setMarkdown(m.markdown), (e: Error) => setError(e.message))
  }, [client, mission.id])

  const copy = () => {
    if (!markdown) return
    navigator.clipboard?.writeText(markdown).then(() => setNote('Copiado.'), () => setNote('Não deu para copiar.'))
  }

  const save = async () => {
    if (!markdown) return
    if (!isTauri) {
      // In a browser the file goes to its downloads.
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
      link.download = fileName(mission.title)
      link.click()
      URL.revokeObjectURL(link.href)
      return setNote('Baixado.')
    }
    const { save: pick } = await import('@tauri-apps/plugin-dialog')
    const path = await pick({ defaultPath: fileName(mission.title), filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (!path) return
    client.ask({ type: 'report.save', missionId: mission.id, path }, 'report.saved', (m) => m.missionId === mission.id)
      .then((m) => setNote(`Salvo em ${m.path}`), (e: Error) => setError(e.message))
  }

  return (
    <dialog ref={ref} className="dialog dialog--wide" aria-labelledby={`${uid}-title`} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <header className="dialog__head">
        <div>
          <div className="eyebrow">{mission.title}</div>
          <h2 id={`${uid}-title`}>Relatório da missão</h2>
        </div>
        <div className="segmented settings-tabs" role="group" aria-label="Como ver">
          <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>Visualizar</button>
          <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>Markdown</button>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="dialog__body report">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!markdown ? <p className="muted">Montando o relatório…</p> : raw ? <pre className="report__raw">{markdown}</pre> : <article className="report__doc"><Markdown text={markdown} /></article>}
      </div>
      <footer className="dialog__foot report__actions">
        {note && <span className="muted" role="status">{note}</span>}
        <span className="spacer" />
        <button type="button" className="btn btn--ghost" disabled={!markdown} onClick={copy}>Copiar Markdown</button>
        <button type="button" className="btn btn--primary" disabled={!markdown} onClick={() => void save()}>Salvar .md</button>
      </footer>
    </dialog>
  )
}
