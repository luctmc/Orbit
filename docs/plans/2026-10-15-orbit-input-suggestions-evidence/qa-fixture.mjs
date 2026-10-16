// Local-only UI/PTY fixture. Never launches a native CLI or a model.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const repo = '/Users/lucas/Documents/GitHub/Orbit'
await import(`${repo}/packages/sidecar/test/helpers.ts`)
const { startServer } = await import(`${repo}/packages/sidecar/src/server.ts`)
const temp = mkdtempSync(join(tmpdir(), 'orbit-prediction-qa-')), root = join(temp, 'workspace')
mkdirSync(root); writeFileSync(join(root, 'source.ts'), 'export const value = 1\n')
const echo = join(temp, 'prompt.mjs'), log = join(temp, 'submissions.jsonl')
writeFileSync(log, '')
writeFileSync(echo, `import {appendFileSync} from 'node:fs';
process.stdin.setRawMode(true); process.stdin.resume(); let draft='';
process.stdout.write('Terminal simulado para QA local, sem modelos.\\r\\n❯ ');
process.stdin.on('data', chunk=>{ const text=chunk.toString(); for(const char of text){
 if(char==='\\r'||char==='\\n'){ appendFileSync(${JSON.stringify(log)},JSON.stringify({text:draft,at:Date.now()})+'\\n'); draft=''; process.stdout.write('\\r\\n❯ '); }
 else if(char==='\\u0003'){draft='';process.stdout.write('^C\\r\\n❯ ');}
 else if(char==='\\u007f'){if(draft){draft=Array.from(draft).slice(0,-1).join('');process.stdout.write('\\b \\b');}}
 else if(char>=' '){draft+=char;process.stdout.write(char);}
}});
`)
const server = await startServer({ port: 4328, token: 'orbit-prediction-synthetic-qa', allowedOrigins: ['http://127.0.0.1:5378'], dataDir: join(temp, 'data'), shell: '/bin/sh', browser: null, scheduler: false, run: async () => ({ code: 127, stdout: '', stderr: 'offline synthetic UI fixture' }), agentCommand: () => ({ file: process.execPath, args: [echo] }) })
const core = server.core
core.store.saveSettings({ ...core.store.settings(), smartClassify: false })
core.handle({ type: 'workspace.open', path: root })
core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0].id, title: 'QA · sugestões do maestro', objective: 'Corrigir o cálculo de frete e revisar a entrega.', mode: 'agentica', lead: { cli: 'codex', model: null, title: 'Maestro de teste' } })
const lead = core.store.snapshot().panes.find(p => p.role === 'lead')
const worker = (await core.spawnHelper(lead, { cli: 'claude', model: null, title: 'Corrigir cálculo de frete', task: 'Synthetic local UI fixture only', accept: ['Cálculo deve passar pelos testes sintéticos.'] })).pane
core.handoff(worker, { summary: 'Fixture de entrega para revisar.', evidence: 'Evidência sintética para QA visual, não executada por modelo.', criteria: [{ item: 1, met: true, how: 'Somente fixture local.' }] })
const notice = core.store.notifications(lead.missionId).find(n => n.recipient.kind === 'lead')
core.panes.report(lead.id, 'idle', null)
// ACK requires an actual dispatch receipt, even in a simulated-CLI fixture.
if (notice) {
  const deadline = Date.now() + 6000
  while (!core.store.notifications(lead.missionId).find(n => n.id === notice.id)?.deliveries.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  try { core.acknowledgeDelivery(core.store.pane(lead.id), notice.id) }
  catch (error) { await server.close(); throw error }
}
const metadata = { temp, root, port: server.port, missionId: lead.missionId, leadId: lead.id, workerId: worker.id, submissions: log }
writeFileSync(`${repo}/docs/plans/2026-10-15-orbit-input-suggestions-evidence/qa-metadata.json`, JSON.stringify(metadata, null, 2) + '\n')
console.log(JSON.stringify(metadata))
process.stdin.setEncoding('utf8')
process.stdin.on('data', async input => {
  const command = input.trim()
  if (command === 'quit') { await server.close(); process.exit(0) }
  else if (command === 'waiting') core.askUser(core.store.pane(lead.id), 'Decisão sintética pendente: revisar antes de continuar?', ['Revisar'])
  else if (command === 'idle') core.panes.report(lead.id, 'idle', null)
  else if (command === 'running') core.panes.report(lead.id, 'running', null)
  else if (command === 'submissions') console.log(readFileSync(log, 'utf8'))
  console.log('fixture:', command)
})
process.on('SIGTERM', async () => { await server.close(); process.exit(0) })
