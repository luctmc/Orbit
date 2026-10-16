// Opt-in native prompt QA. No initial task/role prompt and no message submission.
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

if (!process.argv.includes('--native-no-submit')) {
  console.log('Opt-in: --native-no-submit opens at most two native CLIs in empty temporary workspaces, without initial prompts. Browser Enter/submission is blocked. No repository code is copied.');
  process.exit(0)
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = join(repo, 'docs/plans/2026-10-15-orbit-native-tab-evidence')
mkdirSync(evidence, { recursive: true })
const { startServer } = await import('../packages/sidecar/src/server.ts')
const { buildCommand } = await import('../packages/sidecar/src/command.ts')
const temp = mkdtempSync(join(tmpdir(), 'orbit-native-tab-'))
const token = randomBytes(24).toString('base64url')
const commands = [], inputs = [], panes = []
let openings = 0, closing = false
const server = await startServer({
  port: 4329, token, allowedOrigins: ['http://127.0.0.1:5379'],
  dataDir: join(temp, 'data'), shell: '/bin/zsh', browser: null, scheduler: false,
  run: async () => ({ code: 127, stdout: '', stderr: 'Native prompt QA: automatic probes/updates excluded' }),
  agentCommand: (launch, shell) => {
    if (++openings > 2 || !['claude', 'codex'].includes(launch.cli)) throw new Error('Native prompt QA opening limit')
    const safe = { ...launch, taskPath: undefined, rolePromptPath: undefined, resume: undefined, addDirs: [] }
    const command = buildCommand(safe, shell)
    commands.push({ cli: launch.cli, initialTask: false, rolePrompt: false, resume: false, ...command })
    return command
  },
})
const core = server.core
const originalWrite = core.panes.write.bind(core.panes)
const typed = new Set(), confirmations = new Map()
core.panes.write = (id, data) => {
  const blocked = /[\r\n]/.test(data)
  inputs.push({ id, data, blocked, at: Date.now() })
  if (blocked) return
  if (!data.startsWith('\x1b') && /[^\p{Cc}\p{Cf}\s]/u.test(data)) typed.add(id)
  originalWrite(id, data)
}
core.panes.submit = core.panes.submitWithReceipt = () => {
  inputs.push({ blocked: true, kind: 'submission', at: Date.now() }); return false
}
core.store.saveSettings({ ...core.store.settings(), smartClassify: false })
for (const cli of ['codex', 'claude']) {
  const root = join(temp, cli); mkdirSync(root)
  core.handle({ type: 'workspace.open', path: root })
  const workspace = core.store.snapshot().workspaces.find(w => w.path === root)
  core.handle({ type: 'mission.create', workspaceId: workspace.id, title: `QA Tab · ${cli}`, objective: 'Conferir uma sugestão de planejamento em pasta vazia.', mode: 'agentica', lead: { cli, model: cli === 'codex' ? 'gpt-6-luna' : 'claude-haiku-5-5', effort: 'low', title: `Maestro · ${cli}` } })
  const pane = core.store.snapshot().panes.find(p => p.cwd === root)
  panes.push({ id: pane.id, cli, pid: pane.pid, missionId: pane.missionId, root })
  core.panes.on('data', (id, data) => { if (id === pane.id) appendFileSync(join(evidence, `${cli}-pty.raw`), data) })
}
const metadata = { temp, port: server.port, token, panes, commands, fixturePid: process.pid }
writeFileSync(join(evidence, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ ...metadata, token: '(local metadata only)' }))
const save = async () => {
  for (const pane of panes) {
    const snapshot = await core.panes.snapshot(pane.id)
    writeFileSync(join(evidence, `${pane.cli}-snapshot.json`), JSON.stringify(snapshot, null, 2) + '\n')
  }
  const state = core.store.snapshot()
  writeFileSync(join(evidence, 'audit.json'), JSON.stringify({ at: Date.now(), inputs, commands, panes: state.panes.map(p => ({ id: p.id, status: p.status, usage: p.usage, sessionId: p.sessionId })), notifications: state.missions.flatMap(m => core.store.notifications(m.id)) }, null, 2) + '\n')
}
const close = async () => {
  if (closing) return
  closing = true; clearTimeout(deadline); await save(); await server.close(); process.exit(0)
}
const deadline = setTimeout(close, 12 * 60_000)
const input = createInterface({ input: process.stdin })
input.on('line', async line => {
  try {
    const [action, raw] = line.trim().split(/\s+/), id = Number(raw)
    if (action === 'quit') return await close()
    if (action === 'save') await save()
    if (action === 'ready' && panes.some(p => p.id === id)) core.panes.report(id, 'idle', null)
    // Only after observing an initial trust/onboarding dialog; never after typing any draft.
    if (action === 'confirm' && panes.some(p => p.id === id)) {
      if (typed.has(id) || (confirmations.get(id) ?? 0) >= 2) throw new Error('Startup confirmation refused after input or limit')
      confirmations.set(id, (confirmations.get(id) ?? 0) + 1)
      inputs.push({ id, kind: 'startup-confirmation', data: '\r', at: Date.now() }); originalWrite(id, '\r')
    }
    console.log('fixture:', action, Number.isFinite(id) ? id : '')
  } catch (error) { console.error(error.message) }
})
process.on('SIGTERM', close)
process.on('SIGINT', close)
