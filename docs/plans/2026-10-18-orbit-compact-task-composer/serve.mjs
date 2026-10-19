import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 5377, strictPort: true }, esbuild: { jsx: 'automatic' } })
await server.listen()
console.log('Local-only composer QA: http://127.0.0.1:5377/docs/plans/2026-10-18-orbit-compact-task-composer/fixture.html')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0) })
