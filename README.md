# Orbit

Orquestrador de agentes de código (Claude Code, Codex…) rodando em terminais reais, organizados em
workspaces e missões.

## Estrutura

| Pasta | O que é |
|---|---|
| `packages/protocol` | Tipos do contrato UI ↔ sidecar (JSON sobre um WebSocket) |
| `packages/sidecar` | Núcleo em Node: workspaces, missões, agentes em PTY (`node-pty`), estado em `~/.orbit/state.json` |
| `apps/desktop` | Interface React + xterm.js (tela de missão) |
| `apps/desktop/src-tauri` | Shell Tauri 2 (Rust): janela nativa, inicia e supervisiona o sidecar e entrega `{porta, token}` à interface por IPC |
| `docs/reverse-engineering` | Mapa de arquitetura e de UI do Overclock usado como referência (clean-room) |

## Rodando

Requer Node ≥ 24.11 e, para o app nativo, Rust (`rustup`).

```bash
npm install
npm run app          # app nativo (Tauri) com hot reload da interface
npm run app:build    # gera Orbit.app em apps/desktop/src-tauri/target/release/bundle/macos/
npm run dev          # só sidecar + interface no navegador (http://localhost:5273)
```

O token do sidecar é novo a cada execução: no app o shell Rust o gera e repassa à interface por
IPC; no `npm run dev` o script o gera e o Vite o injeta. O sidecar só aceita conexões com esse
token e vindas da origem da interface. Para usar outra pasta de dados: `ORBIT_HOME=/caminho`.

No app, o sidecar roda com o `node` do seu login shell (ou `ORBIT_NODE`). Se o app cair, o
sidecar percebe o stdin fechado e encerra os agentes junto; se o sidecar cair, o shell o reinicia.

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
- Missão **agêntica**: o líder recebe o objetivo e as instruções de papel e monta o time sozinho,
  classificando cada atividade na tabela **Quem faz cada tarefa** (Ajustes): cada tipo de tarefa
  define agente, modelo, esforço (`--effort` no Claude, `model_reasoning_effort` no Codex) e
  skills sugeridas. O líder passa `kind` no `agent_spawn` e o Orbit aplica a linha.
- Missão de **squad**: um time com papéis (agente, modelo e instruções de cada um) e um roteiro
  que o líder segue. O líder abre cada papel com `agent_spawn` + `role`; o Orbit aplica o CLI, o
  modelo e as instruções do papel. Vêm três squads prontos (Caça-bugs, Funcionalidade,
  Auditoria), só leitura; dá para duplicá-los ou criar os seus na tela **Squads** (salvos em
  `state.json`). Ao abrir um agente à mão numa missão de squad, dá para escolher o papel.

### Como um agente é lançado

Para cada agente o sidecar escreve em `~/.orbit/panes/<id>/` (modo 0600): `mcp.json`,
`settings.json` (hooks), `role.md` e `task.md`. O CLI roda num login shell com
`--mcp-config`, `--settings`, `--append-system-prompt "$(cat role.md)"` e a tarefa como primeiro
prompt; texto livre nunca vai direto para a linha de comando. O token do agente só existe no
ambiente dele (`ORBIT_PANE_TOKEN`) e o auto-update do Claude fica desligado nos agentes, para
vários processos não atualizarem a mesma instalação ao mesmo tempo.

Próximos passos: Node embutido no `.app`, assinatura e notarização.
