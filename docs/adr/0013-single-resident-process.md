# ADR-0013: Single resident process in the MVP; no background service yet

**Status:** Proposed
**Date:** 2026-09-21

## Context

The product brief asks whether Orbit needs a separate always-on background service in
addition to the desktop app. Voice (wake word, VAD) is explicitly deferred past the MVP.

## Decision

The MVP ships as a single resident Electron app with a tray icon and launch-at-login. No
separate background service process exists yet.

## Reasoning

Every MVP requirement (overlay hotkey, tray, tool execution, provider sessions) is
satisfiable within one resident process. Splitting out a service now would add process
supervision and IPC complexity with no MVP feature depending on it. When voice does arrive
(Phase 8), the audio capture pipeline — not the orchestrator — is the more likely candidate
to split into its own long-lived process, precisely because it must be a persistent
capture loop independent of the main window's lifecycle (see
[voice.md](../architecture/voice.md)).

## Consequences

- Revisit this decision explicitly at the start of Phase 8, rather than letting a service
  process accrete informally.
