import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileChange, FolderStatus, Workspace } from '@orbit/protocol'
import { useOrbitClient } from '../orbit/context.tsx'
import { pathText } from '../orbit/labels.ts'
import { BackIcon, ChevronIcon, CloseIcon, ReloadIcon, SearchIcon } from './icons.tsx'

/** How often the changes are read again while the panel is open (agents keep editing). */
const POLL_MS = 4000

const KIND_LETTER: Record<FileChange['kind'], string> = { modificado: 'M', novo: 'N', apagado: 'A', renomeado: 'R', conflito: 'C' }

type View =
  | { kind: 'list' }
  | { kind: 'diff'; folder: string; path: string }
  | { kind: 'file'; folder: string; path: string }

const folderName = (folder: string) => folder.split('/').filter(Boolean).pop() ?? folder

function splitPath(path: string): [string, string] {
  const at = path.lastIndexOf('/')
  return at === -1 ? ['', path] : [path.slice(0, at + 1), path.slice(at + 1)]
}

/** The mission's workspace: what the agents changed (git) and every file, read-only. */
export function FilesPanel({ workspace, missionId, onClose }: { workspace: Workspace; missionId: string; onClose: () => void }) {
  const client = useOrbitClient()
  const [tab, setTab] = useState<'mudancas' | 'todos'>('mudancas')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [status, setStatus] = useState<FolderStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    client.ask({ type: 'files.status', workspaceId: workspace.id, missionId }, 'files.status', (m) => m.workspaceId === workspace.id)
      .then((m) => {
        setStatus(m.folders)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [client, workspace.id, missionId])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const total = status?.reduce((n, f) => n + f.changes.length, 0) ?? 0
  const multi = workspace.folders.length > 1

  return (
    <aside className="side-panel files" aria-label="Arquivos do workspace">
      <div className="side-panel__bar">
        {view.kind !== 'list' ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setView({ kind: 'list' })}><BackIcon size={14} />{tab === 'mudancas' ? 'Mudanças' : 'Arquivos'}</button>
        ) : (
          <div className="segmented" role="group" aria-label="O que mostrar">
            <button type="button" aria-pressed={tab === 'mudancas'} onClick={() => setTab('mudancas')}>Mudanças{status ? ` · ${total}` : ''}</button>
            <button type="button" aria-pressed={tab === 'todos'} onClick={() => setTab('todos')}>Todos</button>
          </div>
        )}
        <span className="spacer" />
        {view.kind === 'list' && tab === 'mudancas' && <button type="button" className="icon-btn" aria-label="Ler de novo" onClick={refresh}><ReloadIcon size={14} /></button>}
        <button type="button" className="icon-btn" aria-label="Fechar arquivos" onClick={onClose}><CloseIcon size={14} /></button>
      </div>
      {error && <p className="form-error files__error" role="alert">{error}</p>}
      <div className="side-panel__body">
        {view.kind === 'diff' ? (
          <DiffView workspaceId={workspace.id} folder={view.folder} path={view.path} change={status?.find((f) => f.folder === view.folder)?.changes.find((c) => c.path === view.path)} multi={multi} />
        ) : view.kind === 'file' ? (
          <FileView workspaceId={workspace.id} folder={view.folder} path={view.path} multi={multi} />
        ) : tab === 'mudancas' ? (
          <Changes status={status} multi={multi} onOpen={(folder, path) => setView({ kind: 'diff', folder, path })} />
        ) : (
          <Tree workspace={workspace} status={status} onOpen={(folder, path) => setView({ kind: 'file', folder, path })} />
        )}
      </div>
    </aside>
  )
}

