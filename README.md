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
- Status do agente vem da atividade do terminal (`rodando`/`ocioso`). `espera você` depende dos hooks.

Próximos passos: shell Tauri (requer Rust), servidor MCP local para os agentes se coordenarem
(abrir ajudantes, retornos/handoffs), hooks do Claude Code para status real.
