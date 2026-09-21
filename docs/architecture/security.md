# Security Threat Model

Structured against **OWASP Top 10 for Agentic Applications (ASI01–ASI10, released
2025-12-09)**, which targets the agent-as-actor — goals, memory, tools, delegated
authority — rather than the model-as-text-generator that the older LLM Top 10 covers. This
is the right frame for Orbit: high privilege on a personal machine, driven by three
external, fast-moving agent CLIs it does not control.

## The trust boundary

```
TRUSTED    Orbit policy, user preferences, signed Orbit code
USER       typed/spoken input in the Orbit UI  ← the ONLY source of intent
UNTRUSTED  file contents · web pages · terminal output · agent output ·
           window titles · clipboard · MCP server output · filenames · git metadata
```

**Untrusted content can never become intent.** It may become data a tool operates *on*, but
never an instruction that selects a tool or grants a permission. Concretely:

- Agent output is parsed as protocol (stream-json events, JSON-RPC responses), never
  obeyed as a natural-language instruction.
- Text arriving from an untrusted source and routed through Jev goes into an
  *advisory-only* request — its questions can influence a risk-escalation signal, never a
  tool choice or a permission outcome (see [jev.md](./jev.md)).
- Every tool call carries its **proposer** (`orbit` or a specific provider id) in the audit
  trail, so "what caused this?" always has an answer.

## Threats and mitigations

| # | Threat | Mitigation |
| --- | --- | --- |
| 1 | **Prompt injection → tool misuse** (ASI01/02: goal hijack, tool misuse) | The Permission Engine adjudicates every call regardless of who proposed it; risk is computed from resolved arguments, never from a model's self-report; `CRITICAL` always prompts in every mode |
| 2 | **Injection via Jev's own input** | Documented weakness (`jev-1.13` does not treat state as hostile). Untrusted content is isolated into advisory-only requests; Jev signals may only *escalate* risk, never lower it |
| 3 | **Shell injection** | `shell.execute` takes argv arrays only, never a shell string; allowlist-driven; no interpolation |
| 4 | **Path traversal / symlink escape** | canonicalize → resolve realpath → verify inside an approved root **after** resolution; a path crossing a symlink out of scope is rejected |
| 5 | **Credential exposure** | Orbit stores no provider credentials at all (see [ADR-0004](../adr/0004-no-credential-storage.md)); child process environments are explicitly allowlisted, never inherited wholesale; the renderer never receives a secret; audit redaction is by pattern *and* by field allowlist |
| 6 | **Clipboard secrets** | Content is classified (`detectPatterns`), not read, unless the user's instruction plainly implies it; Windows writes set `ExcludeClipboardContentFromMonitorProcessing` for anything sensitive |
| 7 | **Env var leakage to child processes** | Explicit allowlist per child, never inheritance — this specifically defeats the case where an inherited `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` silently overrides a per-account credential store |
| 8 | **Compromised / poisoned MCP server** (agentic tool-poisoning risk) | MCP tool output is treated as untrusted; Orbit's own tool config is injected with `--strict-mcp-config`; third-party MCP servers are off by default and require separate, explicit consent |
| 9 | **Privilege escalation** | Orbit's main process never runs elevated; the privileged helper exposes an enumerated verb list only — never "run arbitrary command as root"; the XPC client's code signature is validated against a pinned Team ID |
| 10 | **Renderer compromise → RCE** | `contextIsolation` + `sandbox` + no Node in the renderer; every IPC message is schema-validated in main as if it were an untrusted HTTP request — a named architectural workstream, not a code-review checkbox, because the main process is by design a process-spawning engine |
| 11 | **Memory poisoning** | Inferred memory entries expire and are user-visible/editable; an inferred entry never grants a permission on its own |
| 12 | **Malicious or corrupted update** | Signed releases on both platforms; private signing keys escrowed properly (losing the Electron/Tauri updater key permanently bricks updates); staged rollout once the updater ships |
| 13 | **Agent exceeding intended scope** | Per-task tool allowlist, step budgets, provider-level turn/budget caps (`--max-turns`, `--max-budget-usd`), wall-clock timeouts |
| 14 | **Cross-provider data leak on fallback** | Fallback requires an explicit, separate setting; private-marked scopes never fall back regardless of that setting |

## Licensing risk (treated here because it is a real operational risk, not a footnote)

- **Antigravity's ToS states third-party access is a violation**, with account suspension
  as the consequence — landing on the *user's* Google account, not on Orbit. Mitigation:
  opt-in, explicitly disclosed, never the default or a silent fallback target.
- **Anthropic's Agent SDK terms restrict offering claude.ai login/rate limits** in a
  third-party product without prior approval. Mitigation: API key is the default,
  documented path; reuse of an existing subscription login is a grey area pending written
  clarification from Anthropic before it becomes a headline feature.
- **Codex has no explicit statement either way.** Silence is treated as *not* permission;
  API key remains the default.

## Explicit non-goals

Orbit does not defend against: a compromised operating system, a malicious provider CLI
binary itself (as opposed to its untrusted output), or a user who deliberately grants
`EXTENDED` autonomy over their entire home directory. These are documented here rather than
silently assumed away.
