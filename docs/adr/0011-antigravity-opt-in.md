# ADR-0011: Antigravity ships opt-in, disclosed, single-account, second-tier

**Status:** Proposed
**Date:** 2026-09-21

## Context

Google Antigravity's official FAQ states: *"Using third party software, tools, or services
to access Antigravity is a violation of our Terms of Service,"* with account suspension or
termination as the stated consequence, landing on the *user's* Google account rather than on
Orbit. Separately, no `CLAUDE_CONFIG_DIR`/`CODEX_HOME` analogue exists for Antigravity — a
full string scan of the `agy` binary found no user-facing config-dir override — so
multi-account is not officially supported.

## Decision

- Antigravity ships as an **opt-in, explicitly disclosed, second-tier provider** — never the
  default engine, and never a silent cross-provider fallback target.
- Antigravity is documented and presented in the UI as **single-account only**.
  `HOME`-shadowing or any other unofficial multi-account workaround is explicitly rejected,
  per the product brief's own instruction: "if multiple simultaneous profiles are not
  officially supported by a provider, do NOT invent a solution — document the limitation."

## Reasoning

Driving the official `agy` binary through its own official, purpose-built headless
interface (`-p --output-format stream-json --input-format stream-json`, which the vendor's
own changelog says exists "so a driver can keep a session open") is a defensible reading of
a broad, unqualified ToS clause — but the enforcement risk is the user's, not Orbit's, and
that asymmetry means the decision belongs to the user, made explicitly, not assumed by
default on their behalf.

On multi-account: `HOME`-shadowing was considered and rejected specifically because on
macOS the Keychain ACL is bound to the code-signed binary, not to `HOME` — so the workaround
would not actually achieve isolation, only the appearance of it.

## Consequences

- The provider-selection UI must carry a visible disclosure the first time a user connects
  Antigravity, not buried in settings.
- Orbit must capability-probe `agy --help` at every startup rather than caching a version,
  since the binary self-updates without a documented pin mechanism (observed: 1.2.0 → 1.2.7
  mid-session, with a changed flag default).
- If Google later documents a supported multi-account mechanism, this ADR is revisited.
