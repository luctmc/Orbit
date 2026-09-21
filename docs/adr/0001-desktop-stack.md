# ADR-0001: Desktop stack — Electron over Tauri 2

**Status:** Proposed — gated on a measured P0 spike before acceptance.
**Date:** 2026-09-21

## Context

The original hypothesis was Tauri 2 (React/TypeScript UI, Rust core, SQLite). Orbit must run
persistently in the background with a tray icon and a Spotlight-style global-hotkey overlay,
supervise long-lived child processes (`claude`, `codex`, `agy`) reading structured
JSON/JSON-RPC event streams with interrupt/cancel, execute privileged OS operations, store
secrets in the OS keychain, keep idle CPU/RAM low, and ship signed/notarized auto-updating
builds on macOS and Windows.

## Decision

**Electron**, contradicting the original hypothesis, pending confirmation from a measured
spike (see Consequences).

## Reasoning

1. **NSPanel — the overlay is Orbit's front door.** Electron has `type: 'panel'` built in
   and CI-regression-tested (PR #40307 fixed Sonoma activation). Tauri has no core support
   (issue #13034 open with zero maintainer comments for 18 months); the community plugin
   `tauri-nspanel` (418 stars, single maintainer) has an **open, unanswered focus regression
   on macOS 27** — the OS this project develops on (issue #123, opened 2026-09-15).
2. **Streaming agent tokens is Tauri's documented worst-case IPC path.** Tauri's own docs
   state the event system "is not designed for low latency or high throughput situations."
   A 2026 report against 2.11.5 claims every Channel send becomes a webview main-thread JS
   eval and sub-1KB raw payloads are JSON-int-array-encoded [single-sourced, unverified].
   Electron's Mojo-backed IPC handles token-rate messages without special handling.
3. **Auto-update maturity.** `electron-updater` supports differential updates and staged
   rollouts; `tauri-plugin-updater` has neither. Staged rollout matters disproportionately
   for an always-running background daemon that ships often.
4. **The memory case is weaker than marketing suggests, and inverts for this app's UI.**
   Tauri's own issue #5889 measured real web apps at Tauri 370–581 MB vs Electron
   222–337 MB — Tauri *worse*, because WKWebView is less memory-efficient than Chromium for
   heavy DOM/JS. Orbit's chat UI (streaming markdown, syntax highlighting, scrollback) is
   exactly that workload. Empty-app benchmarks favour Tauri by ~2×, but that gap shrinks or
   inverts under Orbit's actual UI, and evaporates further once multiple Node-based CLI
   children join the process tree regardless of host framework.
5. **Tauri's "Rust-native" advantage is smaller than it looks, because macOS needs a Swift
   sidecar either way.** `UNUserNotificationCenter`, `SpeechAnalyzer`, and
   `SMAppService`+XPC are Swift-first. Choosing Tauri means Rust *and* Swift, not Rust
   instead of Swift — so the "avoid extra runtimes" argument for Tauri does not hold.

## What Electron costs, stated plainly

- ~120 MB installer vs ~10–15 MB.
- Possibly 80–150 MB more idle RAM (see Consequences — to be measured, not assumed).
- The `com.apple.security.cs.allow-jit` hardened-runtime entitlement (required for V8), and
  sometimes `allow-unsigned-executable-memory` — a real weakening compared to Tauri, which
  needs neither.
- An 8-week major-version upgrade cadence (latest three majors supported).
- Tauri's declarative capability/permission model is genuinely nicer than hand-written
  Electron IPC validation; Electron requires this discipline to be built explicitly (see
  [ADR-0005](./0005-permission-engine-chokepoint.md) and the IPC validation workstream).

## Consequences

- **This decision is gated, not final.** Before this ADR is marked Accepted, build a
  ~200-line spike in both frameworks — tray + non-activating overlay + one
  `claude -p --output-format stream-json` child streaming tokens into a real markdown
  renderer — and measure idle RSS, RSS after 30 minutes of streaming, and token-render
  latency, on macOS 27 **and** Windows 11.
- **If Tauri idles ≥200 MB lower with the real UI and streams smoothly, flip this
  decision.**
- Re-evaluate **Wails 3** (Go) if it reaches GA before implementation begins — it has the
  best first-party NSPanel/Spotlight support of any option, but is still beta
  (v3.0.0-beta.9) as of this writing.
- If accepted: the IPC-validation workstream in [ADR-0005](./0005-permission-engine-chokepoint.md)
  becomes mandatory scope, not optional hardening, because Electron's main process is by
  design a process-spawning engine reachable from a sandboxed renderer.

## Alternatives considered

Tauri 2 (original hypothesis, rejected per above), Wails 3 (too immature — beta), native
SwiftUI + WinUI 3 (rejected because both platforms ship in the MVP — 2× UI work forever on
the least-settled surface), Flutter (multi-window unshipped, disqualifying for
tray+overlay+window), Avalonia/MAUI (XAML is the worst fit for streaming markdown/diffs),
Neutralino/Sciter (explicitly scoped away from apps needing deep desktop behaviour).
