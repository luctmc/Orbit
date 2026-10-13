# Orbit

Orquestrador de agentes de código (Claude Code, Codex…) rodando em terminais reais, organizados em
workspaces e missões.

## Estrutura

| Pasta | O que é |
|---|---|
| `packages/protocol` | Tipos do contrato UI ↔ sidecar (JSON sobre um WebSocket) |
| `packages/sidecar` | Núcleo em Node: workspaces, missões, agentes em PTY (`node-pty`), estado em `~/.orbit/state.json` |
| `apps/desktop` | Interface React + xterm.js (tela de missão). O shell Tauri entra aqui em `src-tauri/` |
| `docs/reverse-engineering` | Mapa de arquitetura e de UI do Overclock usado como referência (clean-room) |

## Rodando

Requer Node ≥ 24.11.

```bash
npm install
npm run dev
```

Abre o sidecar em `ws://127.0.0.1:4317/ws` e a interface em http://localhost:5273. O `dev` gera um
token novo a cada execução; o sidecar só aceita conexões com esse token e vindas da origem da UI.
Para usar outra pasta de dados: `ORBIT_HOME=/caminho npm run dev`.

```bash
npm run typecheck
npm test
```

## Estado atual

- Tela de missão: workspaces em abas, missões, tripulação, agentes em grade/foco com terminal real,
  barra de comando para o agente selecionado, fluxo da missão.
- **MCP do Orbit** (`POST /mcp`, um token por agente): o líder abre ajudantes (`agent_spawn`),
  conversa (`agent_send`), lê a tela deles (`agent_read`), fecha (`agent_close`) e consulta
  `agent_list`, `mission_status`, `handoff_list`. Ajudantes entregam com `handoff_submit`, que
  registra no fluxo e digita o retorno no terminal do líder.
- **Hooks do Claude Code** (`POST /hooks`): status real (`rodando`, `ocioso`, `espera você` com o
  motivo). Codex e terminais usam a atividade do terminal.
- Missão **agêntica**: o líder recebe o objetivo e as instruções de papel e monta o time sozinho.

### Como um agente é lançado

Para cada agente o sidecar escreve em `~/.orbit/panes/<id>/` (modo 0600): `mcp.json`,
`settings.json` (hooks), `role.md` e `task.md`. O CLI roda num login shell com
`--mcp-config`, `--settings`, `--append-system-prompt "$(cat role.md)"` e a tarefa como primeiro
prompt; texto livre nunca vai direto para a linha de comando. O token do agente só existe no
ambiente dele (`ORBIT_PANE_TOKEN`) e o auto-update do Claude fica desligado nos agentes, para
vários processos não atualizarem a mesma instalação ao mesmo tempo.

Próximos passos: shell Tauri (requer Rust), squads com roteiro.
