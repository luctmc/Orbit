// Synthetic provider responses only: never starts a native login, agent or model.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
const repo = '/Users/lucas/Documents/GitHub/Orbit'
await import(`${repo}/packages/sidecar/test/helpers.ts`)
const { startServer } = await import(`${repo}/packages/sidecar/src/server.ts`)
const temp = mkdtempSync('/private/tmp/orbit-quota-qa-'), token = randomBytes(24).toString('base64url')
let phase = 'first'
const reads = []
const server = await startServer({ port: 4331, token, allowedOrigins: ['http://127.0.0.1:5381'], dataDir: `${temp}/data`, shell: '/bin/sh', browser: null, scheduler: false,
  agentCommand: () => { throw new Error('Agents excluded from quota QA') },
  run: async command => {
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' }
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    if (command.includes('read-codex-limits.mjs')) {
      reads.push({ cli: 'codex', phase, at: Date.now() })
      return phase === 'error' ? { code: 1, stdout: '', stderr: 'Synthetic provider unavailable' } : { code: 0, stdout: JSON.stringify({ rateLimits: { limitId: 'codex', primary: { usedPercent: phase === 'first' ? 53 : 61, resetsAt: Date.now() / 1000 + 3600, windowDurationMins: 300 }, secondary: { usedPercent: phase === 'first' ? 53 : 55, resetsAt: Date.now() / 1000 + 604800, windowDurationMins: 10080 }, planType: 'plus' } }), stderr: '' }
    }
    if (command.includes('claude -p')) {
      reads.push({ cli: 'claude', phase, at: Date.now() })
      return phase === 'first' || phase === 'error' ? { code: 1, stdout: '', stderr: 'Synthetic provider unavailable' } : { code: 0, stdout: JSON.stringify({ result: 'Current session: 0% used · resets Jan 1, 2028 at 1:00am (America/Sao_Paulo)\nCurrent week (all models): 84% used · resets Jan 1, 2028 at 1:00am (America/Sao_Paulo)' }), stderr: '' }
    }
    return { code: 127, stdout: '', stderr: 'CLI probes excluded from quota QA' }
  },
})
server.core.store.setLimits({ accountId: 'claude', cli: 'claude', fiveHour: { usedPercent: 76, resetsAt: Date.now() - 3600000, windowMinutes: 300 }, weekly: { usedPercent: 84, resetsAt: Date.now() + 3600000, windowMinutes: 10080 }, updatedAt: Date.now() - 3600000, plan: null })
const vite = spawn('npm', ['run', 'dev', '-w', '@orbit/desktop', '--', '--host', '127.0.0.1', '--port', '5381', '--strictPort'], { cwd: repo, env: { ...process.env, VITE_ORBIT_PORT: String(server.port), VITE_ORBIT_TOKEN: token }, detached: true, stdio: ['ignore', 'inherit', 'inherit'] })
writeFileSync(`${repo}/docs/plans/2026-10-15-orbit-live-limits-evidence/qa-metadata.json`, JSON.stringify({ temp, pid: process.pid, vitePid: vite.pid }, null, 2))
const save = () => writeFileSync(`${repo}/docs/plans/2026-10-15-orbit-live-limits-evidence/qa-readings.json`, JSON.stringify({ phase, reads, limits: server.core.store.limits() }, null, 2))
let closing = false
const close = async () => { if (closing) return; closing = true; save(); await server.close(); try { process.kill(-vite.pid, 'SIGTERM') } catch {}; process.exit(0) }
createInterface({ input: process.stdin }).on('line', line => { const action = line.trim(); if (action === 'quit') void close(); else { if (['second', 'error'].includes(action)) phase = action; save(); console.log('phase:', phase) } })
process.on('SIGTERM', close); process.on('SIGINT', close)
console.log(JSON.stringify({ temp, pid: process.pid, vitePid: vite.pid }))
