// Claude Code hook: forwards the event payload to the Orbit sidecar so the pane's status is real.
// It must never block or fail the agent, so every error is swallowed and it always exits 0.
const url = process.env.ORBIT_HOOK_URL
const token = process.env.ORBIT_PANE_TOKEN

if (url && token) {
  let body = ''
  for await (const chunk of process.stdin) body += chunk
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body || '{}',
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // sidecar unavailable: the pane falls back to output-based status
  }
}
process.exit(0)
