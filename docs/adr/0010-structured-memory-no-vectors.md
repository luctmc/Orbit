# ADR-0010: SQLite structured memory; no vector database until measured need

**Status:** Proposed
**Date:** 2026-09-21

## Context

The product brief explicitly warns against "transform[ing] everything into a vector
database without necessity." Orbit's memory needs (aliases, known apps/projects,
preferences, tool grants, recent tasks) are all small, structured, and already have natural
keys.

## Decision

Memory is stored in SQLite with FTS5 for text search. Retrieval follows the pattern:
**candidate generation in code (SQL/FTS5 + recency), selection by Jev** (a `Choice` over at
most 255 candidates). No embeddings or vector index in the MVP. See
[memory.md](../architecture/memory.md).

## Reasoning

This is the exact pattern TypeSafe's own docs describe as "select instead of generate" —
find candidates with ordinary code, let a `Choice` question pick the intended one. For
Orbit's memory shapes (a project alias, a recent task, a known app), a candidate set from
SQL is already small and well-structured; adding vector search would add infrastructure
and an embedding-drift maintenance burden without a demonstrated retrieval problem it
solves.

## Consequences

- If a future phase shows a measured retrieval failure that ranking cannot fix (e.g.
  genuinely fuzzy natural-language matching over large free-text notes), embeddings are
  reconsidered then, scoped to that specific data — not adopted as a platform-wide default.
