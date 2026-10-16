// Session-only external-MCP profile. No auth/config writes, model calls, hook/plugin disabling,
// or long-lived wrapper process. execve preserves the PID that Orbit binds to its writer lease.
import { execFileSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'

function executable() {
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    const path = resolve(folder, 'codex')
    try { accessSync(path, constants.X_OK); if (statSync(path).isFile()) return path } catch { /* next PATH entry */ }
  }
  throw new Error('Codex não encontrado no PATH desta execução')
}

function servers(file, config) {
  let rows
  try {
    rows = JSON.parse(execFileSync(file, ['mcp', 'list', '--json', '--disable', 'apps', ...config], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }))
  } catch { throw new Error('Não foi possível conferir os servidores MCP do Codex; nenhum agente foi iniciado. Use o perfil completo ou confira a versão/configuração do CLI.') }
  if (!Array.isArray(rows) || rows.length > 256) throw new Error('Catálogo MCP incompatível; nenhum agente foi iniciado')
  const seen = new Set()
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.name) || typeof row.enabled !== 'boolean' || seen.has(row.name)) throw new Error('Catálogo MCP incompatível ou ambíguo; nenhum agente foi iniciado')
    seen.add(row.name)
  }
  return rows
}

try {
  if (typeof process.execve !== 'function' || process.platform === 'win32') throw new Error('Perfil enxuto Codex indisponível neste runtime; selecione o perfil completo')
  const file = executable(), args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  // These are Orbit's own -c flags, before the literal prompt/session delimiter. Include the
  // mission endpoint in metadata resolution without exposing its bearer token (env only).
  const config = []
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    if (args[i] === '-c') { if (typeof args[i + 1] !== 'string') throw new Error('Configuração de abertura incompleta'); config.push('-c', args[++i]) }
  }
  const disabled = servers(file, config).filter(row => row.name !== 'orbit')
    // Plugin-provided servers may not exist in config.toml. A lone enabled=false creates an
    // invalid transport entry there. Supply an inert complete entry; disabled means it is never
    // executed. No plugin command, URL, headers or env secrets need to be copied into argv.
    .flatMap(row => ['-c', `mcp_servers.${row.name}={enabled=false,command=${JSON.stringify(process.execPath)}}`])
  const overrides = [...disabled, '-c', 'mcp_servers.orbit.enabled=true']
  const checked = servers(file, [...config, ...overrides])
  if (!checked.some(row => row.name === 'orbit' && row.enabled) || checked.some(row => row.name !== 'orbit' && row.enabled)) throw new Error('O perfil MCP não ficou restrito ao Orbit; nenhum agente foi iniciado')
  // Profile flags are global, so they can precede the resume subcommand. Orbit's original
  // flags supply the mission endpoint, sandbox and model, without changing auth or plugins.
  process.execve(file, [file, '--disable', 'apps', ...overrides, ...args], process.env)
} catch (error) {
  // CLI stderr/metadata may contain configuration secrets. Never echo either on failure.
  console.error(`[Orbit] ${error instanceof Error ? error.message : 'Falha no perfil de ferramentas'}`)
  process.exitCode = 1
}
