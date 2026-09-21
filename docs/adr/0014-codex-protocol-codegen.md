# ADR-0014: Codex protocol types are generated, never hand-written

**Status:** Proposed
**Date:** 2026-09-21

## Context

Codex's app-server JSON-RPC protocol is largely undocumented at the payload level; method
names were recoverable from the installed binary, but full parameter/result schemas were
not. The binary itself, however, can emit its own authoritative types:
`codex app-server generate-ts --out <dir>` and `generate-json-schema --out <dir>`.

## Decision

`codex app-server generate-ts` is a mandatory build step in `packages/core-providers`. The
output lands in `src/generated/` and is never hand-edited; any code depending on Codex's
protocol imports from there.

## Reasoning

Hand-writing these types against reverse-engineered binary strings, as Phase 0 research had
to do for lack of an alternative, is a standing source of drift the moment the installed
Codex version changes. The codegen output is by construction version-matched to whatever
binary generated it, which converts an ongoing maintenance risk into a single build-time
step that fails loudly (a codegen mismatch) rather than silently (a hand-written type
quietly going stale).

## Consequences

- CI must pin or detect the installed Codex CLI version used for codegen, and the app's
  own capability probe (per [ADR-0003](./0003-provider-protocol-strategy.md)) must tolerate
  a runtime Codex version that differs from the one codegen ran against.
- No equivalent exists for Claude Code or Antigravity; their adapters remain hand-written
  against documentation and binary-string evidence, with the capability probe as the
  primary drift defence.
