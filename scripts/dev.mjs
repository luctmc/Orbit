// Starts the sidecar and the Vite UI together, sharing a fresh per-run auth token.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const token = randomBytes(24).toString('base64url')
const port = process.env.ORBIT_PORT ?? '4317'
const uiPort = process.env.ORBIT_UI_PORT ?? '5273'
const env = {
  ...process.env,
  ORBIT_TOKEN: token,
  ORBIT_PORT: port,
  ORBIT_ALLOWED_ORIGINS: `http://localhost:${uiPort},http://127.0.0.1:${uiPort}`,
  VITE_ORBIT_TOKEN: token,
  VITE_ORBIT_PORT: port,
}

const children = [
  spawn('npm', ['run', 'dev', '-w', '@orbit/sidecar'], { stdio: 'inherit', env }),
  spawn('npm', ['run', 'dev', '-w', '@orbit/desktop', '--', '--port', uiPort, '--strictPort'], { stdio: 'inherit', env }),
]

const stop = () => {
  for (const child of children) child.kill('SIGTERM')
  process.exit()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of children) child.on('exit', (code) => code && stop())
