#!/usr/bin/env node
// `orbit`: Orbit's coordination tools as a terminal command, for agent CLIs that cannot be given
// an MCP server per session. It calls the same tools the MCP server offers, as this agent (the
// pane's own token), so what an agent may do is exactly what its MCP tools allow.
//
//   orbit                      lists the tools
//   orbit <tool> ['<json>']    calls a tool, e.g. orbit handoff_submit '{"summary":"…","status":"done","evidence":"npm test: 9 ok"}'
//   orbit <tool> --key value   the same, one argument per flag (numbers and true/false are converted)
const url = process.env.ORBIT_MCP_URL
const token = process.env.ORBIT_PANE_TOKEN

if (!url || !token) {
  console.error('orbit: este terminal não é um agente do Orbit (faltam ORBIT_MCP_URL e ORBIT_PANE_TOKEN).')
  process.exit(2)
}

let nextId = 1
async function rpc(method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`o Orbit respondeu ${res.status}: ${text.slice(0, 300)}`)
  // A JSON body, or a single SSE event carrying it.
  const json = JSON.parse(text.startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '{}'))
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error))
  return json.result
}

function parseArgs(rest) {
  if (rest.length === 1 && rest[0].trim().startsWith('{')) return JSON.parse(rest[0])
  const args = {}
  for (let i = 0; i < rest.length; i++) {
    const flag = /^--([\w-]+)$/.exec(rest[i])
    if (!flag) throw new Error(`argumento inesperado: ${rest[i]} (use --nome valor ou um JSON)`)
    const raw = rest[i + 1] ?? 'true'
    if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) i++
    args[flag[1].replaceAll('-', '_')] = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw
  }
  return args
}

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'orbit-cli', version: '1' } })
  const [tool, ...rest] = process.argv.slice(2)
  if (!tool || tool === 'help' || tool === '--help') {
    const { tools } = await rpc('tools/list', {})
    console.log('Ferramentas do Orbit (orbit <ferramenta> \'<json>\' ou --nome valor):\n')
    for (const t of tools) {
      const fields = Object.entries(t.inputSchema?.properties ?? {}).map(([k, v]) => `${k}${t.inputSchema?.required?.includes(k) ? '' : '?'}: ${v.type ?? 'valor'}`)
      console.log(`- ${t.name}${fields.length ? ` (${fields.join(', ')})` : ''}\n  ${t.description}`)
    }
    process.exit(0)
  }
  const result = await rpc('tools/call', { name: tool, arguments: parseArgs(rest) })
  const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  if (result.isError) {
    console.error(`orbit: ${text}`)
    process.exit(1)
  }
  console.log(text || '(ok)')
  process.exit(0)
} catch (error) {
  console.error(`orbit: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
