# ADR-0009: Two-stage Jev fan-out; Jev is never a single point of failure

**Status:** Proposed
**Date:** 2026-09-21

## Context

TypeSafe's own documentation recommends speculative fan-out — asking every question a
decision tree might need in one request, since parallel questions add negligible latency.
Its own function-calling cookbook, applied literally to Orbit's tool count (40–60 tools),
would produce several hundred questions per utterance if every tool's arguments were filled
speculatively (the cookbook's own worked example: 10 functions / 28 arguments → 54
questions). Separately, the product brief requires the whole system to remain usable if
Jev is offline.

## Decision

**Two-stage fan-out** (detailed in [jev.md](../architecture/jev.md)): stage 1 always runs
one request per utterance covering classification, tool ranking, and risk *signals*, plus
pre-filled arguments for the handful of statistically dominant tools; stage 2 fills the
remaining tool's arguments only when the request resolves to that native path.

**Degradation ladder**, enforced everywhere Jev is called:

```
Jev unavailable / 429 / 529 / timeout(400 ms)
  → deterministic rules only
  → ranked disambiguation UI if unresolved
  → explicit provider/model selection always works
  → NEVER auto-escalate to an agent provider to compensate
```

## Reasoning

The two-stage split keeps the common case (a single, unambiguous native action) at one
round trip while avoiding an unbounded per-utterance question count as the tool registry
grows. The degradation ladder's last rule specifically prevents a subtle failure mode: if an
unavailable classifier were compensated for by silently routing to an expensive, broader-
context agent, Jev's outage would become both a cost regression and a privacy regression —
worse than simply falling back to rules and asking the user.

## Consequences

- The UI must surface `Jev ● unavailable — deterministic mode` explicitly rather than
  hiding degraded behaviour.
- Stage-1 answers are cached by `hash(normalized_request + context_fingerprint)` with a
  short TTL to keep repeated phrasings cheap.
- An eval harness (`tests/jev-eval/`) tracks routing accuracy against ≥200 labelled cases,
  specifically so degradation and threshold changes are measured, not assumed.
