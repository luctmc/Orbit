# Orbit

A personal computer agent for macOS and Windows, inspired conceptually by JARVIS: text and
(later) voice commands, interpreted through a three-tier intelligence budget — deterministic
code, then a fast decision layer (Jev/TypeSafe), and only when genuinely needed, a full
agent provider (Claude Code, Codex, or Google Antigravity) — acting on the operating system
exclusively through a single Permission Engine.

**Status: Phase 0 (architecture) complete. No implementation exists yet.**

## Start here

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — the whole system on
  one page, with the request-flow diagram
- [`docs/adr/`](docs/adr/) — the 15 architecture decisions this design rests on, each with
  reasoning and stated consequences
- [`docs/roadmap.md`](docs/roadmap.md) — the phase plan, starting with a measured spike to
  settle the desktop-framework choice
- [`CLAUDE.md`](CLAUDE.md) — the invariants that must not be casually changed while
  implementing

## Why this document set exists

This repository began as a from-scratch architecture pass: every provider (Claude Code,
Codex, Antigravity), the TypeSafe/Jev decision layer, and the macOS/Windows platform APIs
were researched directly against official documentation, live docs, and the locally
installed CLI binaries before any implementation decision was made. Two licensing
constraints and one desktop-framework reversal came out of that research and are recorded
in the ADRs rather than smoothed over.
