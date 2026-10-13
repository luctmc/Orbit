# Overclock → Orbit: mapa de arquitetura (engenharia reversa)

> Alvo: `/Applications/Overclock.app` v1.4.13 (`sh.overclock.app`), macOS arm64.
> Ferramenta: REA 6.4.0 (`inspect-artifact`, `inspect-macho`, `analyze-javascript-application`) + observação de runtime.
> Data: 2026-10-13.
>
> **Regra do Orbit: clean-room.** Este documento descreve *comportamento e arquitetura* observáveis.
> Nada de código, prompts, playbooks ou assets do Overclock entra no Orbit — reimplementamos tudo.
> O núcleo do Overclock (`sidecar/dist/index.jsc`) é bytecode V8 protegido (bytenode + checagem de hash);
> **não** foi e não será decompilado.

## 1. Visão geral — 3 camadas

```
┌──────────────────────────── Overclock.app ─────────────────────────────┐
│ Shell Tauri 2 (Rust, binário `overclock`)                              │
│  • WebView (WebKit) servindo o renderer (packages/shell/out/renderer)  │
│  • spawn + supervisão do sidecar Node (respawn, integrity hash)        │
│  • menu nativo, deep-link `overclock://callback`, updater, áudio (AEC) │
│  • crate próprio `browser-pane` (navegador embutido + snapshot)        │
│              │ WebSocket (tauri-plugin-websocket) 127.0.0.1           │
│              ▼                                                         │
│ Sidecar Node (bin/node + dist/index.js → index.jsc)                    │
│  • "Overclock core": bus, catalog, core, ipc-types, mcp, pty           │
│  • servidor MCP HTTP  http://127.0.0.1:<porta>/mcp/claude?...           │
│  • PTY (xterm) → spawna CLIs de agente como "panes"                    │
│  • @anthropic-ai/claude-agent-sdk, Sentry, Discord RPC                 │
│              │ spawn por pane                                          │
│              ▼                                                         │
│ Panes = processos CLI reais: `claude`, `codex` (gemini/grok normalizados)│
│  --mcp-config ~/.overclock-app/mcp-pane-<id>.json  (MCP do sidecar)    │
│  --settings  claude-mcp-policy-pane-<id>.json      (hooks + statusline)│
└────────────────────────────────────────────────────────────────────────┘
```

**Insight central:** o Overclock *não* reimplementa um agente. Ele é um **orquestrador de CLIs de agente
existentes** (Claude Code, Codex…) rodando em PTYs, coordenados por (a) um **servidor MCP local** que
expõe ferramentas de orquestração e (b) **hooks** do Claude Code que reportam estado de volta.

## 2. Shell nativo (Rust / Tauri 2)

| Item | Evidência |
|---|---|
| Plugins Tauri | updater 2.10.1, deep-link, dialog, clipboard-manager, notification, single-instance, websocket (strings do binário) |
| Updater | endpoint em GitHub Releases (`.../releases/latest/download/latest.json`) |
| Supervisão do sidecar | strings: `sidecar caiu`, `respawn do sidecar falhou`, `app:sidecar-restarted`, `engine_recover`, `quit-gate timeout` |
| Integridade | `sidecar_integrity_failed: hash do index.jsc` — hash SHA-256 embutido no binário |
| Resolução do Node | procura `OVERCLOCK_NODE_BIN`, volta, `.npm-global`, `/opt/homebrew/bin`, `/usr/local/bin`; usa `sidecar/bin/node` empacotado |
| CSP | `connect-src http://ipc.localhost http://127.0.0.1:* http://localhost:*` |
| Áudio | CoreAudio/AudioToolbox, "Process Tap exige macOS 14.2+", "Overclock AEC Tap" → captura de voz com cancelamento de eco (ClockVoice) |
| Browser pane | crate Rust próprio `packages/browser-pane/crate` (lib.rs, snapshot.rs) |
| Auth | deep-link `overclock://callback`, `access_token`/`refresh_token` → `~/.overclock-app/session.json` |
| Env vars | `OVERCLOCK_HOME`, `OVERCLOCK_DATA_DIR`, `OVERCLOCK_SIDECAR_PATH`, `OVERCLOCK_RESOURCES_DIR`, `OVERCLOCK_VERBOSE_LOGS`, `OVERCLOCK_DEV_INSTANCE`, `OVERCLOCK_BOT_MODE` |

## 3. Sidecar (Node)

- `package.json`: `@overclock-app/sidecar` — "WebSocket host serving Overclock core for Tauri migration"
  (ou seja: antes era Electron; o core migrou para um processo Node separado).
