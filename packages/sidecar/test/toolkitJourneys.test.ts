import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentCli, MissionMode } from '@orbit/protocol'
import { OrbitCore } from '../src/core.ts'
import { buildCommand, type AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { TOOLKIT_POLICY_VERSION } from '../src/toolkitPolicy.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const SESSION1 = '11111111-2222-4333-8444-555555555555'
const SESSION2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const count = (s: string) => s.split(TOOLKIT_POLICY_VERSION).length - 1
const text = (path?: string) => path ? readFileSync(path, 'utf8') : ''

function fixture(root = mkdtempSync(join(tmpdir(), 'orbit-toolkit-journey-'))) {
  const launches: Array<{ launch: AgentLaunch; role: string; task: string; command: string }> = []
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null, run: offline, broadcast: () => {},
    agentCommand: launch => {
      launches.push({ launch, role: text(launch.rolePromptPath), task: text(launch.taskPath), command: buildCommand(launch, '/bin/sh').args.join(' ') })
      return { file: '/bin/sh', args: ['-c', 'printf "LOCAL_PTY_READY\\n"; while read line; do :; done'] }
    } })
  core.setEndpoint('http://127.0.0.1:1')
  return { core, root, launches }
}
async function mission(f: ReturnType<typeof fixture>, cli: AgentCli, mode: MissionMode = 'livre', model: string | null = null) {
  await f.core.handle({ type: 'workspace.open', path: f.root })
  const workspace = f.core.store.snapshot().workspaces[0]!
  f.core.store.updateWorkspace(workspace.id, { instructions: 'USER_RULE_PRESERVED; stop caveman; no external services' })
  await f.core.handle({ type: 'mission.create', workspaceId: workspace.id, title: 'Toolkit', objective: '', allowOriginal: true,
    mode, allowedClis: ['codex', 'claude', 'gemini', 'antigravity'], ...(mode === 'squad' ? { squadId: 'caca-bugs' } : {}), lead: { cli, model, title: 'Lead' } })
  return f.core.store.snapshot().panes.find(p => p.role === 'lead')!
}

for (const mode of ['livre', 'agentica', 'squad'] as const) {
  test(`default launch covers ${mode} leaders and helpers, all four CLI adapters and multiple models without selected skills`, async () => {
    const f = fixture()
    try {
      const lead = await mission(f, 'codex', mode, 'gpt-6.1-sol')
      assert.equal(count(f.launches[0]!.role + f.launches[0]!.task), 1)
      await f.core.handle({ type: 'pane.close', paneId: lead.id })
      await (f.core as any).panes.waitForExit(lead.id)
      for (const [cli, model, task] of [
        ['codex', 'gpt-6-luna', null],
        ['codex', 'gpt-6.1-sol', 'Corrija este parser com regressão'],
        ['claude', 'claude-sonnet-5-5', 'Leia o arquivo'],
        ['gemini', 'flash', 'Investigue concorrência e revise contratos'],
        ['antigravity', 'some-supported-model', 'Explique o fluxo'],
      ] as const) {
        await f.core.handle({ type: 'pane.spawn', request: { missionId: lead.missionId, role: 'crew', cli, model, title: cli, task } })
        const { role, task: sentTask, command, launch } = f.launches.at(-1)!
        assert.equal(count(role + sentTask), 1)
        assert.ok(role.includes('USER_RULE_PRESERVED'))
        assert.ok(role.includes('context_read'))
        assert.equal(sentTask, task ?? '')
        assert.ok(command.includes(model))
        assert.ok(command.includes(launch.rolePromptPath!))
        if (cli === 'codex') assert.ok(command.includes('--dangerously-bypass-approvals-and-sandbox'))
        if (cli === 'claude') assert.ok(command.includes('--dangerously-skip-permissions'))
        assert.ok(!role.includes('Do not hardcode commercial model names'), 'long detail remains deferred')
        const opened = f.core.store.snapshot().panes.at(-1)!
        await f.core.handle({ type: 'pane.close', paneId: opened.id })
        await (f.core as any).panes.waitForExit(opened.id)
      }
      const shellCount = f.launches.length
      await f.core.handle({ type: 'pane.spawn', request: { missionId: lead.missionId, role: 'crew', cli: 'shell', model: null, title: 'Shell' } })
      assert.equal(f.launches.length, shellCount + 1)
      assert.equal(f.launches.at(-1)!.role, '')
      assert.equal(f.launches.at(-1)!.task, '')
    } finally { await f.core.shutdown() }
  })
}

