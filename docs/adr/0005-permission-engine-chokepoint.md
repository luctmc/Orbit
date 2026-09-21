# ADR-0005: The Permission Engine is the single chokepoint to the OS

**Status:** Proposed
**Date:** 2026-09-21

## Context

Orbit will have real, high-impact access to a personal machine, driven partly by external
agent CLIs it does not control. Those agents must never be able to reach the operating
system except through Orbit's own adjudication.

## Decision

Every side-effecting action — proposed by Orbit's own router, by Jev, or by any external
agent provider — passes through one Permission Engine before it reaches the Tool Runtime.
There is no code path that calls a platform adapter directly. See
[permissions.md](../architecture/permissions.md) for the full risk-class model and
evaluation order.

## Reasoning

Research into all three providers showed that a single interception mechanism is
insufficient even on the provider with the best-looking one: Claude Code's own
documentation states that auto-approved calls never reach the `can_use_tool` callback — a
bare allowlist entry, `acceptEdits`, or `bypassPermissions` silently bypasses it. Only a
`PreToolUse` hook runs on every call in every mode. This generalizes: **the mechanism a
provider exposes for "ask the user" is not the same mechanism that guarantees "Orbit sees
every call."** Orbit therefore implements two gates per provider (see
[providers.md](../architecture/providers.md)), and treats the hook-style gate as the
authoritative one everywhere it exists.

## Consequences

- A test must assert the chokepoint directly (no execution path bypasses the engine), not
  merely rely on code review convention — this is called out explicitly in the Testing
  Strategy.
- Because Electron was chosen over Tauri ([ADR-0001](./0001-desktop-stack.md)), the IPC
  validation this implies is **hand-written, not declarative** — Tauri's capability system
  would have given some of this for free. This is a named, mandatory architectural
  workstream: every renderer→main IPC message is validated in main as if it were an
  untrusted HTTP request, because the main process is, by design, a process-spawning
  engine reachable (through several hops) from a sandboxed renderer.
- Where a provider supports rewriting a proposed action (`updatedInput` on Claude Code,
  `acceptWithExecpolicyAmendment` on Codex), the engine prefers rewriting to denying.
