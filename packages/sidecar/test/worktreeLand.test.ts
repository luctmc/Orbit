import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { gitSync } from '../src/git.ts'
import { sourceRevision } from '../src/verification.ts'
import { initRepository } from './gitFixture.ts'
import './helpers.ts'

function snapshot(path: string): unknown {
  return readdirSync(path).sort().map(name => {
    const file = join(path, name)
    return [name, statSync(file).isDirectory() ? snapshot(file) : readFileSync(file).toString('base64')]
  })
}
async function fixture(isolated = true, difficulty?: 'simples' | 'normal') {
  const root = mkdtempSync(join(tmpdir(), 'orbit-land-'))
  const work = join(root, 'repo'); mkdirSync(work)
  initRepository(work)
  const origin = join(root, 'origin.git')
  gitSync(root, ['init', '--bare', origin])
  gitSync(work, ['remote', 'add', 'origin', origin])
  const dataDir = join(root, 'data')
  const ran: string[] = []
  const options = { dataDir, shell: '/bin/sh', browser: null, broadcast: () => {},
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }),
    run: async (command: string) => {
      ran.push(command)
      if (command.includes('gh pr create')) return { code: 0, stdout: 'https://github.com/test/repo/pull/1', stderr: '' }
      if (command.includes('gh pr view')) return { code: 0, stdout: JSON.stringify({ number: 1, url: 'https://github.com/test/repo/pull/1', state: 'OPEN', isDraft: false, statusCheckRollup: [] }), stderr: '' }
      return { code: 127, stdout: '', stderr: 'offline' }
    } }
  const core = new OrbitCore(options)
  core.setEndpoint('http://127.0.0.1:1')
  core.handle({ type: 'workspace.open', path: work })
  core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
    title: 'Land', objective: '', mode: 'livre', ...(isolated ? { isolation: 'worktrees' as const } : {}), lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  if (difficulty) await core.spawnHelper(lead, { title: 'Worker', task: 'Read the source file', cli: 'claude', model: null, difficulty })
  else await core.handle({ type: 'pane.spawn', request: { missionId: lead.missionId, role: 'crew', cli: 'claude', model: null, title: 'Worker' } })
  const helper = core.store.snapshot().panes.find(p => p.role === 'crew')!
  const mission = core.store.mission(lead.missionId)!
  if (mission.git) gitSync(mission.git.leadPath, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--allow-empty', '-m', 'Integration'])
  const internal = core as unknown as { createPr(id: string, title: string, body: string, draft: boolean): Promise<unknown>; cleanWorktrees(id: string): void; assign(paneId: number, by: number, replace: boolean): void }
  const deliver = (status: 'done' | 'blocked') => core.store.commitActivityResult(core.store.pane(helper.id)!, { status, summary: 'Checked', evidence: 'synthetic exit 0', details: '', deliveredTo: lead.id, source: sourceRevision([helper.cwd], [dataDir]) }, { title: 'Result', body: 'Checked' }).result
  return { core, internal, lead, helper, mission, origin, dataDir, ran, options, deliver }
}

for (const state of ['working', 'blocked', 'review', 'dirty', 'leader dirty', 'waiting'] as const) test(`PR refuses ${state} without effects`, async () => {
  const f = await fixture()
  try {
    if (state === 'waiting') f.core.store.upsertPane({ ...f.helper, status: 'waiting', attention: 'Preciso de autorização' })
    if (state === 'blocked') f.deliver('blocked')
    if (state === 'review') f.deliver('done')
    if (state === 'dirty') writeFileSync(join(f.helper.cwd, 'draft.txt'), 'pending')
    if (state === 'leader dirty') writeFileSync(join(f.lead.cwd, 'draft.txt'), 'pending')
    f.core.store.flush()
    const before = structuredClone(f.core.store.snapshot())
    const files = snapshot(f.dataDir)
    const calls = f.ran.length
    await assert.rejects(f.internal.createPr(f.mission.id, 'Title', 'Body', false), /[Cc]ópias? pendentes|[Ww]orktree/)
    assert.deepEqual(f.core.store.snapshot(), before)
    assert.deepEqual(snapshot(f.dataDir), files)
    assert.equal(f.ran.length, calls)
    assert.equal(gitSync(f.origin, ['branch', '--list', f.mission.git!.branch]).trim(), '')
    assert.equal(existsSync(join(f.dataDir, 'worktrees', f.mission.id, 'pr-body.md')), false)
  } finally { await f.core.shutdown() }
})