test('resume/recovery never repeats a known contract or task; changed sessions and legacy state migrate exactly once', async () => {
  let f = fixture()
  try {
    const pane = await mission(f, 'codex')
    f.core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: SESSION1 }, pane.executionEpoch!)
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
    assert.equal(f.launches.at(-1)!.task, '')
    assert.ok(!f.launches.at(-1)!.command.includes(f.launches.at(-1)!.launch.rolePromptPath!))
    const root = f.root
    await f.core.shutdown()
    f = fixture(root)
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
    assert.equal(f.launches.at(-1)!.task, '', 'dispatch receipt survives removal of ephemeral pane files')
    const current = f.core.store.pane(pane.id)!
    f.core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: SESSION2 }, current.executionEpoch!)
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
    assert.equal(count(f.launches.at(-1)!.task), 1, 'a different native conversation cannot inherit the receipt')
    assert.ok(f.launches.at(-1)!.task.includes('No new task is assigned'))
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
    assert.equal(f.launches.at(-1)!.task, '')
    rmSync(join(root, 'data/toolkit-dispatches', `${pane.id}.json`))
    await (f.core as any).restartPane(pane.id, true, 'Continue apenas a tarefa autorizada')
    assert.equal(count(f.launches.at(-1)!.task), 1)
    assert.ok(f.launches.at(-1)!.task.endsWith('Continue apenas a tarefa autorizada'))
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: false })
    assert.equal(count(f.launches.at(-1)!.role + f.launches.at(-1)!.task), 1, 'fresh reopen carries one new role contract')
  } finally { await f.core.shutdown() }
})

test('recovery briefing retrieves policy and guides after compaction; leader transfer sends one launch contract', async () => {
  const f = fixture()
  try {
    const pane = await mission(f, 'claude', 'agentica')
    const briefing = f.core.missionBriefing(pane.missionId)
    assert.equal(count(briefing), 1)
    const hash = /Context toolkit-coordination-recovery:.*?"sha256":"([a-f0-9]+)"/.exec(briefing)![1]!
    assert.ok(f.core.readContext(f.core.store.pane(pane.id)!, hash).text.includes('Old handoffs are context'))
    await f.core.changeLead(pane.missionId, { kind: 'new', cli: 'gemini', model: 'flash', effort: null, accountId: null })
    assert.equal(count(f.launches.at(-1)!.role + f.launches.at(-1)!.task), 1)
    assert.ok(f.launches.at(-1)!.task.includes('USER_RULE_PRESERVED') === false, 'user instructions already in role')
  } finally { await f.core.shutdown() }
})

for (const cli of ['codex', 'claude', 'gemini', 'antigravity'] as const) {
  test(`${cli}: native resume keeps current policy once; missing receipt migrates through the adapter's actual prompt route`, async () => {
    const f = fixture()
    try {
      const pane = await mission(f, cli)
      f.core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: SESSION1 }, pane.executionEpoch!)
      await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
      const normal = f.launches.at(-1)!
      assert.equal(normal.task, '')
      assert.equal(normal.command.includes(normal.launch.rolePromptPath!), cli === 'claude')
      rmSync(join(f.root, 'data/toolkit-dispatches', `${pane.id}.json`))
      await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
      const legacy = f.launches.at(-1)!
      const effective = (legacy.command.includes(legacy.launch.rolePromptPath!) ? legacy.role : '') + legacy.task
      assert.equal(count(effective), 1)
      assert.equal(count(legacy.task), cli === 'claude' ? 0 : 1)
      const context = JSON.parse(readFileSync(join(f.root, 'data/panes', String(pane.id), 'context.json'), 'utf8'))
      assert.equal(context.toolkit.delivery, cli === 'claude' ? 'role' : 'session-upgrade')
      assert.equal(context.toolkit.compliance, 'not-observed')
      await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
      assert.equal(f.launches.at(-1)!.task, '')
    } finally { await f.core.shutdown() }
  })
}

test('WebSocket/core/real PTY runs generated CLI arguments with one policy; later input does not duplicate it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-toolkit-wire-'))
  const argvPath = join(root, 'argv.json')
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: join(root, 'data'), shell: '/bin/sh',
    run: offline, browser: null, scheduler: false, agentCommand: launch => {
      // A local deterministic CLI fixture, executed through the real command builder and PTY.
      writeFileSync(join(launch.binDir!, 'codex'), `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(argvPath)},JSON.stringify(process.argv.slice(2)));console.log('TOOLKIT_ARGV_READY');process.stdin.on('data',b=>console.log('INPUT_SEEN:'+b.toString()));`, { mode: 0o700 })
      launch.toolProfile = 'inherit'
      return buildCommand(launch, '/bin/sh')
    } })
  const client = connect(server.port)
  try {
    await client.opened
    client.send({ type: 'workspace.open', path: root })
    const { workspace } = await client.next('workspace.updated')
    client.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Wire', objective: '', allowOriginal: true,
      mode: 'livre', lead: { cli: 'codex', model: 'gpt-6-luna', title: '' } })
    const { pane } = await client.next('pane.updated', m => m.pane.role === 'lead')
    await client.next('pane.data', m => m.paneId === pane.id && m.data.includes('TOOLKIT_ARGV_READY'))
    assert.equal(existsSync(argvPath), true)
    const args = JSON.parse(readFileSync(argvPath, 'utf8')) as string[]
    assert.equal(count(args.join('\n')), 1)
    assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'))
    assert.ok(args.includes('gpt-6-luna'))
    client.send({ type: 'pane.submit', requestId: 'toolkit-simple', paneId: pane.id, text: 'Explique sem alterar arquivos', allowOriginal: true })
    await client.next('pane.submitted', m => m.requestId === 'toolkit-simple')
    await client.next('pane.data', m => m.paneId === pane.id && m.data.includes('INPUT_SEEN:'))
    assert.equal(count(readFileSync(argvPath, 'utf8')), 1, 'continuation cannot mutate or append launch contract')
  } finally { client.ws.close(); await server.close() }
})
