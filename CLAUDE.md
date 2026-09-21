# Orbit

A personal computer agent for macOS and Windows — text/voice commands interpreted through a
three-tier intelligence budget (deterministic code → Jev/TypeSafe → agent providers), acting
on the OS only through a single Permission Engine chokepoint.

**Status:** Phase 0 (architecture) complete. No implementation code exists yet.
Start here: [docs/architecture/overview.md](docs/architecture/overview.md), then
[docs/roadmap.md](docs/roadmap.md) for what's next (P0: the Electron-vs-Tauri spike).

## Reading order

1. `docs/architecture/overview.md` — the whole system in one page, with the diagram
2. `docs/adr/` — every load-bearing decision, numbered, with reasoning and consequences
3. `docs/architecture/{providers,tools,permissions,security,jev,voice,context,memory}.md`
4. `docs/roadmap.md` — phases, with explicit dependencies and risks

## Non-negotiable invariants (do not casually change these)

- **Every path to the OS passes through the Permission Engine.** No tool executes by any
  other route — see [ADR-0005](docs/adr/0005-permission-engine-chokepoint.md).
- **Jev may only escalate computed risk, never compute or lower it.** Risk is a
  deterministic function of tool + arguments — see
  [ADR-0006](docs/adr/0006-jev-risk-boundary.md). Do not let a Jev question decide risk
  directly, no matter how convenient it looks in the moment.
- **Orbit stores no provider credentials.** Isolation is by config directory
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), never by Orbit copying or reading a token — see
  [ADR-0004](docs/adr/0004-no-credential-storage.md). Child process environments are
  allowlisted, never inherited.
- **No hardcoded models, model IDs, or effort lists.** Discover at runtime; fall back to
  the documented alias floor — see [ADR-0007](docs/adr/0007-dynamic-model-discovery.md).
- **Antigravity is opt-in, disclosed, single-account, second-tier.** Never the default,
  never a silent fallback target — see [ADR-0011](docs/adr/0011-antigravity-opt-in.md).
- **No privileged helper verb of the form "run arbitrary command as root/admin."** Every
  privileged operation is a named, enumerated verb — see
  [ADR-0015](docs/adr/0015-privileged-helper-verb-allowlist.md).

## Workflow

Standing authorization from Lucas: commit at phase boundaries without asking first, and
spawn subagents for research or parallelizable execution without asking first. Still stop
and ask when a decision is genuinely Lucas's call (a precedent already set on this project:
the CloudKit-deferral decision on the earlier Orbit iteration), or when work crosses into
visual/UI design — that is routed through Codex, not this session.

## Stack (see ADRs for the full reasoning, including what was rejected and why)

Electron (gated on a P0 measurement spike vs Tauri) · TypeScript orchestrator · Rust
(napi-rs) for OS-native bindings · Swift sidecar for macOS-only APIs (notifications,
SpeechAnalyzer, SMAppService+XPC) · SQLite via `node:sqlite` · macOS + Windows both in the
MVP (Lucas's explicit choice — see the roadmap's cross-cutting note on cost).

## Known environment gaps to close early

- No Rust toolchain installed yet (`rustc`/`cargo`) — needed per
  [ADR-0002](docs/adr/0002-language-split.md).
- **0 valid code-signing identities** on the primary dev machine — a paid Apple Developer
  Program membership and a stable Developer ID are needed in Phase 1, not just at release,
  because TCC permission grants are keyed to code signature (see
  [ADR-0012](docs/adr/0012-developer-id-distribution.md)).
- No Windows test machine confirmed yet — needed starting in P0/P1 given the both-platforms
  MVP decision.
