# ADR-0003: Speak provider protocols directly; SDKs are specifications, not dependencies

**Status:** Proposed
**Date:** 2026-09-21

## Context

Anthropic (`@anthropic-ai/claude-agent-sdk`) and OpenAI (`@openai/codex-sdk`) both publish
official Node/TypeScript SDKs for their agent CLIs. Google Antigravity has no Node SDK.

## Decision

Orbit implements each provider's host-side protocol directly — Claude Code's stdio
stream-json + control-request channel, Codex's app-server JSON-RPC 2.0, Antigravity's NDJSON
stdio + hooks — rather than depending on the official SDKs at runtime.

## Reasoning

- **Both existing SDKs are documented as thin wrappers, not independent clients.** Claude
  Code's Agent SDK docs state it spawns the CLI binary and speaks the same stream-json
  protocol over stdio; it explicitly tells non-JS/Python consumers to drive the CLI as a
  subprocess instead. Codex's own documentation is internally inconsistent about whether the
  TS SDK wraps the app-server or spawns the CLI — a sign the wrapper itself is mid-transition
  and not a stable abstraction to build on.
- **Antigravity has no Node SDK at all**, so Orbit must speak its protocol directly
  regardless — building a different integration style for one of three providers would be
  the "spread `if claude` / `if codex` / `if gemini` through the system" anti-pattern the
  product brief explicitly warns against.
- **Depending on the SDKs would still not remove the maintenance burden**, since the
  underlying event schemas are the volatile surface (Codex's exec schema broke downstream
  parsers across a minor version; Claude Code's control-channel schema is undocumented in
  places). An SDK dependency adds a second thing to track without removing the first.

## What this buys, concretely

- **Codex's `codex app-server generate-ts --out <dir>` becomes a mandatory build step.** It
  emits authoritative, version-matched TypeScript types directly from the installed binary,
  which is a strictly better contract than either hand-writing types or depending on a
  third-party SDK's own (possibly stale) types.
- Every provider adapter runs a **capability probe at startup** (never a cached
  version-string comparison), because all three CLIs proved volatile during research: `agy`
  self-updated mid-session and changed a flag default; Claude Code ships a `capabilities[]`
  array specifically so hosts avoid version-string comparison.

## Consequences

- Orbit owns and maintains three protocol clients, tested against **recorded real
  transcripts** as contract-test fixtures (captured in Phase 0/1) rather than against a live
  CLI in CI, so drift is caught deterministically.
- If Anthropic or OpenAI later publish a stable, protocol-independent client library (rather
  than a subprocess wrapper), this decision should be revisited.
