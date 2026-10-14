import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Card, Mission, MissionEvent, Pane } from '@orbit/protocol'
import { missionReport } from '../src/report.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const t0 = Date.UTC(2026, 9, 14, 13, 0)
const mission = { id: 'm', workspaceId: 'w', title: 'Frete', objective: 'Calcular o frete por peso.', mode: 'agentica', squadId: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 152_000, costUsd: 0.42 }, git: null, status: 'active', createdAt: t0, updatedAt: t0 + 30 * 60_000 } as Mission
const pane = (p: Partial<Pane>) => ({ id: 1, missionId: 'm', role: 'lead', squadRole: null, taskType: null, cli: 'claude', model: 'opus', effort: 'high', accountId: null, sessionId: null, branch: null, title: 'Líder', cwd: '/x', status: 'idle', attention: null, deliveredAt: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 100_000, costUsd: 0.3 }, contextPercent: 10, pid: null, exitCode: null, createdAt: t0, ...p }) as Pane
const card = (c: Partial<Card>) => ({ id: String(c.number), missionId: 'm', number: 1, title: 'x', notes: '', column: 'afazer', order: 0, assignee: null, createdBy: 'você', createdAt: t0, updatedAt: t0, ...c }) as Card
const event = (e: Partial<MissionEvent>) => ({ id: Math.random().toString(), missionId: 'm', kind: 'pane.spawned', at: t0, title: 'Agente #1 aberto', body: '', paneId: 1, ...e }) as MissionEvent

test('the report puts the whole mission in Markdown', () => {
  const md = missionReport({
    mission,
    workspace: { id: 'w', name: 'loja', path: '/loja', folders: ['/loja'], lastOpenedAt: 0, instructions: '' },
    squad: undefined,
    panes: [pane({}), pane({ id: 2, role: 'crew', taskType: 'Funcionalidade', cli: 'codex', model: 'gpt-6', effort: 'medium', accountId: 'trab', title: 'Frete', deliveredAt: t0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 52_000, costUsd: null } })],
    accountNames: { trab: 'Codex trabalho' },
    cards: [card({ number: 1, title: 'Calcular por peso', column: 'feito', assignee: 2 }), card({ number: 2, title: 'Tabela de CEP', column: 'afazer' })],
    events: [
      event({}),
      event({ title: 'Agente #3 aberto', body: 'Revisor — Claude · sonnet · ajudante', paneId: 3 }),
      event({ kind: 'pane.waiting', title: '#1 espera você', body: 'Permissão para npm test', at: t0 + 60_000 }),
      event({ kind: 'handoff', title: 'Retorno de #2', body: 'Frete por peso pronto.\n\nArquivos: frete.js', paneId: 2, at: t0 + 20 * 60_000 }),
    ],
    git: null,
    pr: null,
    folders: [{ folder: '/loja', git: true, branch: 'main', ahead: 0, behind: 0, error: null, changes: [{ path: 'frete.js', from: null, kind: 'novo', staged: false, added: 12, removed: 0, by: [2] }] }],
    now: t0 + 31 * 60_000,
  })
  assert.match(md, /^# Frete\n\n\*\*Modo:\*\* Agêntica · \*\*Workspace:\*\* loja · .* · \*\*Duração:\*\* 30 min · \*\*Situação:\*\* em andamento/)
  assert.match(md, /## Objetivo\n\nCalcular o frete por peso\./)
  assert.match(md, /- 3 agentes \(1 Claude, 1 Codex abertos agora, 1 já fechados\)\n- 152 mil tokens \(US\$ 0,42 em preço de API, só do Claude\)\n- 1 de 2 cartões feitos\n- 1 retorno de ajudante/)
  assert.match(md, /- \*\*#3\*\* Revisor — Claude · sonnet · ajudante \(fechado\)/)
  assert.match(md, /- \*\*#2 Frete\*\* \(Funcionalidade\) — Codex, Codex trabalho, gpt-6, esforço medium · 52 mil tokens · entregou/)
  assert.match(md, /### Feito\n\n- \[x\] T1 Calcular por peso \(#2\)/)
  assert.match(md, /### Retorno de #2 · \d\d:\d\d\n\nFrete por peso pronto\.\n\n<details><summary>Detalhes<\/summary>\n\nArquivos: frete\.js/)
  assert.match(md, /- novo `frete\.js` \+12 \(por #2\)/)
  assert.match(md, /## Linha do tempo\n\n- \d\d:\d\d Agente #1 aberto\n- \d\d:\d\d Agente #3 aberto\n- \d\d:\d\d #1 espera você: Permissão para npm test/)
})

test('the UI gets the report and saves it as a .md file', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, browser: null })
  const ui = connect(server.port)
  try {
    await ui.opened
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-')))
    ui.send({ type: 'workspace.open', path: folder })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Relatório', objective: 'Testar o relatório', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Terminal' }, cards: ['Primeiro passo'] })
    const { mission } = await ui.next('mission.updated')
    await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    ui.send({ type: 'report.get', missionId: mission.id })
    const { markdown } = await ui.next('report')
    assert.match(markdown, /^# Relatório/)
    assert.match(markdown, /- \[ \] T1 Primeiro passo/)
    const path = join(folder, 'relatorio.md')
    ui.send({ type: 'report.save', missionId: mission.id, path })
    await ui.next('report.saved', (m) => m.path === path)
    assert.match(readFileSync(path, 'utf8'), /^# Relatório/)
    ui.send({ type: 'report.save', missionId: mission.id, path: join(folder, 'nao.txt') })
    assert.match((await ui.next('files.error')).message, /arquivo \.md/)
  } finally {
    ui.ws.close()
    await server.close()
  }
})
