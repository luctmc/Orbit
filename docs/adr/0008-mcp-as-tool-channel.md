# ADR-0008: MCP is the single distribution channel for Orbit's tool registry

**Status:** Proposed
**Date:** 2026-09-21

## Context

All three providers consume MCP servers with near-identical configuration schemas
(`mcpServers`/`mcp_servers` maps, stdio or HTTP transports), and all three support
injecting MCP configuration per-invocation without writing to the user's own config files:
Claude Code via `--mcp-config` + `--strict-mcp-config`, Codex via `-c
mcp_servers.orbit.*` overrides, Antigravity via its config-file mechanism.

## Decision

Orbit's canonical tool registry (see [tools.md](../architecture/tools.md)) is exposed to
every provider through **one** MCP server adapter, injected per-invocation, rather than
three separate tool-integration paths.

## Reasoning

This directly answers the product brief's instruction not to build "three tool ecosystems
completely independently and inconsistently." Not every Orbit tool is exposed this way —
`ToolDefinition.exposeToAgents` lets internal-only tools stay out of the MCP surface — but
whatever *is* exposed goes through one code path with one schema translation, tested once.

## Consequences

- A single `packages/mcp-orbit-server` package is the only place that translates Orbit's
  internal tool schema into the MCP tool-call shape; provider adapters never do this
  translation themselves.
- Tool calls arriving via MCP still pass through the Permission Engine identically to
  tool calls Orbit's own router proposes — MCP is a distribution mechanism, not a
  permission boundary (see [ADR-0005](./0005-permission-engine-chokepoint.md)).
