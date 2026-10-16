// Local UI fixture: synthetic accounts, no native logins, tokens or model calls.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
const repo = '/Users/lucas/Documents/GitHub/Orbit'
await import(`${repo}/packages/sidecar/test/helpers.ts`)
const { startServer } = await import(`${repo}/packages/sidecar/src/server.ts`)
const temp = mkdtempSync('/private/tmp/orbit-accounts-qa-'), token = randomBytes(24).toString('base64url')
const server = await startServer({ port: 4330, token, allowedOrigins: ['http://127.0.0.1:5380'], dataDir: join(temp, 'data'), shell: '/bin/sh', browser: null, scheduler: false,
  run: async command => {
    const extra = command.startsWith('CLAUDE_CONFIG_DIR=') || command.startsWith('CODEX_HOME=')
    if (command.endsWith('claude auth status')) return { code: extra ? 1 : 0, stdout: JSON.stringify({ loggedIn: !extra, authMethod: extra ? 'none' : 'claude.ai', email: extra ? null : 'qa@example.invalid' }), stderr: '' }
    if (command.endsWith('codex login status')) return { code: extra ? 1 : 0, stdout: extra ? 'Not logged in' : 'Logged in using ChatGPT', stderr: '' }
    return { code: 127, stdout: '', stderr: 'Synthetic UI QA: CLI probe excluded' }
  },
  agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'printf "Login simulado para QA local. Nenhuma autenticação real iniciada.\\n"; exec /bin/sh'] }),
})
const vite = spawn('npm', ['run', 'dev', '-w', '@orbit/desktop', '--', '--host', '127.0.0.1', '--port', '5380', '--strictPort'], { cwd: repo, env: { ...process.env, VITE_ORBIT_PORT: String(server.port), VITE_ORBIT_TOKEN: token }, stdio: ['ignore', 'inherit', 'inherit'], detached: true })
writeFileSync(join(repo, 'docs/plans/2026-10-15-orbit-install-evidence/accounts-qa-metadata.json'), JSON.stringify({ temp, fixturePid: process.pid, vitePid: vite.pid, port: server.port }, null, 2) + '\n')
console.log(JSON.stringify({ temp, port: server.port, fixturePid: process.pid, vitePid: vite.pid }))
let closing = false
const close = async () => {
  if (closing) return
  closing = true; await server.close()
  try { process.kill(-vite.pid, 'SIGTERM') } catch {}
  process.exit(0)
}
createInterface({ input: process.stdin }).on('line', line => { if (line.trim() === 'quit') void close() })
process.on('SIGTERM', close); process.on('SIGINT', close)
