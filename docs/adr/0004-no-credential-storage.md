# ADR-0004: Orbit stores no provider credentials

**Status:** Proposed
**Date:** 2026-09-21

## Context

Orbit needs to support multiple accounts per provider (Claude Code, Codex, Antigravity)
without asking for email/password and without Orbit itself becoming a target for credential
theft.

## Decision

Orbit **never stores, copies, reads, or transmits** any provider's authentication
credential. Each provider keeps its own, in its own store, isolated purely by **launching
each child process with a different config directory**:

| Provider | Isolation lever | Where the secret actually lives |
| --- | --- | --- |
| Claude Code | `CLAUDE_CONFIG_DIR` (+ `CLAUDE_CODE_PROJECT_DIR_NAME`) | macOS Keychain, **keyed per config dir** — confirmed in official docs |
| Codex | `CODEX_HOME`, with `cli_auth_credentials_store` pinned to `"file"` | `$CODEX_HOME/auth.json`, mode 0600 |
| Antigravity | none available | OS keyring, single account only — see [ADR-0011](./0011-antigravity-opt-in.md) |

The **only** secret Orbit itself owns is the TypeSafe/Jev API key, stored via
`safeStorage` (Electron's OS-keychain-protected-key + ciphertext pattern) — never in plain
text in a packaged build. In development it may live in a gitignored `.env.local`.

Authentication is always a **handoff to the provider's own official flow** (`claude login`,
`codex login`, `agy`'s interactive OAuth). Orbit's UI shows connection status only —
`● Connected · Personal` — and never renders an email/password field or displays a token.

## Reasoning

- This is the single biggest reduction of Orbit's own attack surface available. A
  credential Orbit never touches cannot leak from Orbit's database, logs, or IPC layer.
- It is exactly what the providers' own isolation mechanisms were designed for: Claude
  Code's docs describe `CLAUDE_CONFIG_DIR` + `CLAUDE_CODE_PROJECT_DIR_NAME` verbatim as
  suiting "a host that embeds Claude Code and gives each session its own config directory."
- A working reference implementation of this exact pattern for Codex already exists on the
  development machine (`~/Library/Application Support/orca/codex-accounts/`), confirming
  the approach is production-viable, not theoretical.

## Consequences

- **Every child process's environment must be explicitly allowlisted, never inherited.**
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`,
  `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, `CODEX_AUTH`, and `GEMINI_API_KEY` must be scrubbed
  from every spawned process unless Orbit is deliberately injecting one for that specific
  account — otherwise an inherited variable silently overrides the per-account store and
  crosses account boundaries.
- Orbit must assert isolation at startup rather than assume it — e.g. verify
  `codex doctor --json` reports `auth storage mode == "File"` before trusting `CODEX_HOME`
  isolation, since the alternative (`keyring`/`auto`) routes to the OS keychain by a path
  that is documented, but not independently verified, to be keyed per `CODEX_HOME`.
- Antigravity cannot participate in multi-account at all; documented as a limitation, not
  worked around (see [ADR-0011](./0011-antigravity-opt-in.md)).
