# Provider Architecture

Orbit supports three agent providers today — Claude Code, Codex, and Google Antigravity —
behind one abstraction, extensible to future providers (local models, OpenRouter, Cursor,
etc.) without touching call sites elsewhere in the codebase.

## The `AgentProvider` interface

```ts
interface AgentProvider {
  readonly id: 'claude' | 'codex' | 'antigravity' | string;

  detect(): Promise<ProviderStatus>;                     // installed? version? authenticated?
  probeCapabilities(): Promise<ProviderCapabilities>;    // run at startup, never cached across versions

  listAccounts(): Promise<AccountProfile[]>;
  createAccount(label: string): Promise<AccountProfile>; // provisions an isolated config dir
  beginAuth(accountId: string): Promise<AuthHandoff>;    // hands off to the provider's OWN flow
  accountHealth(accountId: string): Promise<AccountHealth>;

  discoverModels(accountId: string): Promise<OrbitModelDescriptor[]>;

  startSession(req: SessionRequest): Promise<AgentSession>;
  resume(sessionRef: ProviderSessionRef, req: SessionRequest): Promise<AgentSession>;
  interrupt(sessionId: string): Promise<void>;  // graceful turn end, NOT SIGTERM
  cancel(sessionId: string): Promise<void>;
}

interface ProviderCapabilities {
  streaming: 'tokens' | 'messages' | 'none';
  toolInterception: 'none' | 'approve-deny' | 'approve-deny-rewrite';
  multiAccount: 'isolated' | 'single-only';
  effortAxis: 'per-model' | 'global' | 'none';
  resume: 'by-id' | 'last-only' | 'none';
  mcpInjection: 'per-invocation' | 'config-file' | 'none';
  structuredOutput: boolean;
  capabilityProbeSource: 'runtime-api' | 'help-parse';
  tosPosture: 'ok' | 'api-key-only' | 'restricted-opt-in';
}
```

