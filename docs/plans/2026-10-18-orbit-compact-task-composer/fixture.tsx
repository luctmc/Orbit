// Local-only QA of the real component. No sidecar/CLI/network/account is used.
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../../../apps/desktop/src/styles.css'
import { MessageComposer } from '../../../apps/desktop/src/components/MessageComposer.tsx'
import { MissionView } from '../../../apps/desktop/src/components/MissionView.tsx'
import { OrbitProvider } from '../../../apps/desktop/src/orbit/context.tsx'
import type { OrbitClient } from '../../../apps/desktop/src/orbit/client.ts'
import type { Pane } from '@orbit/protocol'

const query = new URLSearchParams(location.search)
const panes = [
  { id: 76, title: 'Líder', cli: 'codex', role: 'lead', status: 'idle' },
  { id: 77, title: 'Compactar compositor', cli: 'codex', role: 'helper', status: 'idle' },
  { id: 78, title: 'Terminal', cli: 'shell', role: 'helper', status: 'idle' },
] as Pane[]
for (const pane of panes) Object.assign(pane, { missionId: 'qa-mission', cwd: '/tmp/orbit-composer-qa', model: 'gpt-6.1-sol', effort: 'high', accountId: pane.id === 76 ? 'codex-acc-2' : pane.id === 77 ? 'legacy-account-77' : null, contextPercent: null, sessionId: null, attention: null, usage: null })
if (query.has('waiting')) Object.assign(panes[1], { status: 'waiting', attention: 'Aprovar o próximo passo' })
const mission = { id: 'qa-mission', title: 'Melhorar o espaço de trabalho', objective: 'Mais espaço para acompanhar as CLIs e enviar orientações.', mode: 'agentica', status: 'active', usage: { total: 0, costUsd: null }, budget: null, workspaceId: 'qa', squadId: null, git: null } as any
const progress = { missionId: mission.id, observedAt: Date.now(), activities: query.has('blocked') ? [{ id: 'blocked', missionId: mission.id, title: 'Atividade bloqueada', state: 'blocked', acceptance: ['Entregar com evidência'], dependencies: [], verificationRequired: true, revision: 1 }] : [], attempts: [], results: [], verifications: [], deliveries: [], validation: [], integration: { state: 'none', reviewId: null, reason: null } }
const listeners = new Set<() => void>()
let state = { connection: 'open', accounts: [{ id: 'codex-acc-2', name: 'Codex 2', cli: 'codex', kind: 'assinatura' }], settings: { agentsInEnglish: true }, squads: [], browsers: [], workspaces: [], cards: [], events: [], runtime: { persistent: true }, panes, missions: [mission] }
const submissions: unknown[] = []
const attachments: unknown[] = []
let pending = false
const client = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  getState: () => state,
  inputDrafts: new Map(), inputAttachments: new Map(), inputReceipts: new Map(),
  inputPending: () => pending,
  submitInput: async (input: unknown) => { submissions.push(input) },
  checkPendingInput: async () => { submissions.push({ checked: true }); pending = false },
  cancelQueuedInput: async () => { pending = false; return { message: 'Pedido cancelado no fixture' } },
  send: () => {},
  attachPane: (_id: number, view: any) => { queueMicrotask(() => view.snapshot({ data: 'Terminal de QA · nenhum provedor conectado\r\n', cols: 80, rows: 24 })); return () => {} },
  ask: async (input: any) => {
    if (input.type === 'mission.progress') return { progress }
    attachments.push({ name: input.name, mime: input.mime })
    return { attachment: { id: `file-${attachments.length}`, name: input.name, mime: input.mime, size: atob(input.data).length } }
  },
}
if (query.has('draft')) client.inputDrafts.set('pane-76', { text: 'quero que vc melhore o espaço da tela do orbit visualmente aqui esta consumindo muito espaço', allowOriginal: false, accountId: '' })
if (query.has('pending')) { pending = true; client.inputDrafts.set('pane-76', { text: 'Rascunho preservado', dispatch: 'continue' }) }
if (query.has('original-draft')) client.inputDrafts.set('pane-76', { text: '', accountId: 'codex-acc-2', allowOriginal: true })
Object.assign(window, { qa: {
  submissions, attachments, client,
  connection: (connection: string) => { state = { ...state, connection }; for (const fn of listeners) fn() },
  metrics: () => {
    const form = document.querySelector('.composer')!
    const bounds = form.getBoundingClientRect()
    return { width: innerWidth, height: bounds.height, content: document.querySelector('.composer__content')?.clientHeight,
      inputHeight: form.querySelector('textarea')!.clientHeight,
      inputClipped: document.querySelector('.composer__content')!.clientHeight < form.querySelector('textarea')!.clientHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      controls: [...form.querySelectorAll('button, select, summary')].filter(el => (el as HTMLElement).offsetWidth > 0).map(el => ({
        name: el.getAttribute('aria-label') || el.textContent?.trim(), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
      })) }
  },
} })

function Fixture() {
  const [selected, select] = useState(Number(query.get('pane')) || 76)
  const [suggestionsOn, toggle] = useState(true)
  const [layout, setLayout] = useState<'grade' | 'foco'>(query.has('focus') ? 'foco' : 'grade')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const single = query.has('single')
  return <OrbitProvider client={client as unknown as OrbitClient}>
    {query.has('mission') ? <div style={{ height: '100vh', display: 'flex' }}><MissionView mission={mission} panes={panes.slice(0, 2)} selectedPaneId={selected} layout={layout} onLayout={setLayout as any} onSelectPane={select} onAddAgent={() => {}} /></div> :
    <main className="mission" style={{ height: '100vh', width: '100%', overflow: 'hidden' }}>
      <div style={{ padding: 16, color: 'var(--text-3)', flex: 'none' }}>Missão · Melhorar o espaço de trabalho <span className="muted">· Fixture local de QA</span></div>
      <div className="mission__body" style={{ flex: '1 1 auto', minHeight: 0 }}><div className="pane" style={{ margin: 8, flex: 1 }}><div className="pane__head"><strong>Líder · #76</strong><span className="chip">codex</span></div><div style={{ padding: 16, fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>Resultado do trabalho da missão.<br />O espaço permanece disponível para ler o terminal.</div></div></div>
      {panes.map(pane => <MessageComposer key={pane.id} pane={pane} active={selected === pane.id} leader={panes[0]} recipients={single ? [panes[0]] : panes} onSelectPane={select} inputRef={inputRef}
        suggestions={query.has('suggest') ? [{ id: 'qa', text: 'Verifique os testes antes de entregar.', reason: 'Conferir o resultado da missão.' }] as any : []}
        suggestionsOn={suggestionsOn} onToggleSuggestions={() => toggle(!suggestionsOn)} />)}
    </main>}
  </OrbitProvider>
}
const narrow = Number(query.get('frame'))
if (narrow) {
  const inner = new URL(location.href); inner.searchParams.delete('frame')
  createRoot(document.getElementById('root')!).render(<><p style={{ padding: 8 }}>Viewport do compositor: {narrow}px</p><iframe title="Orbit em largura estreita" src={inner.href} style={{ border: 0, width: narrow, height: 720 }} /></>)
} else createRoot(document.getElementById('root')!).render(<Fixture />)