test('working → review → done emits once per transition, never on refresh or restart', async () => {
  const f = await fixture()
  try {
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'working')
    const result = f.deliver('done')
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'review')
    f.core.gitSummary(f.mission.id)
    const inspection = f.core.inspectResult(f.core.store.pane(f.lead.id)!, result.id)
    f.core.verifyResult(f.core.store.pane(f.lead.id)!, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Independent review', checks: [{ command: 'synthetic', exitCode: 0, summary: 'pass' }], criteria: [] })
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'done')
    f.core.gitSummary(f.mission.id)
    assert.equal(f.core.missionEvents(f.mission.id).filter(e => e.kind === 'worktree').length, 2)
    await f.internal.createPr(f.mission.id, 'Title', 'Body', false)
    assert.equal(gitSync(f.origin, ['branch', '--list', f.mission.git!.branch]).trim(), f.mission.git!.branch)
    await f.core.shutdown()
    const restored = new OrbitCore(f.options)
    try {
      restored.gitSummary(f.mission.id)
      restored.gitSummary(f.mission.id)
      assert.equal(restored.missionEvents(f.mission.id).filter(e => e.kind === 'worktree').length, 2)
    } finally { await restored.shutdown() }
  } finally { await f.core.shutdown() }
})

test('cleanup with pending work keeps every copy, records why and never blocks archiving', async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.helper.cwd, 'draft.txt'), 'pending')
    f.core.store.flush()
    f.internal.cleanWorktrees(f.mission.id)
    assert.ok(existsSync(f.helper.cwd))
    assert.ok(existsSync(f.lead.cwd))
    assert.match(f.core.missionEvents(f.mission.id).at(-1)!.body, /Cópias pendentes/)
    f.core.handle({ type: 'mission.archive', missionId: f.mission.id })
    assert.equal(f.core.store.mission(f.mission.id)!.status, 'archived')
    assert.ok(existsSync(f.helper.cwd))
    assert.ok(existsSync(f.lead.cwd))
  } finally { await f.core.shutdown() }
})

test('cleanup without worktrees remains a no-op', async () => {
  const f = await fixture(false)
  try { f.internal.cleanWorktrees(f.mission.id); assert.ok(existsSync(f.helper.cwd)) }
  finally { await f.core.shutdown() }
})

test('delivery without required review can open PR and remove clean copies', async () => {
  const f = await fixture(true, 'simples')
  try {
    f.deliver('done')
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'done')
    await f.internal.createPr(f.mission.id, 'Title', 'Body', false)
    f.internal.cleanWorktrees(f.mission.id)
    assert.equal(existsSync(f.helper.cwd), false)
    assert.equal(existsSync(f.lead.cwd), false)
  } finally { await f.core.shutdown() }
})

test('accepted review becomes stale after a new clean commit', async () => {
  const f = await fixture()
  try {
    const result = f.deliver('done')
    const inspection = f.core.inspectResult(f.core.store.pane(f.lead.id)!, result.id)
    f.core.verifyResult(f.core.store.pane(f.lead.id)!, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Reviewed', checks: [{ command: 'synthetic', exitCode: 0, summary: 'pass' }], criteria: [] })
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'done')
    gitSync(f.helper.cwd, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--allow-empty', '-m', 'Changed HEAD'])
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'review')
    await assert.rejects(f.internal.createPr(f.mission.id, 'Title', 'Body', false), /em revisão/)
  } finally { await f.core.shutdown() }
})

test('a closed pending terminal cannot hide its retained worktree', async () => {
  const f = await fixture()
  try {
    f.deliver('blocked')
    f.core.store.removePane(f.helper.id)
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'blocked')
    await assert.rejects(f.internal.createPr(f.mission.id, 'Title', 'Body', false), /bloqueada/)
    assert.ok(existsSync(f.helper.cwd))
  } finally { await f.core.shutdown() }
})

test('a new managed assignment cannot reuse the previous done result', async () => {
  const f = await fixture(true, 'normal')
  try {
    f.deliver('done')
    f.internal.assign(f.helper.id, f.lead.id, true)
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]!.status, 'working')
    await assert.rejects(f.internal.createPr(f.mission.id, 'Title', 'Body', false), /trabalhando/)
  } finally { await f.core.shutdown() }
})

test('closing a terminal before its first result cannot permit land or hide the copy', async () => {
  const f = await fixture()
  try {
    f.core.store.removePane(f.helper.id)
    assert.equal(f.core.gitSummary(f.mission.id).agents[0]?.status, 'working')
    await assert.rejects(f.internal.createPr(f.mission.id, 'Title', 'Body', false), /trabalhando/)
  } finally { await f.core.shutdown() }
})
