# Permission Engine

The Permission Engine is Orbit's single chokepoint to the operating system. No tool call —
whether proposed by Orbit's own router, by Jev, or by an external agent provider — executes
without passing through it.

## Risk classes — computed, never judged

| Class | Meaning | Default posture (STANDARD mode) |
| --- | --- | --- |
| `READ_ONLY` | observes only | auto-allow |
| `REVERSIBLE` | changes state, Orbit can undo it | auto-allow, undo recorded |
| `SIDE_EFFECT` | visible change, no clean undo (launch/close app, volume) | auto-allow |
| `SENSITIVE` | touches private data, credentials, private folders | always ask |
| `DESTRUCTIVE` | deletes/overwrites; batch operations | always ask, preview required |
| `CRITICAL` | sends/publishes, purchases, installs, security/firewall changes, elevation | **always ask, never auto-approvable in any mode** |

Risk is a deterministic function of the resolved tool **and its arguments** — never a
judgment call handed to a model. TypeSafe's own docs state that `jev-1.13` does not treat
its input as hostile by default and cannot reliably do math; a system that let it *set* the
risk class would be exactly as steerable as its most adversarial input. See
[jev.md](./jev.md) for the full boundary.

## Evaluation order

```
1. schema validation            → reject malformed
2. capability check             → reject unavailable on this platform/permission tier
3. DENY rules                   → reject (wins in every mode, including the most autonomous)
4. compute risk from tool+args  → deterministic
5. Jev escalation signals       → may RAISE the class, never lower it
6. autonomy mode + grants       → auto-allow / prompt / defer
7. execute, with undo registered first
8. audit
```

**Step 5 is the load-bearing asymmetry.** A Jev signal like `sounds_destructive ≥ 0.6` or
`scope_breadth ≥ 1.5` can promote `REVERSIBLE` → `SENSITIVE`, but a low score can never
demote anything. This is the only safe way to consume a signal from a model that is
documented as steerable by adversarial content in its input.

Confidence thresholds scale with the risk class, mirroring TypeSafe's own documented
pattern: a read-only route may act at confidence ≥ 0.5; a destructive one requires > 0.9
*and* explicit user confirmation regardless of confidence.

## Grants

`allow once` · `allow for this session` · `always allow` (scoped) · `deny` · `deny always`.
Scopes: `tool`, `tool+argument-pattern`, `folder`, `application`. Every "always" grant is
listed in Settings, individually revocable, and re-confirmed if the tool's schema version
changes underneath it.

## Autonomy modes

| Mode | Behaviour |
| --- | --- |
| `GUARDED` | prompts from `SIDE_EFFECT` upward |
| `STANDARD` *(default)* | auto `READ_ONLY`/`REVERSIBLE`/`SIDE_EFFECT`; prompts `SENSITIVE`+ |
| `EXTENDED` | additionally auto-allows `SENSITIVE`, but only inside pre-approved scopes |
| `CUSTOM` | per-namespace rules |

**`CRITICAL` always prompts, in every mode, with no configuration to disable it** —
mirroring Antigravity's own documented rule that admin-escalation permissions "cannot be
auto-approved and will always prompt the user."

## Adjudicating external agents

One interception point is provably insufficient on the provider that has the best-looking
single mechanism (Claude Code), so Orbit runs two gates on every provider:

| Provider | Primary gate | Belt-and-braces gate |
| --- | --- | --- |
| Claude Code | stdio `can_use_tool` control request (UX + `updatedInput` rewriting) | `PreToolUse` hook injected via `--settings` — the *only* thing that runs on every call in every mode, since auto-approved calls never reach the callback |
| Codex | app-server `requestApproval` methods (allow / allow-for-session / deny / cancel / `acceptWithExecpolicyAmendment`) | `hooks.json` (`pre_tool_use`, etc.), trust-gated by `trusted_hash` |
| Antigravity | `PreToolUse` hook (allow / deny / ask / force_ask) | declarative `permissions.{allow,deny,ask}` in settings.json |

Default posture per provider: Codex ships with `approval_policy = "on-request"` and
`sandbox_mode = "workspace-write"`; **`--dangerously-bypass-approvals-and-sandbox` is never
shipped.** Under Antigravity's headless `-p`, an `ask`/`force_ask` verdict has no TUI to
resolve it and soft-denies by default — Orbit's hook must always return a real decision.

**Where a provider supports it, Orbit prefers rewriting a proposed action over denying
it** — confining a path, dropping a flag, narrowing a glob (`updatedInput` on Claude Code,
`acceptWithExecpolicyAmendment` on Codex). A denial carrying a `message` is the second
choice: it lets the agent change approach rather than simply fail, which keeps a task
moving without ever widening what it's allowed to do.

## Escalation gate: fallback across providers

Cross-provider fallback (§12 of the product brief) is never silent. A private-scoped task
never falls back to a different provider regardless of settings; a general task falls back
only if `Allow cross-provider fallback` is explicitly on, and the fallback event is audited
identically to a tool call.
