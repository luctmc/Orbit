import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

test('workspace instructions reach every agent, and templates start missions with their cards', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const fake = (_launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `exec ${shell}`] })
  const start = () => startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, agentCommand: fake, browser: null })
  let server = await start()
  let ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    assert.equal(workspace.instructions, '')
    ui.send({ type: 'workspace.update', workspaceId: workspace.id, instructions: '  Rode npm test antes de entregar.\nNunca mexa em migrations/.  ' })
    await ui.next('workspace.updated', (m) => m.workspace.instructions === 'Rode npm test antes de entregar.\nNunca mexa em migrations/.')

    // A template: validated, then saved.
    const base = { name: 'Correção com testes', workspaceId: workspace.id, title: 'Corrigir bug', objective: 'Reproduzir, corrigir e cobrir com teste.', mode: 'agentica' as const, squadId: null, isolation: null, lead: { cli: 'claude' as const, model: 'opus', effort: 'high' as const }, cards: [' Reproduzir ', 'Corrigir', '', 'Cobrir com teste'] }
    ui.send({ type: 'template.save', template: { ...base, lead: { ...base.lead, model: 'opus; rm' } } })
    assert.match((await ui.next('error')).message, /Modelo inválido/)
    ui.send({ type: 'template.save', template: { ...base, mode: 'squad' } })
    assert.match((await ui.next('error', (m) => /squad/.test(m.message))).message, /squad que exista/)
    ui.send({ type: 'template.save', template: base })
    const { template } = await ui.next('template.updated')
    assert.deepEqual(template.cards, ['Reproduzir', 'Corrigir', 'Cobrir com teste'])
    ui.send({ type: 'template.save', template: { ...template, name: 'Correção com teste' } })
    const renamed = await ui.next('template.updated', (m) => m.template.name === 'Correção com teste')
    assert.deepEqual([renamed.template.id, renamed.template.createdAt], [template.id, template.createdAt], 'saving again keeps the template')

    // A mission from it: the cards are on the board, the lead gets the workspace instructions.
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: template.title, objective: template.objective, mode: template.mode, squadId: null, lead: { cli: 'claude', model: 'opus', effort: 'high', title: '' }, cards: template.cards })
    const { mission } = await ui.next('mission.updated')
    for (const title of template.cards) await ui.next('card.updated', (m) => m.card.missionId === mission.id && m.card.title === title && m.card.createdBy === 'modelo')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    const role = readFileSync(join(dataDir, 'panes', String(lead.id), 'role.md'), 'utf8')
    assert.match(role, /This workspace's instructions \(written by the user; they apply to every agent\):\nRode npm test antes de entregar\.\nNunca mexa em migrations\//)

    // Templates survive a restart, and can be deleted.
    ui.ws.close()
    await server.close()
    server = await start()
    ui = connect(server.port)
    const { snapshot } = await ui.next('snapshot')
    assert.deepEqual(snapshot.templates.map((t) => t.name), ['Correção com teste'])
    assert.equal(snapshot.workspaces[0]!.instructions, 'Rode npm test antes de entregar.\nNunca mexa em migrations/.')
    ui.send({ type: 'template.delete', templateId: template.id })
    await ui.next('template.removed', (m) => m.templateId === template.id)
  } finally {
    ui.ws.close()
    await server.close()
  }
})
