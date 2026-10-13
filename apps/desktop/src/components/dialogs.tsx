import { useId, useState } from 'react'
import { MODEL_ID, type AgentCli, type MissionMode } from '@orbit/protocol'
import { useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, MODEL_SUGGESTIONS, MODE_LABEL } from '../orbit/labels.ts'
import { Dialog } from './Dialog.tsx'

const MODE_HINT: Record<MissionMode, string> = {
  livre: 'Um agente, você no comando.',
  squad: 'Um time fixo que segue um roteiro.',
  agentica: 'Você descreve o objetivo; o líder monta o time.',
}

export interface AgentChoice {
  cli: AgentCli
  model: string
}

function AgentFields({ value, onChange }: { value: AgentChoice; onChange: (next: AgentChoice) => void }) {
  const id = useId()
  return (
    <>
      <fieldset className="field">
        <legend>Agente</legend>
        <div className="segmented">
          {(Object.keys(CLI_LABEL) as AgentCli[]).map((cli) => (
            <button key={cli} type="button" aria-pressed={value.cli === cli} onClick={() => onChange({ cli, model: cli === value.cli ? value.model : '' })}>
              {CLI_LABEL[cli]}
            </button>
          ))}
        </div>
      </fieldset>
      {value.cli !== 'shell' && (
        <div className="field">
          <label htmlFor={`${id}-model`}>Modelo <span className="muted">(vazio = padrão do {CLI_LABEL[value.cli]})</span></label>
          <input id={`${id}-model`} list={`${id}-models`} value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value.trim() })} placeholder="ex.: claude-opus-5-5" spellCheck={false} />
          <datalist id={`${id}-models`}>
            {MODEL_SUGGESTIONS[value.cli].map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      )}
    </>
  )
}

function modelOrNull(choice: AgentChoice): string | null {
  return choice.cli === 'shell' || !choice.model ? null : choice.model
}

function invalidModel(choice: AgentChoice): boolean {
  const model = modelOrNull(choice)
  return model !== null && !MODEL_ID.test(model)
}

export function OpenWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const client = useOrbitClient()
  const [path, setPath] = useState('')
  return (
    <Dialog eyebrow="Workspace" title="Abrir pasta" submitLabel="Abrir" onClose={onClose} onSubmit={() => {
      if (!path.trim()) return
      client.send({ type: 'workspace.open', path: path.trim() })
      onClose()
    }}>
      <div className="field">
        <label htmlFor="ws-path">Caminho absoluto da pasta do projeto</label>
        <input id="ws-path" className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/voce/projetos/meu-app" autoFocus spellCheck={false} />
      </div>
    </Dialog>
  )
}

export function NewMissionDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const client = useOrbitClient()
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [mode, setMode] = useState<MissionMode>('livre')
  const [lead, setLead] = useState<AgentChoice>({ cli: 'claude', model: '' })
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog eyebrow="Nova missão" title="O que vamos fazer?" submitLabel="Lançar missão" onClose={onClose} onSubmit={() => {
      if (!title.trim()) return setError('Dê um título para a missão.')
      if (invalidModel(lead)) return setError('Modelo inválido: use só letras, números, ponto, hífen ou dois-pontos.')
      client.send({ type: 'mission.create', workspaceId, title, objective, mode, lead: { cli: lead.cli, model: modelOrNull(lead), title: '' } })
      onClose()
    }}>
      <div className="field">
        <label htmlFor="m-title">Título</label>
        <input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refatorar a autenticação" autoFocus />
      </div>
      <div className="field">
        <label htmlFor="m-obj">Objetivo <span className="muted">(opcional)</span></label>
        <textarea id="m-obj" rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Trocar o login para o novo provedor de sessão sem quebrar os testes" />
      </div>
      <fieldset className="field">
        <legend>Modo</legend>
        <div className="mode-list">
          {(Object.keys(MODE_LABEL) as MissionMode[]).map((m) => (
            <button key={m} type="button" className="mode-option" aria-pressed={mode === m} onClick={() => setMode(m)}>
              <span className={`badge badge--${m}`}>{MODE_LABEL[m]}</span>
              <span>{MODE_HINT[m]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <AgentFields value={lead} onChange={setLead} />
      {mode === 'agentica' && <p className="note">O líder recebe o objetivo e abre os ajudantes sozinho pelo MCP do Orbit. Os retornos chegam no terminal dele.</p>}
      {mode === 'squad' && <p className="note">Squads com roteiro ainda não existem: por enquanto só o líder abre, com as ferramentas do Orbit.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}

export function AddAgentDialog({ missionId, onClose }: { missionId: string; onClose: () => void }) {
  const client = useOrbitClient()
  const [title, setTitle] = useState('')
  const [task, setTask] = useState('')
  const [agent, setAgent] = useState<AgentChoice>({ cli: 'claude', model: '' })
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog eyebrow="Tripulação" title="Adicionar agente" submitLabel="Abrir agente" onClose={onClose} onSubmit={() => {
      if (invalidModel(agent)) return setError('Modelo inválido: use só letras, números, ponto, hífen ou dois-pontos.')
      client.send({ type: 'pane.spawn', request: { missionId, role: 'crew', cli: agent.cli, model: modelOrNull(agent), title, task: agent.cli === 'shell' ? null : task } })
      onClose()
    }}>
      <div className="field">
        <label htmlFor="a-title">Função <span className="muted">(opcional)</span></label>
        <input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mapear leituras do token" autoFocus />
      </div>
      <AgentFields value={agent} onChange={setAgent} />
      {agent.cli !== 'shell' && (
        <div className="field">
          <label htmlFor="a-task">Tarefa <span className="muted">(opcional; vira o primeiro pedido do agente)</span></label>
          <textarea id="a-task" rows={4} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Mapeie onde o token de sessão é lido e devolva a lista de arquivos" />
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}
