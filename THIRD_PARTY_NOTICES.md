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


## Vibe Coding Toolkit — default working agreements (2026-10-17)

Source: https://github.com/soumatheusgomes/vibe-coding-toolkit
Commit: de66fe371a49f5a4d3b521759e5c401f390b6424

`packages/sidecar/src/toolkitPolicy.ts` adapts the portable working agreements, proportional
workflow, context, orchestration/recovery and verification rules from README.md,
templates/AGENTS.md.template, templates/task-handoff.md.template,
templates/rules/parallel-subagent-driven-development.md, docs/prompts/12-existing-project-setup.md
and docs/07-harness-evaluation.md. The adaptation is provider-neutral and defers to explicit
user/project instructions. No upstream executable, plugin, dependency, hook, assets, service
configuration or third-party skill is bundled or installed. Descriptions of optional tools
are guidance, not their implementation or a redistribution of their packages. Those upstream
projects retain separate licenses; adopting one later requires its own dependency/license review.

The complete MIT notice below is retained in the packaged sidecar through the existing
THIRD_PARTY_NOTICES.md packaging step.

MIT License

Copyright (c) 2026 Matheus Gomes

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

## Orca — six runtime improvements (2026-10-18)

Pinned source and current upstream: bbdbe72eba26ede514134730eba580963e7839f3.
`packages/sidecar/src/accountCatalog.ts` adapts the Claude `list_models` control request,
per-model effort/fast/auto parsing, disabled-row rejection and default resolution from
`src/shared/claude-model-list-probe.ts`. Orbit adds bounded input, its own protocol types,
account cache and conservative fallbacks. Source hashes and reviewed files are retained in
`docs/plans/2026-10-18-six-improvements/upstream/sources.json`.
The complete Orca MIT license above applies to this adaptation. No Orca runtime dependency,
branding or installed third-party plugin is included. Its plugin API remains experimental.

`apps/desktop/src/orbit/splitTree.ts` adapts the binary split-tree representation and
collapse-on-removal approach reviewed in Orca bbdbe72
`src/shared/terminal-pane-layout-tree.ts`. Orbit independently implements validated numeric
pane membership, minimum-size geometry, flat keyed rendering and narrow-window focus.
Copyright (c) 2026 Lovecast Inc.; the complete MIT notice above is retained in the bundle.

`packages/sidecar/src/appPlugins.ts` and `packages/protocol/src/plugins.ts` adapt the
experimental versioned manifest/contribution/permission concepts reviewed in Orca bbdbe72
`src/shared/plugins/plugin-manifest.ts`. Orbit defines a deliberately separate API:
text panels, worker-local commands and sanitized status events, explicit hash-pinned grants,
and no Node/native/filesystem/network authority. Its iframe/Web Worker host is an Orbit
implementation, not a port of Orca's Node plugin worker. The MIT notice above applies to the
manifest adaptation (Copyright (c) 2026 Lovecast Inc.). No third-party plugin is shipped.

## unslop — Damir Sokolovsky (@heydamir)

Source: https://github.com/heydamir/unslop
Commit: a6f121e
License: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/

Orbit uses the `unslop` skill as the visual standard of its desktop interface. The audit,
direction and redline passes that shaped `apps/desktop/src/styles.css` and the desktop
components follow its method (spacing, color, icons, copy, type, layout, details, visuals and
motion). No skill files, scripts, images or other assets are included in Orbit. unslop by
Damir Sokolovsky (@heydamir), CC BY 4.0.
