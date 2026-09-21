# ADR-0012: Ship Developer ID + notarized; no Mac App Store

**Status:** Proposed
**Date:** 2026-09-21

## Context

Orbit needs macOS window management (move/resize via the Accessibility API — there is no
other path) and, best-effort, display brightness (which has no supported public API at all;
the only mechanism that works on Apple Silicon is the *private* `DisplayServices.framework`,
reached via `dlopen`).

## Decision

Orbit distributes on macOS as a **Developer ID–signed, notarized, non-sandboxed
application**. It does not target the Mac App Store.

## Reasoning

- **App Review refuses non-sandboxed apps**, and the Accessibility API needed for window
  management effectively requires non-sandboxed operation — every shipping macOS window
  manager (yabai, Rectangle, Magnet, Amethyst) uses AX and ships outside the App Store.
- **Private framework linkage is an automatic App Review rejection** for the brightness
  capability, full stop.
- **Notarization tolerates both.** Notarization is an automated malware scan, not an API
  audit, and every shipping brightness utility (MonitorControl, Lunar, BetterDisplay) ships
  this way, Developer ID–signed and notarized. This is treated as high-confidence
  [COMMUNITY] evidence, not a contractual guarantee — Apple could change this posture, and
  brightness is designed as a feature-flagged, best-effort capability specifically because
  of that fragility (see [tools.md](../architecture/tools.md)).

## Consequences

- **A paid Apple Developer Program membership and a stable signing identity are needed in
  local development, not only at release.** TCC grants (Accessibility, Automation, Screen
  Recording) are keyed to code signature + path; an unsigned or ad-hoc-signed dev build is
  treated as a different program on every rebuild and re-prompts constantly.
- ⚠️ **As of this writing, `security find-identity -v -p codesigning` reports 0 valid
  identities on the primary development machine.** Xcode is installed
  (`/Applications/Xcode.app`), but signing in with an Apple Developer account is a manual,
  GUI-only step that must happen before Phase 1 environment setup completes, not deferred to
  Phase 7 (Distribution).
- Brightness and window move/resize are excluded from the MVP tool set specifically because
  of the friction and fragility documented here (see [roadmap.md](../roadmap.md), Phase 6).
