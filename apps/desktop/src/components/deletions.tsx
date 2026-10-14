import type { Mission, Pane, Workspace } from '@orbit/protocol'
import { useOrbitClient } from '../orbit/context.tsx'
import { DeleteDialog } from './DeleteDialog.tsx'

const CONVERSATIONS = 'As conversas ficam no próprio Claude Code e no Codex; sem elas, não dá mais para retomar esses agentes.'

/** Delete a mission for good, with its agents' conversations, memory and branches as choices. */
export function DeleteMissionDialog({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const client = useOrbitClient()
  return (
    <DeleteDialog eyebrow={mission.title} title="Apagar a missão" onClose={onClose}
      gone={[
        'os agentes dela (os que estiverem rodando são encerrados)',
        'o fluxo, o quadro, as notas de decisão e as propostas',
        'o uso registrado dela no painel Uso',
        ...(mission.git ? ['as cópias de trabalho (worktrees) do Orbit, mesmo com mudanças sem commit'] : []),
      ]}
      kept={[
        'os arquivos do seu projeto (nada é apagado nas suas pastas)',
        'os modelos salvos a partir dela e os agendamentos',
        ...(mission.git ? ['os branches no repositório, a menos que você marque abaixo'] : []),
      ]}
      options={[
        { key: 'conversations', label: 'Apagar também as conversas dos agentes', hint: CONVERSATIONS, initial: true },
        { key: 'memory', label: 'Apagar o que ela deixou na memória do projeto', hint: 'Decisões, fatos e lições anotados nela e o resumo dela.', initial: true },
        ...(mission.git ? [{ key: 'branches', label: `Apagar os branches ${mission.git.branch} e os dos ajudantes`, hint: 'Commits que não foram integrados em outro branch se perdem.', initial: false }] : []),
      ]}
      onConfirm={(c) => client.send({ type: 'mission.delete', missionId: mission.id, conversations: c.conversations === true, memory: c.memory === true, branches: c.branches === true })}
    />
  )
}

/** Delete an agent for good: its terminal, its lines in the flow and, if chosen, its conversation. */
export function DeleteAgentDialog({ pane, onClose }: { pane: Pane; onClose: () => void }) {
  const client = useOrbitClient()
  const hasConversation = (pane.cli === 'claude' || pane.cli === 'codex') && pane.sessionId !== null
  return (
    <DeleteDialog eyebrow={`#${pane.id} ${pane.title}`} title="Apagar o agente" onClose={onClose}
      gone={['o terminal e os arquivos do agente (se estiver rodando, é encerrado)', 'as linhas dele no fluxo da missão (abertura, retornos, avisos)']}
      kept={['o que ele mudou nos arquivos do projeto', 'a missão e os outros agentes']}
      options={hasConversation ? [{ key: 'conversation', label: 'Apagar também a conversa dele', hint: CONVERSATIONS, initial: true }] : []}
      onConfirm={(c) => client.send({ type: 'pane.delete', paneId: pane.id, conversation: c.conversation === true })}
    />
  )
}

/** Delete a workspace from Orbit: all its missions, memory, templates and schedules. Its folders stay. */
export function DeleteWorkspaceDialog({ workspace, missions, onClose, onDeleted }: { workspace: Workspace; missions: number; onClose: () => void; onDeleted: () => void }) {
  const client = useOrbitClient()
  return (
    <DeleteDialog eyebrow="Workspace" title={`Apagar ${workspace.name}`} confirmName={workspace.name} onClose={onClose}
      gone={[
        `${missions} ${missions === 1 ? 'missão' : 'missões'}, com agentes, fluxo, quadro e uso`,
        'a memória do projeto',
        'os modelos e os agendamentos deste workspace',
        'as instruções para os agentes',
      ]}
      kept={['as pastas e os arquivos do projeto no seu Mac', 'os branches no repositório, a menos que você marque abaixo']}
      options={[
        { key: 'conversations', label: 'Apagar também as conversas dos agentes', hint: CONVERSATIONS, initial: true },
        { key: 'branches', label: 'Apagar os branches que as missões criaram', hint: 'Commits que não foram integrados em outro branch se perdem.', initial: false },
      ]}
      onConfirm={(c) => {
        client.send({ type: 'workspace.delete', workspaceId: workspace.id, conversations: c.conversations === true, branches: c.branches === true })
        onDeleted()
      }}
    />
  )
}
