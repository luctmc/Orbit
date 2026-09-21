# ADR-0015: Privileged helpers expose enumerated verbs only

**Status:** Proposed
**Date:** 2026-09-21

## Context

Orbit occasionally needs privileged operations (admin-level changes) on both platforms.
Both platforms' recommended patterns — macOS `SMAppService` + XPC, Windows COM elevation
moniker — converge on the same shape: a narrow, signature-validated IPC surface to a
separately-privileged process.

## Decision

Every privileged helper on both platforms exposes a **fixed, enumerated set of named
verbs**, each independently reviewable. There is no "execute this command with elevated
privileges" verb of any kind, on either platform.

## Reasoning

A generic elevated-execute verb collapses the entire privilege boundary into "trust
whatever the caller sends," which defeats the purpose of having a separately-privileged
process at all — the caller-side vulnerability becomes a root-level vulnerability with one
hop. The research explicitly flagged this as "the single thing that will sink a security
review," and multiple real vendor CVEs follow exactly this shape (a helper service with an
overly generic command surface).

## Consequences

- Adding a new privileged capability means adding a new named verb to the helper and its
  security review, not extending an existing generic one.
- The macOS helper must validate the XPC client's code signature against a pinned Team ID
  on every call; the Windows COM moniker's activation context serves the analogous purpose.
- Helpers are installed lazily, on first use of a capability that needs one — not at
  onboarding — per [tools.md](../architecture/tools.md).
