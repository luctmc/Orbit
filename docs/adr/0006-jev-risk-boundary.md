# ADR-0006: Jev may only escalate computed risk, never compute or lower it

**Status:** Proposed
**Date:** 2026-09-21

## Context

The original product brief sketched a `Score: action_risk` question answered directly by
Jev. TypeSafe's own documentation states that `jev-1.13` does not treat its input as
hostile by default ("Content written to adversarially steer the model… can move the
answer") and is unreliable at arithmetic, counting, and threshold-sensitive judgments.

## Decision

Risk classification is computed **deterministically, in code**, from the resolved tool and
its concrete arguments (see [permissions.md](../architecture/permissions.md)). Jev may
contribute *signals* (`sounds_destructive`, `touches_private`, `scope_breadth`,
`is_ambiguous`) that can only **raise** a computed risk class, never lower one, and can
never by themselves authorize an action.

## Reasoning

This is a direct, deliberate departure from the product brief's original sketch, and the
brief itself asked to be told plainly if an idea was technically wrong rather than agreed
with by default. A model documented as steerable by adversarial input and as unreliable at
threshold math is structurally unsafe as the sole source of a risk decision — an attacker
who can influence a file's content, a window title, or agent output could otherwise
manipulate `action_risk` downward and unlock an auto-approval. Making the signal
one-directional (escalate-only) removes that failure mode by construction: the worst a
successful manipulation can achieve is *more* caution, never less.

## Consequences

- `Score: action_risk` as originally sketched does not exist as a standalone decision;
  its role is absorbed into a set of escalation-only Noul/Score signals.
- Every risk-relevant Jev question must be documented with which direction it is allowed to
  move a decision, and this must be tested (see the Security testing layer).