**Why a capability probe at startup, not a cached version check:** all three provider CLIs
proved volatile during research. `agy` self-updated from 1.2.0 to 1.2.7 mid-session,
silently changing a flag default; Codex's exec event schema broke downstream parsers across
a minor version (openai/codex#41216 `[DOCUMENTED]`); Claude Code ships a `capabilities[]`
array on `system/init` specifically so hosts can stop comparing version strings
`[DOCUMENTED]`. Orbit follows that lead everywhere.

## Capability matrix

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Local version observed | 2.1.278 `[VERIFIED-CLI]` | 0.154.0 `[VERIFIED-CLI]` | 1.2.0→1.2.7 (self-updated) `[VERIFIED-CLI]` |
| Transport | stdio stream-json + control channel `[VERIFIED-CLI]` | **JSON-RPC 2.0 app-server** `[VERIFIED-CLI]` | NDJSON stdio `[VERIFIED-CLI]` |
| Tool interception | `can_use_tool` control request + `PreToolUse` hook `[VERIFIED-BIN]/[DOCUMENTED]` | 4 `requestApproval` methods `[VERIFIED-CLI]` | `PreToolUse` hook `[DOCUMENTED]` |
| **Can rewrite the proposed action** | ✅ `updatedInput` `[VERIFIED-BIN]` | ✅ `acceptWithExecpolicyAmendment` `[VERIFIED-CLI]` | ❌ allow/deny/ask only |
| Multi-account | ✅ `CLAUDE_CONFIG_DIR`, Keychain keyed per dir `[DOCUMENTED]` | ✅ `CODEX_HOME`, pin `cli_auth_credentials_store="file"` `[VERIFIED-CLI]` | ❌ **none — no analogue exists** `[VERIFIED-CLI]` |
| Model discovery | control `list_models` — internal, unstable `[VERIFIED-BIN]` | `model/list` / `codex debug models` — dynamic, etag-cached `[VERIFIED-CLI]` | `agy models` — needs auth; `--output-format json` broken in 1.2.7 `[VERIFIED-CLI]` |
| Effort axis | `--effort low..max`, **per-model support varies** `[VERIFIED-CLI]` | per-model `supported_reasoning_levels` `[VERIFIED-CLI]` | `--effort low/medium/high`, sometimes baked into the model slug `[VERIFIED-CLI]` |
| MCP injection | `--mcp-config` + `--strict-mcp-config` `[VERIFIED-CLI]` | `-c mcp_servers.orbit.*` `[VERIFIED-CLI]` | config file only `[DOCUMENTED]` |
| Protocol type safety | hand-written from docs | ✅ **`codex app-server generate-ts`** codegen `[VERIFIED-CLI]` | hand-written, `--help`-probed |
| ToS posture | **API key only** (SDK terms restrict subscription login) `[DOCUMENTED]` | unresolved either way; default to API key `[DOCUMENTED]` | **opt-in, disclosed** — ToS explicitly restricts third-party access `[DOCUMENTED]` |

## Claude Code

- Headless: `claude -p --input-format stream-json --output-format stream-json --verbose
  --session-id <uuid> --permission-mode manual --permission-prompts host
  --strict-mcp-config --mcp-config '<json>' --settings '<json>' --model <alias> --effort <level>`.
- **Orbit pre-generates the session UUID** and passes `--session-id`. Transcripts are at
  `~/.claude/projects/<mangled-cwd>/<session-id>.jsonl`, but docs warn the line format is
  internal and changes between versions — Orbit parses the stream, never the transcript file.
- **Interception**: auto-approved calls never reach the `can_use_tool` callback — only a
  `PreToolUse` hook runs on every call in every mode. Orbit installs both: the control
  channel for UX and input rewriting, the hook as the actual gate.
- **Process lifecycle**: SIGTERM → exit 143, the in-progress turn is lost with no result
  recorded. Always send SIGINT (or a control `interrupt`) first, then SIGTERM.
- **Multi-account is solved**: `CLAUDE_CONFIG_DIR` isolates the entire config tree, and the
  macOS Keychain entry is keyed to the config dir itself, so two processes with different
  `CLAUDE_CONFIG_DIR` values never collide.
- **Branding constraint**: Orbit's UI may say "Claude Agent" or "Powered by Claude", never
  "Claude Code" or "Claude Code Agent", and may not mimic its visual identity.

## Codex

- Build on **`codex app-server`** (JSON-RPC 2.0 over stdio/unix/ws), not `codex exec`.
  `codex exec --json` has no approval-request event in its `ThreadEvent` enum and cannot
  hand adjudication to an external host.
- **Codegen the protocol as a build step**: `codex app-server generate-ts --out <dir>` and
  `generate-json-schema` emit authoritative, version-matched types from the installed
  binary. Never hand-write these types.
- **Approvals**: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
  `item/permissions/requestApproval`, `item/tool/requestUserInput`,
  `mcpServer/elicitation/request`. Responses: `accept | acceptForSession | decline | cancel`,
  plus `acceptWithExecpolicyAmendment` to **rewrite the command before it runs**.
  A client that replies `-32601 Method not found` to inbound requests works fine until the
  first approval, then deadlocks — the JSON-RPC layer must be genuinely bidirectional.
- **Multi-account**: `CODEX_HOME` relocates everything. A working reference implementation
  already exists on the dev machine (`~/Library/Application Support/orca/codex-accounts/`).
  Pin `cli_auth_credentials_store = "file"` per account and scrub
  `OPENAI_API_KEY`/`CODEX_API_KEY`/`CODEX_ACCESS_TOKEN`/`CODEX_AUTH` from the child
  environment, since inherited env vars override the per-account `auth.json`.
- **Profiles are settings-only**, not identity: a profile is `$CODEX_HOME/<name>.config.toml`
  overlaid on the base config, and credential-redirecting keys are explicitly excluded from
  what a profile can override.
- **Sandbox default**: `sandbox_mode = "workspace-write"`, `approval_policy = "on-request"`.
  Never ship `--dangerously-bypass-approvals-and-sandbox`.

## Antigravity (`agy`)

- Headless: `agy -p "<prompt>" --output-format stream-json --input-format stream-json`.
  Purpose-built for driving — the changelog literally says `--input-format stream-json`
  exists "so a driver can keep a session open."
- **⚠️ Two hard constraints govern how this ships:**
  1. **ToS**: *"Using third party software, tools, or services to access Antigravity is a
     violation of our Terms of Service,"* with account suspension as the stated
     consequence. The risk lands on the user's Google account, not on Orbit. → ships as an
     **opt-in, explicitly disclosed, second-tier provider**, never the default.
  2. **The binary self-updates with no pin.** No `--no-update` flag exists;
     `agy update --help` prints an empty flag list. Orbit must capability-probe
     `agy --help` at every startup and degrade loudly on drift, not assume a flag set.
- **Interception**: `PreToolUse` hook returning `allow | deny | ask | force_ask`. Under
  headless `-p` there is no TUI, so `ask`/`force_ask` soft-denies — Orbit's hook must return
  a real decision.
- **Multi-account is not supported and Orbit does not invent a workaround.** No
  `CLAUDE_CONFIG_DIR`/`CODEX_HOME` analogue exists (confirmed by a full string scan of the
  binary). `HOME`-shadowing is explicitly rejected: on macOS the Keychain ACL binds to the
  code-signed binary, not to `HOME`. The UI shows Antigravity as single-account only.
- A first-party Python SDK (`pip install google-antigravity`) wraps the same binary and is
  the *sanctioned* programmatic surface — prefer it over hand-rolled subprocess driving
  where it's available, in the JS/Rust host it is not, so Orbit talks to the CLI directly.

## Model + effort discovery

```
probe provider → discoverModels() → normalize → OrbitModelRegistry → cache(etag/ttl) → UI
                       ↓ on failure
              last good cache → static alias floor → manual entry
```

**Effort is a per-model property, confirmed independently on two providers** — Claude
Code's Opus 5 supports `xhigh`/`max` while Opus 4.6 and Sonnet 4.6 do not; Codex's
`gpt-6-astra` supports `max`/`ultra` while `gpt-5.5` does not. The effort picker always
renders from the *selected model's own* `supportedEfforts`, never from a static enum, and a
requested effort is validated against that list before launch.

The **alias floor** is the answer to "what if discovery is unreliable": Claude Code's
`list_models` is an internal, undocumented control request that may break on any minor
version, so Orbit ships the documented aliases (`opus`/`sonnet`/`haiku`/`fable`/`opusplan`)
as a guaranteed baseline and only *enriches* with discovery. Model IDs are never
hardcoded — alias→ID resolution is provider-dependent (Anthropic API vs Bedrock vs Vertex
resolve differently).

## Licensing summary (see [security.md](./security.md) for the full threat model)

| Provider | Constraint | Orbit's default |
| --- | --- | --- |
| Claude Code | Agent SDK terms restrict offering claude.ai login/rate limits without prior approval | API key path is default and documented; subscription reuse is a grey area pending clarification |
| Codex | No explicit statement either way; OpenAI steers toward API keys for automation | API key path is default |
| Antigravity | ToS explicitly restricts third-party access, risk lands on the user's account | opt-in, disclosed, second-tier |
