# Compact mission controls — implementation evidence

Activity T1, expanded to T2 by mission lead #76 after direct user steering.
Writer: helper #77, Codex 2 only. No other provider/account was launched.
Worktree: `/Users/lucas/Documents/GitHub/Orbit-fix-orbit-compact-task-composer`.
Branch: `fix/orbit-compact-task-composer`, created by `agent:begin` from
`origin/main` at `37bc15cda407cd773670b02dc4c8dd145a01a900`.
The exact delivery commit is supplied in the mission handoff; no push or merge was performed.

## Result and usage

- Recipient and native dispatch select share one routing row. The selected mode remains visible;
  **Ajuda** discloses its existing semantics. Escape closes help and returns focus.
- The textarea, attachments/voice/language/suggestions and primary **Enviar** remain accessible.
  The footer divider and redundant visible mode label/explanation no longer take permanent rows.
- **Idioma → Sem tradução** is the default. Selecting a Codex subscription account explicitly opts
  into translation; returning to **Sem tradução** sends the original. Existing original-authorized
  drafts do not silently reactivate a saved translator. Pending requests keep their durable payload.
- Ordinary mission progress and the persistent-engine explanation moved to **Visualizar**.
  Waiting/blocked/offline/error states still expose an actionable attention row; **Responder**
  selects the waiting agent and focuses its composer. Details/refresh remain keyboard reachable.
- CLI pane headers display the actual configured account name, falling back to the pane's recorded
  account ID, or **não informada** if absent. No account identity is guessed. The model/effort
  remains secondary and available in details when narrow.
- Backend translation is optional when no translating account is supplied. Explicit invalid
  translator accounts still fail, and selected accounts still translate exactly once. Stable input
  IDs, duplicate suppression, uncertain-state handling, PTY acknowledgements and admission checks
  remain in place. Legacy mission creation without an ID retains its non-translating path; an
  explicitly requested translation still requires an ID. UI creation always supplies durable IDs.

## Design checkpoint

Intent: the mission operator returns from reading terminal output to write/send a direction; keep a
dense workbench. Focus: message and lime send action. Domain: leader, helpers, missions, terminal,
dispatch, receipts. Existing palette: terminal ink, graphite surfaces, off-white message, gray
metadata, lime action and amber attention. Signature: visible leader/helper routing and task versus
continuation beside the terminal. Rejected stacked labels, permanent help paragraphs and a footer
divider in favor of native inline controls, disclosures and one writing boundary. Existing Geist,
mono IDs, token surfaces/borders, 4px spacing unit and 44px targets remain authoritative.
Orbit currently defines a dark theme; a separate light theme was not invented for this change.

## Source map

| File | Change |
| --- | --- |
| `apps/desktop/src/components/MessageComposer.tsx:23` | Explicit translator selection / default original |
| `apps/desktop/src/components/MessageComposer.tsx:154` | Compact routing and contextual help |
| `apps/desktop/src/components/MessageComposer.tsx:226` | Language selector without redundant authorization checkbox |
| `apps/desktop/src/components/MessageComposer.css:1` | Scoped compact layout, responsive controls and focus |
| `apps/desktop/src/components/MissionView.tsx:159` | Status/engine in existing Visualizar disclosure |
| `apps/desktop/src/components/MissionView.tsx:190` | Actionable attention row |
| `apps/desktop/src/components/PaneView.tsx:130` | Actual account displayed in header |
| `apps/desktop/src/styles.css:1428` | Mission details/attention and pane account styles |
| `packages/sidecar/src/core.ts:1428` | Original text unless an account explicitly requests translation |
| `packages/sidecar/test/inputLanguage.test.ts:242` | Default-original regression and durable input checks |
| `apps/desktop/src/components/MessageComposer.browser.test.mjs:14` | Opt-in real-browser integration regression |

## Measured before / after

The exact real composer component was mounted with a synthetic Orbit client. No sidecar account,
real model or microphone was used. Widths 1698/1440/1024/768/375, height 900, identical draft and
fonts were used for before/after screenshots; browser interactions use the mission browser's
supported coordinate area, at 1280×800 or 375×800. DOM text was captured before screenshots.

| Viewport width | Before height | After height | Writing content |
| --- | ---: | ---: | --- |
| 1698, 1440, 1024, 768 | 217.25 px | 142 px | 44 px, fully visible |
| 375, long draft | 207 px | 193 px | Before clipped to 16 px; after 95 px, fully visible |

Desktop reduction: 75.25px / 34.6%. At narrow width the full draft is now visible and the composer
still takes less height. The empty narrow composer is checked at ≤150px. All measured final
widths have no horizontal overflow and no clipped writing surface. Interactive control heights
are ≥44px.

Visual artifacts: `before-{1698,1440,1024,768,375}.png`, corresponding `after-*.png`, matching
`*-dom.txt`, `before-measurements.json`, `after-measurements.json`, plus
`mission-after-1698.png` and `mission-after-375.png` with matching DOM text. Additional mission
browser checks inspected real MissionView/PaneView at desktop/narrow and opened Visualizar.
Original user screenshots remain at the attachment paths in the activity messages.

