# Third-party notices

## Orca — explicit skill selection (2026-10-17)

Source: https://github.com/stablyai/orca/blob/09f12fa6dcbc910fea9113c3adf0617b0efe3e35/src/main/skills/agent-skill-selection.ts

`packages/sidecar/src/skillSelection.ts` adapts the exact-ID-first selector, ambiguous/missing
selection refusal and ID-based deduplication. Orbit uses its own mission-filtered CatalogItem,
adds namespaced aliases, and uses plain Error diagnostics. No upstream error classes, runtime
imports, packages, assets or services are included; no dependency was added. The MIT license
and copyright below also cover this adaptation (Copyright (c) 2026 Lovecast Inc.).

Orca's mutation receipts, launch preferences, preamble and compaction/usage handling were
reviewed as architectural references; their implementation was not copied. See the pinned
source map in `docs/analysis/2026-10-17-orca-continuity/README.md` for scope and limits.

## Orca — Lovecast Inc.

Source: https://github.com/stablyai/orca
Commit: 100b6b1efe1508d6a2c70945417e4fd8e4a26d23

`apps/desktop/src/orbit/missionSelection.ts` adapts the per-owner selection restoration
algorithm in `src/renderer/src/store/terminals/workspace-terminal-active-tabs.ts`.
Changes: numeric Orbit pane IDs, mission membership validation, corrupt storage handling,
leader fallback and removal of Orca-only canonical-tab/worktree dependencies.

This adaptation has no runtime third-party imports. Its upstream imports are type-only;
no Electron, Zustand, assets, branding, fonts, UI primitives or other Orca dependencies
are included. Orbit's pre-existing dependency licenses continue to apply separately.

MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
