// Claude Code hook: forwards the event payload to the Orbit sidecar so the pane's status is real.
// For PreToolUse the sidecar may answer with a decision (a skill, subagent or MCP server switched
// off in Orbit), which is printed for Claude Code to apply. Otherwise it never blocks or fails the
// agent: errors are swallowed and it always exits 0.
const url = process.env.ORBIT_HOOK_URL
const token = process.env.ORBIT_PANE_TOKEN

if (url && token) {
  let body = ''
  for await (const chunk of process.stdin) body += chunk
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body || '{}',
      signal: AbortSignal.timeout(1500),
    })
    // Writes to a pipe are asynchronous on macOS: wait for it before exiting, or the decision is lost.
    if (res.status === 200) {
      const decision = await res.text()
      await new Promise((resolve) => process.stdout.write(decision, resolve))
    }
  } catch {
    // sidecar unavailable: the pane falls back to output-based status
  }
}
process.exit(0)
