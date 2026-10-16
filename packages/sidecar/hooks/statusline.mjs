// Claude Code status line for Orbit agents: forwards the status JSON (tokens, cost, context,
// account limits) to the sidecar and prints a short line. Never blocks or fails the agent.
const url = process.env.ORBIT_STATUS_URL
const token = process.env.ORBIT_PANE_TOKEN

let body = ''
for await (const chunk of process.stdin) body += chunk

let status = {}
try {
  status = JSON.parse(body)
} catch {
  // print what we can below
}

if (url && token && body) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // sidecar unavailable: the line below still shows
  }
}

const parts = []
if (status.model?.display_name) parts.push(status.model.display_name)
if (status.effort?.level) parts.push(`esforço ${status.effort.level}`)
const ctx = status.context_window
if (ctx && typeof ctx.total_input_tokens === 'number') {
  const total = ctx.total_input_tokens + (ctx.total_output_tokens ?? 0)
  parts.push(`${total >= 1e6 ? `${(total / 1e6).toFixed(1)} mi` : total >= 1e3 ? `${Math.round(total / 1e3)} mil` : total} tokens no contexto`)
}
if (typeof ctx?.used_percentage === 'number') parts.push(`contexto ${ctx.used_percentage}%`)
const five = status.rate_limits?.five_hour
if (five && typeof five.used_percentage === 'number') parts.push(`5h ${five.used_percentage}%`)
process.stdout.write(parts.length ? `◎ Orbit · ${parts.join(' · ')}` : '◎ Orbit')
process.exit(0)
