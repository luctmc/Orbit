# ADR-0007: No hardcoded models or efforts — runtime discovery with an alias floor

**Status:** Proposed
**Date:** 2026-09-21

## Context

The product brief is explicit that Orbit must never hardcode a model list, and that effort
levels must be discovered per provider. Research found this requirement was well-founded
and, more specifically, that **effort support varies per model within a single provider**:
Claude Code's Opus 5 supports `xhigh`/`max` while Opus 4.6 and Sonnet 4.6 do not; Codex's
`gpt-6-astra` supports `max`/`ultra` while `gpt-5.5` does not.

## Decision

```
probe provider → discoverModels() → normalize → OrbitModelRegistry → cache(etag/ttl) → UI
                       ↓ on failure
              last good cache → static alias floor → manual entry
```

`OrbitModelDescriptor.supportedEfforts` is a per-model field, populated from the provider's
own discovery mechanism where one is reliable, and the effort picker always renders from the
*selected model's own* list — never from a global enum. A requested effort is validated
against that list before a session launches.

## The alias floor

Discovery quality differs sharply by provider (see
[providers.md](../architecture/providers.md)): Codex's `model/list`/`codex debug models` is
a genuinely dynamic, etag-cached server catalog; Claude Code's equivalent (`list_models`) is
an internal, undocumented control request that may break on any minor version; Antigravity's
`agy models --output-format json` is documented in the changelog but **broken in the
installed 1.2.7 binary**.

Because discovery reliability cannot be assumed uniformly, Orbit ships a static "alias
floor" per provider — Claude Code's documented aliases (`opus`, `sonnet`, `haiku`, `fable`,
`opusplan`) are the concrete example — as a guaranteed baseline that degrades to when
discovery fails, rather than failing the whole model picker.

## Consequences

- Model IDs are never hardcoded in application code, only alias names, because alias→ID
  resolution is itself provider-dependent (Anthropic API vs Bedrock vs Vertex vs Foundry
  resolve differently).
- The registry cache must record `source: 'runtime-api' | 'cache' | 'alias-floor' |
  'manual'` so the UI can be honest about how current the shown capability set is.
