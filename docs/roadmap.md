# Orbit Roadmap

Each phase lists objective, deliverables, dependencies, risks, and definition of done. This
sequencing follows from the architecture in `docs/architecture/` and the ADRs in
`docs/adr/`.

## P0 — Decision & Spike (3–5 days)

**Objective:** settle [ADR-0001](adr/0001-desktop-stack.md) with measurements, not
argument, and de-risk the three provider integrations before committing code structure
around them.

**Deliverables:**
- Two ~200-line spikes (Electron, Tauri): tray + non-activating overlay + one
  `claude -p --output-format stream-json` child streaming tokens into a real markdown
  renderer. Idle RSS, RSS after 30 minutes of streaming, and token-render latency, measured
  on macOS 27 **and** Windows 11.
- Three captured real transcripts committed as test fixtures: `claude -p
  --output-format stream-json`, one `codex app-server` JSON-RPC session, one `agy -p
  --output-format stream-json` session.
- TypeSafe plugin installed and one real Jev request made against the question catalogue
  in [jev.md](architecture/jev.md).

**Dependencies:** none.
**Risks:** no Windows 11 test machine has been confirmed yet — this is the first point
where the both-platforms-in-MVP decision has a real cost.
**Definition of done:** ADR-0001 marked Accepted (or reversed) with numbers attached;
three transcripts in `tests/contract/fixtures/`.

## P1 — Core skeleton (1–2 weeks)

**Objective:** an empty, observable app.
**Deliverables:** Electron shell; typed, schema-validated IPC; SQLite + migrations
(schema in section S of the Phase 0 plan); internal event bus; structured logging with
trace/task/session ids; Dev Mode panel scaffolding (section 43 of the product brief).
**Dependencies:** P0 decision accepted; Rust toolchain installed (currently absent —
[ADR-0002](adr/0002-language-split.md)); Apple Developer signing identity provisioned
(currently 0 identities — [ADR-0012](adr/0012-developer-id-distribution.md)).
**Risks:** signing-identity setup is a manual GUI step outside automation's reach.
**Definition of done:** the app starts, logs a trace end-to-end, and survives a restart on
both platforms.

## P2 — Tool Runtime + Platform Adapters (3–4 weeks — the largest phase)

**Objective:** the deterministic-action layer works, on both platforms, for real.
**Deliverables:** tool registry, schemas, validation, timeout/cancel/progress, typed
errors, capability probing; macOS and Windows adapters for every MVP namespace
(`applications`, `filesystem`, `processes`, `clipboard`, `system.volume`, `search`,
`shell`-allowlisted, `browser.open`); the Rust napi-rs addon; the Swift sidecar.
**Dependencies:** P1.
**Risks:** **this is where shipping both platforms in the MVP costs roughly double** —
every tool needs two implementations and real testing on both operating systems, per
Lucas's own explicit choice.
**Definition of done:** every MVP tool passes the same contract suite on macOS and
Windows; unavailable capabilities (e.g. brightness without the private framework, window
titles without Screen Recording) are absent from the registry rather than failing at
call time.

## P3 — Permission Engine + Audit + Undo (1.5–2 weeks)

**Objective:** the chokepoint is real, not aspirational.
**Deliverables:** risk classification (deterministic, argument-aware), policy evaluation,
grants, prompt UX, append-only audit log, undo for filesystem move/rename.
**Dependencies:** P2.
**Risks:** none specific to this phase; the design is unusually well-specified going in.
**Definition of done:** the security test suite passes; a dedicated test asserts that no
tool execution path bypasses the engine — proven, not merely reviewed.

## P4 — Provider System (3–4 weeks)

**Objective:** all three providers run real tasks with Orbit adjudicating every tool call.
**Deliverables:** the three protocol adapters; capability probes; account provisioning;
session lifecycle (interrupt/resume, using SIGINT-then-SIGTERM for Claude Code
specifically); model/effort discovery + registry + cache with the alias floor; Codex's
`generate-ts` codegen wired into the build ([ADR-0014](adr/0014-codex-protocol-codegen.md));
Orbit's MCP server injected per-invocation into every provider
([ADR-0008](adr/0008-mcp-as-tool-channel.md)); tool-call interception proven on all three,
including the rewrite path (`updatedInput`, `acceptWithExecpolicyAmendment`).
**Dependencies:** P3.
**Risks:** the highest-churn surface in the whole system — mitigated by the recorded-
transcript contract tests from P0 and per-provider version pinning/probing.
**Definition of done:** each provider completes a real task; Orbit's audit log shows every
tool call it adjudicated; a killed provider child recovers cleanly without corrupting task
state.

## P5 — Jev Decision Layer (1.5–2 weeks)

**Objective:** the router actually routes well, and degrades safely.
**Deliverables:** client, two-stage fan-out question catalogue, caching, confidence
thresholds scaled to risk class, the degradation ladder, an eval harness over labelled
cases.
**Dependencies:** P3 (risk classes must exist for thresholds to scale against), P4 (needs
real provider routing targets).
**Definition of done:** routing accuracy measured on ≥200 labelled requests; **the app is
fully usable — every MVP tool reachable — with Jev forced offline.**

## P6 — Desktop UI polish + remaining tools (2–3 weeks)

**Objective:** the product Lucas will actually use daily.
**Deliverables:** overlay UX, settings, accounts, memory and audit views, permission-tier
onboarding (the deep-links for Accessibility/Screen Recording/Full Disk Access, since none
of these can be prompted programmatically); then `window.*` move/resize and brightness,
both behind capability probes and feature flags, once the permission-tier UX exists to
justify asking for them.
**Dependencies:** P2, P3.
**Definition of done:** a full first-run flow — scan environment, connect providers, grant
permissions contextually — works without a developer present.

## P7 — Distribution (1–2 weeks)

**Objective:** ship a real, updatable, signed build.
**Deliverables:** macOS Developer ID signing + notarization + stapling; Windows signing
(Azure Artifact Signing, not an EV cert — EV no longer grants instant SmartScreen trust);
`electron-updater` wired with staged rollout.
**Dependencies:** a paid Apple Developer Program membership and a stable signing identity —
**this must exist well before P7 starts**, since it's also a P1 dependency for TCC grant
stability during development.
**Risks:** SmartScreen reputation resets per build hash and has reportedly re-triggered
warnings after a 2026 Azure intermediate-CA migration even for previously trusted
publishers — verify current state before launch, don't assume signing alone suffices.
**Definition of done:** a signed build installs cleanly on a clean macOS and a clean
Windows machine, and auto-updates from a prior version without losing session state.

## P8 — Voice

Wake word (openWakeWord), VAD (Silero/WebRTC cascade), STT/TTS traits with the documented
macOS/Windows asymmetry, barge-in. See [voice.md](architecture/voice.md). Scope TBD in
detail at the start of this phase.

## P9 — Memory / context depth, routines, skills

Deeper memory retrieval (only if P5's eval data shows a real gap ranking cannot fix —
[ADR-0010](adr/0010-structured-memory-no-vectors.md)), the Routine/Trigger/Condition/Action
model from the product brief, and Orbit's own Skill format. Scope TBD.

---

## Cross-cutting note on the both-platforms decision

Lucas explicitly chose to ship macOS and Windows together in the MVP, over a macOS-first
alternative. This is recorded here, honestly, rather than smoothed over: it is the single
biggest driver of P2's size, and it means Windows testing infrastructure is needed starting
in P1, not deferred to P7.
