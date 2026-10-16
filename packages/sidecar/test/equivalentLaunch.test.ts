import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { buildCommand, shellQuote, type AgentLaunch } from '../src/command.ts'
import { HOMES, offline, seedRoutingQuota } from './helpers.ts'
import { initRepository } from './gitFixture.ts'

test('equivalents reach the command builder with the task policy intact on either Codex account', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-equivalent-launch-'))
  const launches: AgentLaunch[] = []
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
    broadcast: () => {}, run: offline, agentCommand: launch => {
      launches.push(launch)
      return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }
    } })
  core.setEndpoint('http://127.0.0.1:1')
  try {
    core.handle({ type: 'workspace.open', path: root })
    core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
      title: 'Equivalent launch', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
    const builtin = core.store.accounts().find(a => a.id === 'codex')!
    core.store.saveAccount({ ...builtin, id: 'codex-2', name: 'Codex 2', builtin: false })
    await seedRoutingQuota(core)
    const quota = (id: string, used: number) => core.store.setLimits({ accountId: id,
      cli: id === 'claude' ? 'claude' : 'codex', source: 'provider', updatedAt: Date.now(), plan: null,
      fiveHour: { usedPercent: used, resetsAt: Date.now() + 3600000, windowMinutes: 300 }, weekly: null })
    quota('claude', 100)
    const open = async (kind: string, task: string, model: string, effort: 'low' | 'medium' | 'high', difficulty: 'simples' | 'normal' | 'dificil' = 'normal') => {
      const uniqueTask = `${task} (caso ${launches.length})`
      const result = await core.spawnHelper(lead, { title: uniqueTask, task: uniqueTask, taskTypeId: kind, model: null, difficulty, readOnly: true })
      const launch = launches.at(-1)!
      assert.deepEqual([launch.cli, launch.model, launch.effort], [result.pane.cli, model, effort])
      assert.deepEqual([result.pane.model, result.pane.effort], [model, effort])
      const command = buildCommand(launch, '/bin/sh').args.join(' ')
      assert.ok(command.includes(model), command)
      assert.ok(command.includes(effort), command)
      assert.match(result.receipt.join('\n'), /roteamento por quota válida e compatibilidade/)
      core.handle({ type: 'pane.close', paneId: result.pane.id })
      return result
    }
    for (const [available, full] of [['codex', 'codex-2'], ['codex-2', 'codex']]) {
      quota(available!, 10); quota(full!, 100)
      for (const [kind, task, model, effort, difficulty] of [
        ['operacao', 'Execute o build existente', 'gpt-6-luna', 'low', 'simples'],
        ['bug', 'Corrija o parser', 'gpt-6.1-sol', 'medium', 'normal'],
        ['funcionalidade', 'Implemente frontend React', 'gpt-6.1-sol', 'medium', 'normal'],
        ['funcionalidade', 'Implemente frontend React complexo', 'gpt-6.1-sol', 'high', 'dificil'],
      ] as const) {
        assert.equal((await open(kind, task, model, effort, difficulty)).pane.accountId, available)
      }
    }
    const count = launches.length
    await assert.rejects(core.spawnHelper(lead, { title: 'Motion', task: 'Crie motion com GSAP',
      taskTypeId: 'funcionalidade', model: null, readOnly: true }), /nenhuma conta com quota válida/)
    assert.equal(launches.length, count, 'motion cannot fall back to Codex when Claude quota is full')
    quota('claude', 10)
    const motion = await open('funcionalidade', 'Crie motion com GSAP', 'claude-opus-5-5', 'high')
    assert.equal(motion.pane.cli, 'claude')
  } finally { await core.shutdown() }
})

