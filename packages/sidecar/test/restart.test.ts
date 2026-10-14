import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommand, type AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const SESSION = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'

test('resuming continues the CLI conversation instead of sending the first prompt again', () => {
  const claude = buildCommand({ cli: 'claude', model: 'opus', taskPath: '/p/task.md', rolePromptPath: '/p/role.md', resume: SESSION }, '/bin/zsh').args[2]!
  assert.match(claude, new RegExp(`^claude --resume ${SESSION} --model opus`))
  assert.doesNotMatch(claude, /task\.md/)
  const codex = buildCommand({ cli: 'codex', model: 'gpt-6', taskPath: '/p/task.md', rolePromptPath: '/p/role.md', resume: SESSION }, '/bin/zsh').args[2]!
  assert.match(codex, new RegExp(`^codex resume -m gpt-6 .*-- ${SESSION}; exec`))
  assert.doesNotMatch(codex, /role\.md|task\.md/)
  assert.throws(() => buildCommand({ cli: 'claude', model: null, resume: 'x; rm -rf ~' }, '/bin/zsh'), /Conversa inválida/)
})

test('agents are renamed, duplicated, reopened, and resumed even after Orbit restarts', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const launches: AgentLaunch[] = []
  const fake = (launch: AgentLaunch, shell: string) => {
    launches.push(launch)
    return { file: shell, args: ['-c', `exec ${shell}`] }
  }
  const start = () => startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, agentCommand: fake, browser: null })
  let server = await start()
  let ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Retomar', objective: '', mode: 'livre', lead: { cli: 'claude', model: 'opus', effort: 'high', title: 'Líder' } })
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')

    ui.send({ type: 'pane.rename', paneId: lead.id, title: 'Arquiteto' })
    await ui.next('pane.updated', (m) => m.pane.id === lead.id && m.pane.title === 'Arquiteto')

    // Claude's hooks carry the conversation id.
    ui.send({ type: 'pane.input', paneId: lead.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === lead.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    await fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION }) })
    await ui.next('pane.updated', (m) => m.pane.id === lead.id && m.pane.sessionId === SESSION)

    ui.send({ type: 'pane.duplicate', paneId: lead.id })
    const { pane: copy } = await ui.next('pane.updated', (m) => m.pane.title === 'Arquiteto (cópia)')
    assert.deepEqual([copy.role, copy.cli, copy.model, copy.effort], ['crew', 'claude', 'opus', 'high'])
    assert.equal(launches.at(-1)!.resume, undefined)

    // Orbit restarts: processes are gone, the settings and the conversation id are not.
    ui.ws.close()
    await server.close()
    server = await start()
    ui = connect(server.port)
    await ui.opened
    const { snapshot } = await ui.next('snapshot')
    assert.equal(snapshot.panes.find((p) => p.id === lead.id)!.status, 'exited')

    ui.send({ type: 'pane.restart', paneId: lead.id, resume: true })
    const { pane: resumed } = await ui.next('pane.updated', (m) => m.pane.id > copy.id && m.pane.role === 'lead')
    await ui.next('pane.removed', (m) => m.paneId === lead.id)
    assert.deepEqual([resumed.title, resumed.model, resumed.effort], ['Arquiteto', 'opus', 'high'])
    assert.equal(launches.at(-1)!.resume, SESSION)
    assert.equal(launches.at(-1)!.taskPath, undefined)
    await ui.next('event.added', (m) => m.event.title === `#${resumed.id} retomou a conversa de #${lead.id}`)

    ui.send({ type: 'pane.restart', paneId: copy.id, resume: true })
    assert.match((await ui.next('error')).message, /ainda não informou a conversa/)
    ui.send({ type: 'pane.restart', paneId: copy.id, resume: false })
    await ui.next('event.added', (m) => /reabriu #/.test(m.event.title))
    ui.send({ type: 'pane.rename', paneId: resumed.id, title: '   ' })
    assert.match((await ui.next('error', (m) => /nome/.test(m.message))).message, /Dê um nome/)
  } finally {
    ui.ws.close()
    await server.close()
  }
})
