# Memory Architecture

SQLite, structured, **no vector database in the MVP** — see
[ADR-0010](../adr/0010-structured-memory-no-vectors.md).

## Shape

| Kind | Example | Retrieval |
| --- | --- | --- |
| Aliases | "meu projeto RenderView" → `~/Projects/RenderView` | exact + trigram |
| Known apps | bundle ids, display names, launch counts | exact + recency |
| Known projects | path, VCS, last opened, build command | recency |
| Preferences | default provider, model, effort, autonomy mode | key lookup |
| Tool grants | scoped permissions (see [permissions.md](./permissions.md)) | indexed lookup |
| Recent tasks | for "continua aquele trabalho do RenderView" | recency + FTS5 |

## Retrieval pattern

**Candidate generation in code, selection by Jev** — this is TypeSafe's own documented
"select instead of generate" pattern. SQLite FTS5 plus recency scoring produces at most 255
candidates (the `Choice` primitive's own limit); a single `Choice` question picks the
intended one. This is cheaper, more debuggable, and more accurate for this kind of data than
embeddings would be, because the candidate set is already small and structured.

Embeddings and full semantic retrieval are explicitly deferred until there is a *measured*
retrieval failure that ranking alone cannot fix — not adopted preemptively because "AI
apps use vector databases."

## Governance

All memory is user-visible, editable, and deletable from Settings. Every entry carries a
`source` (`inferred | confirmed | user_set`); inferred entries carry a TTL and expire —
they were never confirmed by the user and should not accumulate authority simply by
persisting. No memory entry can, by itself, grant a permission; see
[permissions.md](./permissions.md) for why (ASI11 in [security.md](./security.md):
memory poisoning).
