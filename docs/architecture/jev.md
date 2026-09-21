# Jev / TypeSafe Architecture

Jev (TypeSafe's System One model) is Orbit's fast, cheap decision layer — not a chatbot, not
a generative model. It returns typed, calibrated judgments (`Choice`, `Score`, `Noul`) over
state Orbit supplies, in ~70–500 ms for a fraction of a cent. Source of truth for everything
below: the live docs at `docs.typesafe.ai` and the official agent skill
(`typesafe-ai/skills`), both read in full during Phase 0 research.

## Where Jev is used, and where it is never used

**Used for:** intent classification · tool ranking · closed-set argument filling ·
provider/model-tier extraction from natural language · candidate selection and reranking ·
ambiguity detection · relevance filtering of context · "does this need deep reasoning?".

**Never used for:**

| Not for | Because |
| --- | --- |
| **Computing action risk** | Jev cannot do math and does not treat state as hostile by default. Risk is derived deterministically from the resolved tool + arguments, in code — see [permissions.md](./permissions.md). |
| **Authorizing anything** | Confidence measures probability-distribution concentration, not permission to act — TypeSafe's own docs make this distinction explicitly. |
| **Prompt-injection defence** | Documented, verbatim: *"State is data, and `jev-1.13` does not treat it as hostile by default. Content written to adversarially steer the model… can move the answer."* A signal, never a gate. |
| Dates, counting, arithmetic, thresholds | Documented failure modes of `jev-1.13` ("jaggedness" page). Code owns all of it. |
| Generating text, paths, commands, model IDs | Not a generative model. Select from enumerated candidates instead. |
| Being required for anything to function | See §Degradation below. |

## The API, in brief

One endpoint: `POST https://api.typesafe.ai/v1/systemone`. A request carries `state`
(string/object/array), `model` (`jev-latest`), and a map of named `questions`, each one of
three primitives:

| Type | Answer | Notes |
| --- | --- | --- |
| `noul` | `noul: 0..1` | yes/no probability, **no `confidence` field** |
| `choice` | `choice`, `probabilities{}`, `confidence` | up to 255 options |
| `score` | `score` (fractional), `legend{}`, `probabilities{}`, `confidence` | 2–10 ordered levels |

Questions in one request are evaluated **in parallel against one ingested state** — this is
the basis for the fan-out pattern below. Model: `jev-1.13.0` (aliased `jev-latest`); 64k
token context, $0.042/Mtok input, output free; rate limits are explicitly documented as
"adjusting dynamically… can change without notice."

## The request shape — speculative fan-out, two stages

**Stage 1 — always, one request, every utterance.** ~12–16 questions covering request
classification, tool ranking, project/provider/tier/effort extraction from explicit
language, and risk *signals* (never risk itself): `needs_deep_reasoning`, `is_ambiguous`,
`is_multi_step`, `sounds_destructive`, `touches_private`, `scope_breadth`.

**Stage 2 — only when the request resolves to a native tool call.** Argument filling
follows TypeSafe's own function-calling cookbook exactly: one `Choice` per closed-set
argument (option keys *are* the literal argument values the function accepts), plus one
`stated` `Noul` per optional argument — "does the request mention this at all?" — so an
unmentioned argument is *omitted* and the tool's own default applies, rather than Jev
inventing a value.

**Why two stages, against the pure fan-out doctrine:** the cookbook's own worked example
measured 10 functions / 28 arguments → 54 questions. Orbit will have 40–60 tools; filling
every tool's arguments speculatively would run to several hundred questions per utterance.
So stage 1 always runs; stage 2 runs only on the native path. To keep the common case at one
round trip, stage 1 also carries pre-filled arguments for the handful of statistically
dominant tools (`applications.open`, `system.volume.set`, `applications.close`).

**Call confidence is the minimum of the judgments actually used**, per the cookbook — not
the product, which decays with argument count and answers a different question ("is every
part right" vs "how sure am I in the weakest link").

## Feeding Jev safely

- **Untrusted content is never mixed with a privilege-bearing decision.** File contents, web
  pages, terminal output, and agent output go into a *separate* Jev request whose questions
  can only produce advisory signals — never a tool choice, model choice, or permission
  outcome. This follows directly from the documented adversarial-content weakness.
- **Context rot is real** — TypeSafe's docs state accuracy falls as `state` grows with
  irrelevant detail. The Context Broker sends named, filtered fields, never a machine dump.
- Tool lists inside `state` are names + one-line descriptions only.
- **Thresholds are tuned per question and never carried across primitives.** A threshold
  calibrated on a `Noul` must not be reused for an equivalent `Choice` — TypeSafe documents
  that a Noul and its Choice equivalent do not agree numerically (documented example: Noul
  0.22 vs Choice `yes` 0.01).

## Degradation — Jev is never a single point of failure

```
Jev unavailable / 429 / 529 / timeout(400 ms)
  → deterministic rules only (exact aliases, recent commands, explicit syntax)
  → if unresolved: present a ranked disambiguation UI, let the user choose
  → explicit provider/model selection always works regardless of Jev's state
  → NEVER auto-escalate to an agent provider to compensate for Jev's absence
```

That last line matters on its own: silently substituting an expensive, privacy-broader
agent for an unavailable classifier would be both a cost surprise and a privacy surprise.
The UI surfaces `Jev ● unavailable — deterministic mode` explicitly rather than hiding the
degradation.

Stage-1 answers are cached, keyed by `hash(normalized_request + context_fingerprint)`, with
a short TTL — repeated phrasings of the same intent cost nothing on a warm cache.

## Evaluation

Routing accuracy, confidence calibration, and threshold tuning are measured against a
growing corpus of labelled requests (target ≥200 before Phase 5 exits) rather than assumed.
See `tests/jev-eval/`.