test('parallel admission distributes live processes across two Codex accounts and Claude with isolated account data', { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-three-accounts-'))
  const data = join(root, 'data')
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  initRepository(workspace)
  const receipts: string[] = []
  const secondHome = join(data, 'accounts/codex-2/codex')
  mkdirSync(secondHome, { recursive: true })
  writeFileSync(join(HOMES.codex, 'auth.json'), 'SYNTHETIC_ACCOUNT_ONE')
  writeFileSync(join(secondHome, 'auth.json'), 'SYNTHETIC_ACCOUNT_TWO')
  const core = new OrbitCore({ dataDir: data, shell: '/bin/sh', browser: null, broadcast: () => {}, run: offline,
    agentCommand: launch => {
      const path = join(root, `process-${receipts.length}.txt`)
      receipts.push(path)
      const profile = launch.cli === 'codex' ? '$CODEX_HOME' : '$CLAUDE_CONFIG_DIR'
      const script = launch.cli === 'shell' ? 'while read line; do :; done' :
        `profile="${profile}"; mkdir -p "$profile/sessions"; printf '%s' "$ORBIT_PANE_ID" > "$profile/sessions/parallel-$ORBIT_PANE_ID"; printf '%s\\n' "$profile" "$$" "$ORBIT_PANE_ID" > ${shellQuote(path)}; while read line; do :; done`
      return { file: '/bin/sh', args: ['-c', script] }
    } })
  core.setEndpoint('http://127.0.0.1:1')
  try {
    core.handle({ type: 'workspace.open', path: workspace })
    core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
      title: 'Three accounts', objective: '', mode: 'agentica', isolation: 'worktrees', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
    const builtin = core.store.accounts().find(a => a.id === 'codex')!
    core.store.saveAccount({ ...builtin, id: 'codex-2', name: 'Codex 2', builtin: false })
    await seedRoutingQuota(core)
    const quota = (id: string, used: number, weekly?: number, unknown = false) => core.store.setLimits({
      accountId: id, cli: id === 'claude' ? 'claude' : 'codex', source: 'provider', updatedAt: Date.now(), plan: null,
      fiveHour: { usedPercent: used, resetsAt: Date.now() + 3600000, windowMinutes: 300 },
      weekly: weekly === undefined ? null : { usedPercent: weekly, resetsAt: Date.now() + 7200000, windowMinutes: 10080 },
      ...(unknown ? { refreshError: 'synthetic unavailable quota' } : {}),
    })
    const request = (id: string) => ({ title: `Parser ${id}`, task: `Corrija o parser ${id}`, taskTypeId: 'bug', model: null })
    // Equal quota: after the first launch, its live-load penalty sends the next one elsewhere.
    const opened = await Promise.all(['one', 'two', 'three'].map(id => core.spawnHelper(lead, request(id))))
    assert.deepEqual(opened.map(r => r.pane.accountId).sort(), ['claude', 'codex', 'codex-2'])
    assert.equal(new Set(opened.map(r => r.pane.pid)).size, 3)
    assert.equal(new Set(opened.map(r => r.pane.cwd)).size, 3, 'writers have separate worktrees')
    for (const { pane } of opened) {
      assert.ok(pane.pid); process.kill(pane.pid!, 0)
      assert.equal(core.store.executionPolicy(pane.id)?.readOnly, false)
      assert.equal(core.store.paneSpec(pane.id)?.accountId, pane.accountId, 'resume retains the actual account')
    }
    const paths = receipts.slice(1)
    const deadline = Date.now() + 2000
    while (paths.some(path => !existsSync(path)) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    const homes = new Map(opened.map(({ pane }, index) => {
      const [home, pid, paneId] = readFileSync(paths[index]!, 'utf8').trim().split('\n')
      assert.equal(Number(pid), pane.pid)
      assert.equal(Number(paneId), pane.id)
      assert.equal(readFileSync(join(home!, `sessions/parallel-${pane.id}`), 'utf8'), String(pane.id))
      return [pane.accountId, home!]
    }))
    assert.equal(homes.get('codex'), HOMES.codex)
    assert.equal(homes.get('codex-2'), secondHome)
    assert.equal(homes.get('claude'), HOMES.claude)
    t.diagnostic(JSON.stringify({ simultaneous: opened.map(({ pane }) => ({ cli: pane.cli,
      accountId: pane.accountId, pid: pane.pid, cwd: pane.cwd, profile: homes.get(pane.accountId),
      model: pane.model, effort: pane.effort })), adapters: 'simulated; real local PTYs, no provider model calls' }))
    assert.equal(readFileSync(join(homes.get('codex')!, 'auth.json'), 'utf8'), 'SYNTHETIC_ACCOUNT_ONE')
    assert.equal(readFileSync(join(homes.get('codex-2')!, 'auth.json'), 'utf8'), 'SYNTHETIC_ACCOUNT_TWO')
    for (const { pane } of opened.filter(r => r.pane.cli === 'codex')) {
      const other = pane.accountId === 'codex' ? secondHome : HOMES.codex
      assert.equal(existsSync(join(other, `sessions/parallel-${pane.id}`)), false)
    }
    quota('codex', 1, 100); quota('codex-2', 1, undefined, true); quota('claude', 10)
    const fallback = await core.spawnHelper(lead, request('weekly-and-unknown'))
    assert.equal(fallback.pane.accountId, 'claude')
    quota('claude', 1, 100)
    const before = receipts.length
    await assert.rejects(core.spawnHelper(lead, request('no-capacity')), /nenhuma conta com quota válida/)
    assert.equal(receipts.length, before)
    const explicit = await core.spawnHelper(lead, { ...request('human-choice'), cli: 'codex',
      model: 'gpt-6.1-sol', effort: 'high' })
    assert.deepEqual([explicit.pane.cli, explicit.pane.model, explicit.pane.effort], ['codex', 'gpt-6.1-sol', 'high'])
  } finally { await core.shutdown() }
})
