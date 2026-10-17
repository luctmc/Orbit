// Offline, reproducible transport/context comparison. No provider or tokenizer is invoked.
// node scripts/compare-task-continuity.mjs [source-root]
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const source = resolve(process.argv[2] ?? '.')
const root = mkdtempSync(join(tmpdir(), 'orbit-continuity-measure-'))
for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GEMINI_CLI_HOME']) {
  process.env[key] = join(root, key); mkdirSync(process.env[key])
}
const { OrbitCore } = await import(pathToFileURL(join(source, 'packages/sidecar/src/core.ts')))
const { bundledCatalog } = await import(pathToFileURL(join(source, 'packages/sidecar/src/skills.ts')))
const launches = []
const classifierCommands = []
const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
  broadcast: () => {}, run: async cmd => { if (cmd.includes('claude -p')) classifierCommands.push('offline-classifier-command'); return { code: 127, stdout: '', stderr: 'offline' } },
  agentCommand: launch => {
    launches.push({ task: launch.taskPath ? readFileSync(launch.taskPath, 'utf8') : '', role: launch.rolePromptPath ? readFileSync(launch.rolePromptPath, 'utf8') : '' })
    return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }
  } })
try {
  core.setEndpoint('http://127.0.0.1:1')
  core.handle({ type: 'workspace.open', path: root })
  await core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0].id, title: 'Offline comparison', objective: '', allowOriginal: true, mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes[0]
  const marker = 'PRESERVE_THIS_PROJECT_INSTRUCTION'
  // About 4 KiB of required project instructions: retained whole, not summarized.
  const instructions = `${marker}\n${'Keep the complete acceptance criteria and verify the changed files.\n'.repeat(60)}`
  core.store.updateWorkspace(core.store.mission(lead.missionId).workspaceId, { instructions })
  const input = { title: 'Research', task: 'Read the complete assigned source and return the evidence.', activityId: 'research', cli: 'claude', model: null, readOnly: true }
  const first = await core.spawnHelper(lead, input)
  let changedRequestRejected = false
  try { await core.spawnHelper(lead, { ...input, task: 'A different assignment' }) } catch { changedRequestRejected = true }
  core.hookReport(first.pane.id, { hook_event_name: 'SessionStart', session_id: '11111111-2222-4333-8444-555555555555' })
  await core.handle({ type: 'pane.restart', paneId: first.pane.id, resume: true })
  const resumeTaskBytes = Buffer.byteLength(launches.at(-1).task)
  await core.handle({ type: 'pane.restart', paneId: first.pane.id, resume: false })
  const freshRestartPreservedTask = launches.at(-1).task.includes(input.task)
  const pane = core.store.pane(first.pane.id)
  const template = bundledCatalog().find(i => i.cli === 'claude')
  core.catalogItems = Array.from({ length: 40 }, (_, i) => ({ ...template, id: `claude:skill:aaa-${String(i).padStart(2, '0')}`, name: `aaa-${i}`, resource: { ...template.resource, origin: 'personal' } }))
  let cursor, pages = 0, metadataBytes = 0, selectedFound = false
  do {
    const page = core.skillCatalog(pane, cursor)
    pages++; metadataBytes += Buffer.byteLength(JSON.stringify(page))
    selectedFound = page.items.some(i => i.name === 'orbit-build' && i.selected)
    cursor = page.nextCursor
  } while (!selectedFound && cursor)
  await core.changeLead(lead.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
  const takeover = launches.at(-1)
  const takeoverText = `${takeover.role}\n${takeover.task}`
  const newLead = core.store.snapshot().panes.find(p => p.role === 'lead')
  await core.handle({ type: 'mission.create', workspaceId: core.store.mission(newLead.missionId).workspaceId, title: 'Codex-only', objective: '', mode: 'agentica', allowedClis: ['codex'], lead: { cli: 'shell', model: null, title: 'Codex-only coordinator' } })
  const restrictedLead = core.store.snapshot().panes.find(p => p.title === 'Codex-only coordinator')
  await core.spawnHelper(restrictedLead, { title: 'Request', task: 'Handle the pending item carefully', model: null, readOnly: true }).catch(() => null)
  console.log(JSON.stringify({ mode: 'offline-real-Orbit-core-and-PTY-with-stand-in-agent', realProviderCalls: 0, tokens: null, costUsd: null,
    changedRequestRejected, resumeTaskBytes, freshRestartPreservedTask,
    selectedSkill: { eligiblePersonalSkills: 40, pagesUntilSelected: pages, metadataUtf8Bytes: metadataBytes, found: selectedFound },
    takeover: { instructionsUtf8Bytes: Buffer.byteLength(instructions), instructionCopies: takeoverText.split(marker).length - 1, totalPromptUtf8Bytes: Buffer.byteLength(takeoverText), recoveryBriefingIncludesInstructions: core.missionBriefing(newLead.missionId).includes(marker) },
    codexOnlyMission: { prohibitedClassifierCommandsAttempted: classifierCommands.length } }, null, 2))
} finally { await core.shutdown(); rmSync(root, { recursive: true, force: true }) }