## Verification

Exact commands, integer exits, source hashes and built artifact hashes are recorded in `checks.json`.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | 143 packages, no vulnerabilities |
| `COMPOSER_QA_PHASE=before node --test apps/desktop/src/components/MessageComposer.browser.test.mjs` | 1 | Expected red: original component exceeds compact height budget |
| `node --test --test-name-pattern='without a translating account' packages/sidecar/test/inputLanguage.test.ts` | 1 | Expected red: original backend rejects default original input |
| `node --test apps/desktop/src/components/MessageComposer.browser.test.mjs` | 0 | Real controls/keyboard/layout/mission/account regression passes |
| `npm test` | 0 | 399 sidecar + 50 desktop tests pass, zero failures |
| `npm run typecheck` | 0 | All workspaces pass |
| `npm run test:workflow` | 0 | 6/6 pass |
| `npm run build -w @orbit/desktop` | 0 | Production frontend built |
| `node scripts/build-sidecar.mjs` | 0 | Current sidecar bundled successfully |
| `git diff --check` | 0 | No whitespace errors |

The browser test verifies keyboard focus reaches the native dispatch control without sending, its change handler produces new task/continue payloads,
Enter/Shift+Enter, help/language Escape and focus, original-language defaults and explicit translator,
file picker boundary/paste/remove/send, synthetic speech recognition boundary, recipient/draft
isolation, Tab suggestion acceptance without submission, suggestions toggle, shell restrictions,
pending/disconnected states, keyboard menu reachability and refresh, waiting/blocked actions,
account name/actual-ID fallback and visibility at narrow width. `after-interactions.json` records
the tested groups. The authenticated WebSocket/real stand-in PTY language test verifies translated
and untranslated messages with zero extra translator calls for the original input.

Build warning: the main frontend chunk remains above 500kB (515.74kB minified); build exits 0.
Node test output includes the existing experimental localStorage warning. Neither was suppressed.

## Coordination and installation boundary

`npm run agent:setup`, `npm run agent:status`, `npm run agent:begin -- fix/orbit-compact-task-composer apps/desktop/src/components/MessageComposer.css apps/desktop/src/components/MessageComposer.browser.test.mjs docs/plans/2026-10-18-orbit-compact-task-composer`, and `npm ci` all exited 0.

`MessageComposer.tsx` was initially claimed by `feature/orbit-ai-account-selection`. The owner
worktree was clean and the file matched updated origin/main. Root had older committed divergence
(dispatch removed) and was preserved. Lead #76 explicitly authorized a narrow coordinated transfer
because `scripts/agent-flow.mjs` has no transfer operation. We did not change that tool or weaken
its guards. Only the listed reservation entries changed, under its existing directory mutex and
with atomic `os.replace`; the existing registry schema and all other claims were preserved.
`reservation-transfer.json` contains exact registry path, rationale and complete recoverable
before/after data. `reservation-extension.json` records the later approved transfer of only
`core.ts` and `inputLanguage.test.ts`, plus addition of unclaimed MissionView/PaneView/styles paths.
The Python mutations rechecked root/old-owner cleanliness, owner source equality and unchanged
registry before mutation; both exited 0. The root HEAD remains
`75b4d1d9d2d7fc3859d6174fcf26c642b355266d`; the old-owner HEAD remains
`050e5bde99ef259ddfa77c4a943673922682319b`, both with clean status. See handoff/tool transcript for
the literal Python heredocs; no checkout content or commit was changed by coordination.

The installed app was inspected: `/Applications/Orbit.app`, version **0.2.33**. This task's source
has **not** been installed or run there. Lead explicitly deferred native packaging/replacing the
running app until independent review. No cargo/rustc/tauri packaging process was observed during
the pre-build check; only this worktree's frontend/sidecar artifact builds were run. No app data,
sessions, credentials or signing keys were changed. Merge, official release, native package and
effective installation/runtime verification remain pending. This is implementation delivery,
not final mission acceptance. Retain only this task's worktree until accepted integration, then
the lead will delegate its cleanup. Physical microphone/macOS native speech and paid real
translator/provider calls were not exercised. Native popup option selection through keyboard is
not verified: the existing BrowserHost key driver did not change the focused macOS select after
three attempts. The select and its native keyboard contract remain unchanged; backward Tab focus,
change handling and both resulting dispatch payloads are verified. Reviewers should check native
popup selection in the installed app during integration.

To rerun the fixture without accounts/providers: `node docs/plans/2026-10-18-orbit-compact-task-composer/serve.mjs`.
Use `/docs/plans/2026-10-18-orbit-compact-task-composer/fixture.html?mission` in the mission browser;
append `&focus&frame=375` for narrow, `&waiting` or `&blocked` for attention states. This local
fixture server is temporary and does not replace installed-app verification.
