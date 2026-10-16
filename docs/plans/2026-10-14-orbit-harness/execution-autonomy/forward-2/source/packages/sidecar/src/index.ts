import { homedir } from 'node:os'
import { join } from 'node:path'
import { startServer } from './server.ts'

const token = process.env.ORBIT_TOKEN
if (!token) {
  console.error('[orbit] ORBIT_TOKEN ausente: rode pelo `npm run dev` na raiz ou pelo app.')
  process.exit(1)
}

const server = await startServer({
  port: Number(process.env.ORBIT_PORT ?? 4317),
  token,
  allowedOrigins: (process.env.ORBIT_ALLOWED_ORIGINS ?? 'tauri://localhost,http://tauri.localhost').split(',').map((o) => o.trim()),
  dataDir: process.env.ORBIT_HOME ?? join(homedir(), '.orbit'),
  shell: process.env.SHELL ?? '/bin/zsh',
})
console.error(`[orbit] sidecar ouvindo em ws://127.0.0.1:${server.port}/ws`)
// Machine-readable handshake for the desktop shell, which starts us with ORBIT_PORT=0.
console.log(`ORBIT_READY ${JSON.stringify({ port: server.port })}`)

let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await server.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
// The desktop shell holds our stdin open; if it dies without signalling us, we follow.
if (process.env.ORBIT_EXIT_ON_STDIN_CLOSE === '1') {
  process.stdin.on('end', stop)
  process.stdin.resume()
}