- Monorepo pnpm interno: `@overclock-app/{bus,catalog,core,ipc-types,mcp,pty}` (tudo bundlado no `.jsc`).
- Deps relevantes: `claude-agent-sdk`, `@modelcontextprotocol/*`, `hono`/`express` (HTTP MCP), `ws`, `@xterm/*`,
  `zod`, `yaml`, `smol-toml`, `selfsigned`, `undici`, `@sentry/node`, `@xhayper/discord-rpc`.
- Escuta em 3 portas TCP em 127.0.0.1 (MCP HTTP, WS do renderer, relay).
- `arms-mcp/` (JS puro): proxy/descoberta MCP + `boardRelay` (relay para o board de cards).

## 4. Modelo de domínio (inferido do estado em `~/.overclock-app/`)

| Arquivo | Conteúdo (só schema) | Conceito |
|---|---|---|
| `workspaces.json` | `recent[].{path,lastOpened}` | Workspace = pasta de projeto |
| `missions.json` | `{id,title,objective,type,status,workspaceId,createdAt,updatedAt,archived*}` | Missão (tipo `agentic`, squad…) |
| `squads.json` | `squads[].{id,name,builtin,orchestratorInstructions,agents[].{agentName,cli,model,effort,category,allowedSkills}}` | Squad = time de agentes |
| `providers.json` | `providers[].{type,authMode,env.ANTHROPIC_BASE_URL/…,models}`, `accountOrder`, `cliOrder` | Multi-provider / multi-conta |
| `config.json` | `harnessTable.{categories,rows}`, `decisions.*`, `mediaDefaults`, `agenticOrchestrator*` | Tabela "harness": tipo de tarefa → modelo/agente |
| `messages.db` (SQLite) | `catalog_items(type,name,installations,identity_key,disabled,…)` | Catálogo de skills/agents/MCPs instalados |
| `sidecar.json` | `{pid,port,token,mcp,orchestrator,version}` | Descoberta do sidecar |
| `usage-*.json(l)`, `token-activity.json` | — | Telemetria de custo/tokens |
| `resources/<pack>/PLAYBOOK.md + agents/ + skills/` | — | "Packs" de squad embutidos (cinema, qa-swarm, …) |

## 5. Mecanismo de pane (o coração)

Para cada pane o sidecar escreve 3 artefatos e spawna o CLI num PTY:

1. **`mcp-pane-<id>.json`** — MCP `overclock` via HTTP com contexto na query string:
   `toolProfile` (orchestrator/worker), `model`, `workspacePath`, `cwd`, `missionId`, `callerPaneId`,
   `allowedCLIs`, `squadRole`, `missionType` + header `Authorization` (token por sessão).
2. **`claude-mcp-policy-pane-<id>.json`** (passado como settings): `bypassPermissions`, `statusLine` custom e
   **hooks** em `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`.
3. **Scripts de hook** (`.mjs`):
   - `soft-status.mjs` — normaliza eventos de Claude/Codex/Gemini/Grok e reporta status do pane (rodando, esperando humano, ocioso).
   - `skill-gate-pane-<id>.mjs` — `PreToolUse` que **bloqueia** skills/tools fora da whitelist do agente no squad.
   - `handoff-stop.mjs` — no `Stop`, força o worker a fechar com um *handoff* (resultado estruturado) para o pai.
   - `agentic-pilot-rule.mjs` — injeta regra do "piloto" no prompt.
   - `statusline-model.mjs` — status line mostrando modelo/estado.

Ferramentas MCP expostas aos panes (do skill `oc-mcp` instalado nesta máquina — documentação pública):
`pane_spawn / pane_write / pane_read / pane_wait / pane_list / pane_close / pane_whoami`,
`handoff_submit / handoff_list`, `overclock_mission / list / squad / clarify / navigate / status / browser_act / media_generate`.

## 6. Features observadas → candidatas para o Orbit

1. Workspaces + missões persistidas.
2. Panes = CLIs de agente em PTY com xterm no UI.
3. Servidor MCP local de orquestração (spawn/ler/esperar panes, handoffs).
4. Hooks para status em tempo real + gates de permissão por agente.
5. Squads (times com papéis, modelos, whitelists de skills) + "harness table".
6. Multi-provider / multi-conta (Claude OAuth, Codex, OpenRouter, base URL custom).
7. Catálogo de skills/agents/MCPs (SQLite).
8. Browser pane nativo, voz (AEC), board de cards, mídia, Discord RPC, updater.

## 7. Próximas sondas REA (pendentes)

- UI: `capture-native-ui-scenario` na janela do Overclock (layout, navegação, estados).
- `arms-mcp`: `analyze-javascript-application` focado (proxy/discovery/boardRelay).
- Lista exata de tools MCP: `tools/list` no MCP local (introspecção do contrato, não do código).
