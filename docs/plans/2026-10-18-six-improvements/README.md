# Six authorized improvements — implementation and verification

Scope: audit h-63/pane185, all six areas. Executor: pane-186, Codex `codex-acc-2` (confirmed birth identity and CODEX_HOME). Base: `6a0c1b80766f6dd4f551d956580cce08f5a976d8`, installed baseline v0.2.27. No sibling worktree, account switch, third-party plugin installation or paid model test. Official checkout ownership is recorded by the shared agent registry, per the user's explicit checkout override.

| Finding / code commit | Implementation | Verified behavior |
| --- | --- | --- |
| F-158 / `38b45bd` | sidecar `accountCatalog.ts`, `catalogRevision.ts`, account-aware core admission/harness/automatic seats, protocol and account model/effort pickers | Claude control `list_models`, Codex `debug models`; Gemini/Antigravity adapter fallbacks explicitly identify unavailable capabilities. Per-account TTL, auth/config/key/version invalidation, stale-probe rejection, defaults and capabilities, safe 1M aliases. Refresh timestamps do not erase harness evidence. |
| F-159 / `f728837` | `structuredContext.ts`, usage readers, pane metadata, budget coverage and UI | Accumulated session tokens separate from current context; measured/estimated/unavailable with source/capacity/time. New model/session/turn invalidates old context. Unknown cost is not zero; known partial subtotal cannot certify complete dollar coverage. |
| F-160 / `ca3d3ee` | `PaneManager` bounded submit queue, correlated cancel protocol/client/composer, durable input journal and outbox integration | 32 queued calls / 256 KiB, 128 KiB per message; waiting/dispatch deadlines default 5 s, max 60 s. Cancellation before paste, explicit too-late result after dispatch; uncertain input never automatically replayed. Callback/receipt failures are contained. |
| F-161 / `b28d3d0` | `runtimeDaemon.ts`, disposable desktop bridge, private engine identity/boot lock, `terminalHistory.ts`, history viewer | Bridge/UI restart keeps same PTY PID/epoch and hook endpoints. Unconfirmed child creation prevents a second engine. Output journal/checkpoint replays no input. Atomic private files, authenticated status, active-process stop refusal, safe native CLI recovery after daemon loss. |
| F-162 / `f9d0d6b` | `splitTree.ts`, flat keyed `PaneGrid`, mission layout controls | Nested horizontal/vertical splits, move/resize, per-mission persistence, collapse-on-removal and corrupt-state guard. Stable panes/terminals and drafts. Narrow windows temporarily focus a pane without losing the tree; composer remains visible and terminal has at least 150 px in the tested 375×667 fixture. |
| F-163 / `c3446aa` | protocol `plugins.ts`, `appPlugins.ts`, `AppPluginsPanel`, static trusted `orbit-plugin-host.js` and isolated iframe/worker | Experimental strict manifest, hash-pinned grants, text panels, worker-local commands, sanitized status events, revocation/restart. No Node/DOM/native/network/filesystem authority granted. Static controller works under the production app CSP; loops are terminated without UI fallback or replay. |

The local branch keeps one code commit per finding. The authorized GitHub workflow squash-merges the validated branch; the official release records the resulting main commit in `source.json`.

## Fresh evidence

- `final-typecheck.log`: all workspaces passed.
- `final-tests.log`: **370 sidecar + 49 frontend tests passed**, zero failures.
- `workflow-final.log`: **6 workflow/release checks passed**.
- `node24-targeted.log`: **24 integration/security tests passed on the bundled Node 24.21.0**; CI repeats the full suite on Node 24.
- `journey-{chromium,webkit}.json`: **25 checks per engine**, zero uncaught page errors. Real Orbit core/WebSocket/PTYs with first-party deterministic CLI fixtures. Widths 1440, 900 and 375; split persistence, keyboard resize, stable nodes, drafts, one accepted submit, durable history, plugin permissions/revocation/deadline.
- `strict-csp-{chromium,webkit}.json`: production CSP on a real loopback HTTP document, static trusted controller, opaque sandbox and worker; network denied and no Node/DOM authority. A route-fulfilled Chromium test was rejected by its loopback address-space protection; the final test uses an actual HTTP response and does not disable browser security.
- `catalog-live-final.json`: installed CLIs queried without a task/API generation turn: 12 Claude entries, 7 Codex; Gemini's 3 documented alias suggestions are fallback, Antigravity catalog unavailable in this session. These are account/host observations, not universal provider entitlement claims.
- `build-all.log`: final renderer and sidecar packaging, including trusted plugin host and notices.
- Red logs and intermediate traces remain as regression history; **the `final-*` logs and the passing journey JSON are the final verdict**, not earlier intermediate failure logs.

Preview: `http://127.0.0.1:5508`, explicitly opened through Overclock MCP. It uses isolated temporary data and first-party fixtures; it neither changes real accounts nor calls a model. `serve-preview.mjs` / `verify-preview.mjs` reproduce this fixture with the installed local Playwright runtime; no browser testing connector was available.

## Orca reuse and licenses

Pinned audit source: `bbdbe72eba26ede514134730eba580963e7839f3`. Delivery recheck: upstream moved to `658953dc23b90d3c637a20951669089f3ed04df8`; **all ten reviewed relevant files are byte-identical to the pinned versions**. `upstream/sources.json` records both revisions, SHA-256 and exact paths. Identical copies share their pinned local file. MIT copyright and full license are retained in `THIRD_PARTY_NOTICES.md`, copied into the app/sidecar bundle.

Adapted: Claude control response parsing/default/disabled/capability concepts; binary split representation/collapse; experimental manifest/contribution/permission concepts. Queue, context, engine/history and plugin runtime are Orbit implementations informed by the reviewed contracts, not Electron services copied wholesale. The plugin API is deliberately separate from Orca's experimental Node API; see [PLUGIN_API.md](PLUGIN_API.md).

## Real limits and delivery gates

- A CLI picker advertises local capabilities, not certified remote serving identity or subscription entitlement. Custom endpoints/models have explicit account-config fallback with unknown capabilities. Gemini has no safe CLI listing command in the checked version; Antigravity's text list does not certify effort per model.
- Context estimates are labeled and never derived from cumulative tokens. Dollar coverage may remain partial/unavailable. Native/provider behavior and total spend cannot be guaranteed by text instructions or missing measurements.
- Cancelling a queue does not undo a paste or accepted command. Uncertain requests preserve their IDs and require checking rather than automatic replay.
- The detached engine owns PTYs. Its own death/OS reboot can terminate them; durable output and native CLI sessions support recovery. Active terminals are not killed to upgrade an old engine. Desktop window closure keeps engine-owned terminals running; this is stated in the UI.
- History is bounded: 16,000 rendered lines per execution, 32 MiB pending journal; viewer lists 64 recent executions. It is output-only, local and private, and is not a full infinite archive.
- Plugin runtime exists while its panel is open; no background Node service or host filesystem/network capability. Browser owns memory/process isolation; no hard per-plugin heap quota or universal OS sandbox claim. No third-party plugins were installed/executed.

Code/dev validation in this report is distinct from distribution. The executor must still require successful PR CI, successful Official release with signed assets, update the **same** `/Applications/Orbit.app`, and verify bundle hashes/signature/source/runtime against that release before its final handoff. The final release and installation receipt is returned with the delivery; this report does not claim those later actions happened before they were checked.