function Changes({ status, multi, onOpen }: { status: FolderStatus[] | null; multi: boolean; onOpen: (folder: string, path: string) => void }) {
  if (!status) return <p className="muted files__note">Lendo o git…</p>
  return (
    <>
      {status.map((f) => (
        <section key={f.folder} className="files__folder" aria-label={folderName(f.folder)}>
          <div className="files__folder-head">
            {multi && <strong>{folderName(f.folder)}</strong>}
            {f.git ? (
              <span className="muted">{f.branch ? <>branch <code>{f.branch}</code></> : 'sem branch'}{f.ahead ? ` · ${f.ahead} à frente` : ''}{f.behind ? ` · ${f.behind} atrás` : ''}</span>
            ) : (
              <span className="muted">fora de um repositório git</span>
            )}
          </div>
          {f.error && <p className="form-error">{f.error}</p>}
          {f.git && f.changes.length === 0 && <p className="muted files__note">Nada mudou desde o último commit.</p>}
          <ul className="plain-list files__changes">
            {f.changes.map((c) => {
              const [dir, name] = splitPath(c.path)
              return (
                <li key={c.path}>
                  <button type="button" className="change" onClick={() => onOpen(f.folder, c.path)} title={c.from ? `${c.from} → ${c.path}` : c.path}>
                    <span className={`change__kind change__kind--${c.kind}`} aria-label={c.kind}>{KIND_LETTER[c.kind]}</span>
                    <span className="change__path">{dir && <span className="change__dir">{pathText(dir)}</span>}<span className="change__name">{name}</span></span>
                    {c.staged && <span className="change__staged" title="já no índice (git add)">índice</span>}
                    {c.by.map((id) => <span key={id} className="chip change__by" title={`editado por #${id}`}>#{id}</span>)}
                    <span className="change__counts">
                      {c.added !== null && c.added > 0 && <span className="plus">+{c.added}</span>}
                      {c.removed !== null && c.removed > 0 && <span className="minus">−{c.removed}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
}

function DiffView({ workspaceId, folder, path, change, multi }: { workspaceId: string; folder: string; path: string; change: FileChange | undefined; multi: boolean }) {
  const client = useOrbitClient()
  const [diff, setDiff] = useState<{ text: string; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDiff(null)
    client.ask({ type: 'files.diff', workspaceId, folder, path }, 'files.diff', (m) => m.folder === folder && m.path === path)
      .then((m) => setDiff({ text: m.diff, truncated: m.truncated }), (e: Error) => setError(e.message))
  }, [client, workspaceId, folder, path, change?.added, change?.removed])

  // The diff header (diff --git, index, ---/+++) says nothing the title does not.
  const lines = useMemo(() => {
    const all = (diff?.text ?? '').split('\n')
    const start = all.findIndex((l) => l.startsWith('@@'))
    return start === -1 ? all : all.slice(start)
  }, [diff])

  return (
    <div className="viewer">
      <div className="viewer__title"><code>{multi ? `${folderName(folder)}/` : ''}{path}</code>{change && <span className="muted">{change.kind}{change.from ? ` (era ${change.from})` : ''}</span>}</div>
      {error ? <p className="form-error">{error}</p> : !diff ? <p className="muted files__note">Carregando…</p> : !diff.text.trim() ? (
        <p className="muted files__note">{change?.kind === 'apagado' ? 'Arquivo apagado.' : 'Sem diferenças de texto (binário ou só permissões).'}</p>
      ) : (
        <pre className="diff">
          {lines.map((line, i) => {
            const tone = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('\\') ? 'meta' : 'ctx'
            return <span key={i} className={`diff__line diff__line--${tone}`}>{line || ' '}{'\n'}</span>
          })}
        </pre>
      )}
      {diff?.truncated && <p className="muted files__note">Diff cortado: o arquivo mudou demais para mostrar inteiro.</p>}
    </div>
  )
}

function FileView({ workspaceId, folder, path, multi }: { workspaceId: string; folder: string; path: string; multi: boolean }) {
  const client = useOrbitClient()
  const [file, setFile] = useState<{ text: string | null; reason: string | null; size: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setFile(null)
    client.ask({ type: 'files.read', workspaceId, folder, path }, 'files.content', (m) => m.folder === folder && m.path === path)
      .then((m) => setFile({ text: m.text, reason: m.reason, size: m.size }), (e: Error) => setError(e.message))
  }, [client, workspaceId, folder, path])
  const lines = file?.text?.split('\n') ?? []
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return (
    <div className="viewer">
      <div className="viewer__title"><code>{multi ? `${folderName(folder)}/` : ''}{path}</code>{file && <span className="muted">{file.size.toLocaleString('pt-BR')} bytes</span>}</div>
      {error ? <p className="form-error">{error}</p> : !file ? <p className="muted files__note">Carregando…</p> : file.text === null ? <p className="muted files__note">{file.reason}</p> : (
        <pre className="source">
          {lines.map((line, i) => <span key={i} className="source__line"><span className="source__no" aria-hidden="true">{i + 1}</span>{line || ' '}{'\n'}</span>)}
        </pre>
      )}
    </div>
  )
}

interface Dir {
  dirs: Map<string, Dir>
  files: string[]
}

function buildTree(paths: string[]): Dir {
  const root: Dir = { dirs: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part)
      if (!next) node.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      node = next
    }
    node.files.push(path)
  }
  return root
}

function Tree({ workspace, status, onOpen }: { workspace: Workspace; status: FolderStatus[] | null; onOpen: (folder: string, path: string) => void }) {
  const client = useOrbitClient()
  const [folder, setFolder] = useState(workspace.folders[0]!)
  const [files, setFiles] = useState<{ list: string[]; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    setFiles(null)
    client.ask({ type: 'files.tree', workspaceId: workspace.id, folder }, 'files.tree', (m) => m.folder === folder)
      .then((m) => setFiles({ list: m.files, truncated: m.truncated }), (e: Error) => setError(e.message))
  }, [client, workspace.id, folder])

  const changed = useMemo(() => new Map(status?.find((f) => f.folder === folder)?.changes.map((c) => [c.path, c.kind]) ?? []), [status, folder])
  const needle = query.trim().toLowerCase()
  const tree = useMemo(() => buildTree(files?.list ?? []), [files])
  const toggle = (dir: string) => setOpen((s) => {
    const next = new Set(s)
    if (next.has(dir)) next.delete(dir)
    else next.add(dir)
    return next
  })

  const fileRow = (path: string, label: string, depth: number) => (
    <li key={path}>
      <button type="button" className="tree__file" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => onOpen(folder, path)}>
        <span className="tree__name">{label}</span>
        {changed.has(path) && <span className={`change__kind change__kind--${changed.get(path)}`}>{KIND_LETTER[changed.get(path)!]}</span>}
      </button>
    </li>
  )

  const renderDir = (node: Dir, prefix: string, depth: number): React.ReactNode[] => [
    ...[...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      const key = `${prefix}${name}/`
      const isOpen = open.has(key)
      return (
        <li key={key}>
          <button type="button" className="tree__dir" style={{ paddingLeft: 12 + depth * 14 }} aria-expanded={isOpen} onClick={() => toggle(key)}>
            <ChevronIcon size={12} />
            <span>{name}</span>
          </button>
          {isOpen && <ul className="plain-list">{renderDir(child, key, depth + 1)}</ul>}
        </li>
      )
    }),
    ...node.files.map((path) => fileRow(path, path.slice(prefix.length), depth)),
  ]

  return (
    <div className="tree">
      <div className="tree__bar">
        {workspace.folders.length > 1 && (
          <select aria-label="Pasta" value={folder} onChange={(e) => setFolder(e.target.value)}>
            {workspace.folders.map((f) => <option key={f} value={f}>{folderName(f)}</option>)}
          </select>
        )}
        <label className="search">
          <SearchIcon size={14} />
          <span className="sr-only">Filtrar arquivos</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar" />
        </label>
      </div>
      <p className="muted files__note tree__root" title={folder}>{pathText(folder)}</p>
      {error ? <p className="form-error">{error}</p> : !files ? <p className="muted files__note">Lendo os arquivos…</p> : (
        <ul className="plain-list tree__list">
          {needle
            ? files.list.filter((p) => p.toLowerCase().includes(needle)).slice(0, 300).map((p) => fileRow(p, p, 0))
            : renderDir(tree, '', 0)}
        </ul>
      )}
      {files?.truncated && <p className="muted files__note">Mostrando os primeiros {files.list.length.toLocaleString('pt-BR')} arquivos.</p>}
    </div>
  )
}
