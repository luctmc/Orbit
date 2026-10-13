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

Para desenvolver: Node ≥ 24.11 e, para o app nativo, Rust (`rustup`). O `Orbit.app` gerado não
depende do Node da máquina: o build baixa o Node oficial (v24.21.0, Apple Silicon) de nodejs.org,
confere o SHA-256 com o `SHASUMS256.txt` da versão, guarda em cache em `apps/desktop/build/` e o
coloca dentro do app (`scripts/fetch-node.mjs`). `ORBIT_NODE` continua valendo para trocar o Node.

```bash
npm install
npm run app          # app nativo (Tauri) com hot reload da interface
npm run app:build    # gera Orbit.app em apps/desktop/src-tauri/target/release/bundle/macos/
npm run dev          # só sidecar + interface no navegador (http://localhost:5273)
```

O token do sidecar é novo a cada execução: no app o shell Rust o gera e repassa à interface por
IPC; no `npm run dev` o script o gera e o Vite o injeta. O sidecar só aceita conexões com esse
token e vindas da origem da interface. Para usar outra pasta de dados: `ORBIT_HOME=/caminho`.

No app de release, o sidecar e os hooks rodam no Node embutido; em `npm run app` (dev), no `node`
do seu login shell (ou `ORBIT_NODE`). Se o app cair, o
sidecar percebe o stdin fechado e encerra os agentes junto; se o sidecar cair, o shell o reinicia.

```bash
npm run typecheck
npm test
```

## Estado atual

- **Workspaces com várias pastas**: um workspace junta uma ou mais pastas (a primeira é a
  principal, onde os agentes começam). No app as pastas vêm do seletor nativo do macOS; no
  navegador, colando o caminho. Todo agente recebe as outras pastas com `--add-dir` (Claude e
  Codex) e a lista delas nas instruções; o `whoami` do MCP também devolve as pastas.
- Tela de missão: workspaces em abas, missões, tripulação, agentes em grade/foco com terminal real,
  barra de comando para o agente selecionado, fluxo da missão.
- **MCP do Orbit** (`POST /mcp`, um token por agente): o líder abre ajudantes (`agent_spawn`),
  conversa (`agent_send`), lê a tela deles (`agent_read`), fecha (`agent_close`) e consulta
  `agent_list`, `mission_status`, `handoff_list`. Ajudantes entregam com `handoff_submit`, que
  registra no fluxo e digita o retorno no terminal do líder.
- **Modelos e esforços reais**: o catálogo do Codex vem de `codex debug models` (modelos listados
  e os esforços que cada um aceita, de `low` a `ultra`); o Claude Code não lista modelos, então o
  Orbit oferece os aliases (`opus`, `sonnet`, `haiku`, `fable`) e os ids atuais, com
  `low`…`max`. Os seletores só mostram os esforços do modelo escolhido, e o sidecar recusa um
  esforço que o modelo não aceita.
- **Atualizar as CLIs** (Ajustes › Agentes e CLIs): versão instalada, forma de instalação (npm,
  nativo, Homebrew) e a mais recente; atualiza pelo mesmo meio (`claude update` ou
  `npm install -g …@latest`). No Claude via npm, roda o `install.cjs` do pacote em seguida, porque o
  npm 12 bloqueia o script que copia o binário nativo.
- **Contas** (Ajustes › Contas): além do login do Claude e do Codex deste Mac, dá para
  adicionar outras assinaturas (cada uma numa pasta própria, via `CLAUDE_CONFIG_DIR` ou
  `CODEX_HOME`, com login por um terminal dentro do Orbit) e chaves de API: Anthropic, OpenRouter
  ou outro endereço compatível para o Claude (com modelo próprio, que vale também para os aliases)
  e OpenAI para o Codex. Configurações, instruções, skills e agentes da pasta de sempre são
  compartilhados por links; os logins não. Ao abrir um agente sem escolher conta, o Orbit usa a
  assinatura com mais folga nos limites e só passa para uma chave de API (se ela estiver liberada
  para isso) quando todas estiverem acima de 95%. A chave fica em
  `~/.orbit/accounts/<id>/key` (0600): o Claude a lê por `apiKeyHelper`, o Codex recebe por
  `codex login --with-api-key` lendo do arquivo, e ela nunca volta para a interface.
- **Uso de tokens e limites**: cada agente mostra os tokens da sessão e quanto do contexto está
  ocupado; a missão soma os agentes e a Base mostra os tokens por dia (Claude e Codex) nos últimos
  12 meses. A barra de título mostra o uso das janelas de 5 h e semanal de cada conta, com quando
  renovam, por conta. O Claude manda os dados pela status line do Orbit (`POST /status`, com o token do
  agente); do Codex, o sidecar lê o arquivo de sessão em `~/.codex/sessions` aberto na pasta do
  agente. O custo que o Claude informa é o equivalente em preço de API (não é cobrado em
  assinatura). Os limites só aparecem depois da primeira chamada de cada CLI.
- **Hooks do Claude Code** (`POST /hooks`): status real (`rodando`, `ocioso`, `espera você` com o
  motivo; o Claude avisa alguns segundos depois de abrir o pedido de permissão). Codex e terminais
  usam a atividade do terminal, então um pedido de confirmação do Codex aparece como `rodando`.
- As ferramentas do MCP do Orbit são pré-aprovadas nos agentes (`permissions.allow: mcp__orbit`
  no Claude, `default_tools_approval_mode = "approve"` no Codex): só coordenam a missão, e pedir
  permissão a cada retorno travaria agentes em modo manual (ou recusaria tudo no Codex com
  política `never`).
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
`settings.json` (hooks e status line), `role.md` e `task.md`. O CLI roda num login shell com
`--mcp-config`, `--settings`, `--append-system-prompt "$(cat role.md)"` e a tarefa como primeiro
prompt; texto livre nunca vai direto para a linha de comando. O token do agente só existe no
ambiente dele (`ORBIT_PANE_TOKEN`) e o auto-update do Claude fica desligado nos agentes, para
vários processos não atualizarem a mesma instalação ao mesmo tempo.

Próximos passos: assinatura e notarização do `.app`; build para Macs Intel.
