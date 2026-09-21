# ADR-0002: Language split — TypeScript orchestrator, Rust native bindings, Swift sidecar

**Status:** Proposed
**Date:** 2026-09-21

## Context

Given [ADR-0001](./0001-desktop-stack.md) (Electron), Orbit still needs first-class OS
integration on macOS (notifications, `SpeechAnalyzer`, `SMAppService`+XPC, Accessibility,
CoreAudio) that has no clean path from Node, and native-quality bindings for cross-platform
OS operations (`sysinfo`, clipboard, global hotkeys, audio devices).

## Decision

| Layer | Language | Why |
| --- | --- | --- |
| UI | TypeScript + React + Vite | streaming markdown/diff/code is HTML's home turf |
| Orchestrator (Electron main) | **TypeScript (Node)** | supervises child processes; Codex emits TS types directly via `generate-ts`; Claude Code's reference host implementation is TS |
| OS-native tool bindings | **Rust via `napi-rs`**, in-process addon | `sysinfo`, `windows-rs`, `objc2`, `arboard`, `global-hotkey` are the best-in-class bindings for these operations, and an in-process addon costs no extra IPC hop |
| macOS-only natives | **Swift sidecar**, signed with the app's identity | `UNUserNotificationCenter`, `SpeechAnalyzer`, `SMAppService`+XPC are Swift-first APIs with no usable C/ObjC surface |
| Windows privileged operations | small C#/C++ helper, or Rust via `windows-rs` | COM elevation moniker, Windows Search OLE DB |

## Reasoning

This composition has exactly **one** extra IPC hop beyond the Electron main process — the
Swift sidecar. The Tauri equivalent, by contrast, would have needed a long-lived Node
sidecar (for the agent SDKs) *and* a Swift sidecar — three runtimes, two IPC hops, and
Tauri's own sidecar docs explicitly steer away from long-lived Node sidecars, describing the
pattern as intended for short-lived, single-command processes.

Choosing Rust for the OS-native binding layer, rather than pure Node addons or shelling out,
follows the platform research directly: `sysinfo`'s cross-platform process API, `objc2`'s
AppKit/Accessibility bindings, and `global-hotkey`'s Carbon/Win32 dual backend are
meaningfully better than any Node-native alternative found during research.

## Consequences

- Requires installing a Rust toolchain in the development environment (`rustc`/`cargo` are
  **not currently installed** on the primary dev machine — a Phase 1 prerequisite).
- Requires `napi-rs` build tooling in CI for both platforms.
- The Swift sidecar must be code-signed with the parent app's identity for
  `UNUserNotificationCenter` and related APIs to function, and this signing requirement
  applies in local development too — see [ADR-0012](./0012-developer-id-distribution.md).
