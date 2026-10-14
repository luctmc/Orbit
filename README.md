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
- **Missões agendadas** (Base › Agendadas): um modelo de missão roda sozinho uma vez numa data,
  em dias e horário (ex.: dias úteis às 9:00) ou a cada N horas, enquanto o Orbit estiver aberto.
  Se ele estava fechado na hora, a missão começa assim que abrir (uma vez só). Por padrão pula a
  vez se a missão anterior do agendamento ainda tem agentes trabalhando. Dá para pausar, rodar
  agora, editar e apagar; um aviso diz quando uma missão agendada começa.
- **Relatório da missão** (botão na missão): objetivo, números (agentes, tokens, custo, cartões,
  retornos), cada agente (inclusive os já fechados, pelo fluxo), o quadro, os retornos dos
  ajudantes, as mudanças no código (commits e arquivos do branch e o PR com o CI, ou o que mudou
  nas pastas com quem editou) e a linha do tempo, em Markdown. Dá para copiar, salvar como `.md`
  e usar como descrição do PR.
- **Instruções do workspace** (Editar workspace): convenções, comandos e cuidados que todo agente
  daquele workspace recebe nas instruções.
- **Modelos de missão**: "Salvar como modelo" (na missão) guarda título, objetivo, modo, squad,
  líder, o branch por agente e os cartões do quadro, para este workspace ou para qualquer um. Na
  Nova missão, escolher o modelo preenche tudo, e o quadro começa com os cartões dele.
- **Um branch por agente** (opção da nova missão): o líder trabalha numa cópia do repositório
  (git worktree em `~/.orbit/worktrees`) num branch da missão criado a partir do branch atual, e
  cada ajudante numa cópia e num branch próprios (`<branch>--N`), sem tocar na sua pasta. O retorno
  de um ajudante diz ao líder quantos commits integrar (`git merge`) e avisa de arquivos sem
  commit; o líder tem a ferramenta `branches`. O botão **Abrir PR** mostra commits e arquivos
  contra a base, envia o branch ao `origin` e abre o PR com o `gh` (com descrição sugerida a
  partir do objetivo, do quadro e dos retornos); depois mostra o estado e o CI. Arquivar a missão
  apaga as cópias limpas e mantém as que têm mudanças sem commit; os branches ficam.
- **Quadro** (painel na missão): cartões em A fazer, Fazendo e Feito, com número (T1, T2…),
  notas e responsável. Os agentes usam `board_list`, `board_add` e `board_update` (o líder é
  instruído a planejar nele; os ajudantes movem os próprios cartões), e você cria, edita, atribui
  e arrasta os mesmos cartões. Fica salvo com a missão.
- **Agentes**: cada agente tem um menu (⋯) para renomear (ou clique duas vezes no nome), retomar
  a conversa, reabrir em conversa nova, duplicar e copiar o número. O Orbit guarda como cada
  agente foi aberto e o id da conversa (dos hooks do Claude e do arquivo de sessão do Codex),
  então mesmo depois de reiniciar o Orbit, inclusive numa atualização, dá para **retomar a
  conversa** (`claude --resume`, `codex resume`). Na grade dá para fixar 1, 2 ou 3 colunas;
  ⌘1–9 escolhe o agente, ⌘[ e ⌘] passam para o anterior e o próximo, e ⌘J vai para a barra de
  comando.
- **Avisos** (Ajustes › Avisos): notificação do macOS quando um agente espera você, quando um
  ajudante entrega o retorno, quando um agente do Claude termina um turno de mais de 30 s e,
  se quiser, quando um agente encerra; por padrão só com o Orbit em segundo plano. Voltar ao
  Orbit pelo aviso abre o agente certo, e o ícone no Dock mostra quantos agentes esperam você.
- **Atualizações**: o app procura uma versão nova ao abrir e a cada 6 h (a versão na barra de
  título vira "0.1.0 → 0.2.0"; o cartão Orbit em Ajustes › Agentes e CLIs instala e reinicia). As
  releases ficam no repositório privado; o sidecar as lê com o seu `gh` e entrega ao plugin de
  atualização do Tauri em loopback (com o token da sessão), e o plugin só instala o que estiver
  assinado com a chave do projeto (a pública está no `tauri.conf.json`).
- **Arquivos** (painel na missão): **Mudanças** mostra, por pasta do workspace, a branch, o que
  está à frente ou atrás e cada arquivo que difere do último commit (modificado, novo, apagado,
  renomeado, conflito), com linhas a mais e a menos e o agente que editou (pelos hooks de Edit e
  Write do Claude); clicar abre o diff. **Todos** mostra a árvore (o que o git vê, sem o que o
  `.gitignore` esconde) e abre os arquivos só para leitura. O sidecar roda `git` com lista de
  argumentos (nunca por shell) e `GIT_OPTIONAL_LOCKS=0`, e nada fora das pastas do workspace pode
  ser lido, nem por link simbólico.
- **Skills e MCP** (Ajustes › Skills e MCP): lista as skills, subagentes e servidores MCP que o
  Claude Code e o Codex têm instalados (pessoais, de plugins e das pastas dos workspaces; dos
  servidores MCP só o nome e o transporte, nunca env ou cabeçalhos). Desligar um item vale só para
  os agentes do Orbit: o Claude é bloqueado pelo hook `PreToolUse` (a decisão volta pelo próprio
  hook, então vale na hora, até para agentes já abertos), o Codex abre com
  `mcp_servers.<nome>.enabled=false` e os dois são avisados nas instruções. Cada tipo de tarefa e
  papel de squad pode marcar **só estas skills**, e o Claude daquele agente só usa as da lista.
- **Ditado**: o microfone na barra de comando transcreve o que você fala para o agente selecionado
  (Web Speech do WebKit, no idioma do sistema; o texto aparece enquanto você fala e só vai quando
  você tecla Enter; Esc para). Na primeira vez o macOS pede permissão para o microfone e para o
  reconhecimento de fala (os textos estão no `Info.plist` do app). O Ditado do próprio macOS
  (Fn Fn) também funciona em qualquer campo.
- **Navegador da missão**: cada missão tem uma página, aberta num Chromium sem janela (o Chrome,
  Brave, Edge ou Chromium instalado; `ORBIT_BROWSER` escolhe outro). Os agentes usam as
  ferramentas `browser_open`, `browser_screenshot`, `browser_text`, `browser_click`,
  `browser_type`, `browser_key`, `browser_scroll` e `browser_console` do MCP; você vê a mesma
  página ao vivo no painel **Navegador** da missão e pode digitar o endereço, clicar, rolar e
  digitar nela. O navegador usa um perfil próprio do Orbit (`~/.orbit/browser`, sem os seus
  cookies) e é controlado por pipe (`--remote-debugging-pipe`), sem porta aberta; ele fecha
  junto com o Orbit, e arquivar a missão fecha a página dela.
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
- **Agentes**: Claude Code, Codex, Gemini CLI e Antigravity CLI. Você escolhe o agente em cartões
  que mostram se ele está instalado e com login; o modelo vem da lista daquela CLI (lida da própria
  CLI quando ela informa: Codex e Antigravity; o padrão do Codex vem do seu `config.toml`), com
  "outro modelo" para qualquer id; o esforço mostra só os níveis que o modelo aceita, com o padrão
  dele marcado (o Gemini não tem esforço). O Gemini recebe o servidor do Orbit e os hooks num
  arquivo de configuração só da sessão (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`), sem mexer no seu
  `~/.gemini`; o Antigravity, que só lê MCP global ou do projeto, usa o comando `orbit` no terminal
  (`orbit` lista as ferramentas; `orbit handoff_submit '{"summary":…}'` chama), que todo agente
  também tem. O Gemini aceita contas extras (pasta própria ou chave do Google AI Studio); o login
  Google pessoal do Gemini CLI foi encerrado pelo Google em favor do Antigravity. O OpenRouter entra
  como conta de API do Claude Code (Ajustes › Contas › Provedor OpenRouter).
- **Maestro** (missão agêntica): você escolhe só o líder. Ele orquestra e não executa: o Orbit
  recusa as ferramentas de edição do líder Claude e reforça a regra a cada mensagem; depois de
  delegar ele encerra o turno e espera os retornos, e só fecha um ajudante que ainda não entregou
  com `force`. Para cada atividade o Orbit escolhe a CLI (pela tabela, que vem misturando Claude e
  Codex; sem `kind` ele classifica sozinho), o modelo, o esforço e a conta: a assinatura com mais
  folga contando os agentes que já estão nela, para espalhar o trabalho pelas suas contas; se todas
  as contas de uma CLI estão no limite, passa para a outra (se a missão permitir) e, sem nenhuma,
  recusa dizendo quando a primeira volta. Cada abertura devolve um recibo (tipo, troca de CLI,
  conta e motivo). O líder também tem `agent_spawn_many` e `accounts_status`.
- **Entrega garantida**: o ajudante entrega com `handoff_submit` e um status (`done` com evidência,
  que o Orbit exige; `blocked` com a pergunta; `progress`, só registrado), para quem pediu ou para
  outro agente (`to`, um revisor, por exemplo, que passa a dever a entrega). Se ele encerrar o turno
  sem entregar, o Orbit cobra uma vez (hook Stop no Claude; no Codex, o fim do turno vem do
  arquivo de sessão e a cobrança é digitada no terminal) e, na vez seguinte, manda a última
  mensagem dele para quem espera. Uma mensagem do líder é trabalho novo: o ajudante volta a dever a
  entrega. O líder interrompe (`agent_interrupt`, Esc e nova orientação), retoma na mesma conversa
  (`agent_resume`) e, com o objetivo verificado, declara a missão pronta (`mission_ready`): ela
  ganha o selo "Pronta", o resumo entra no relatório e você recebe um aviso.
- **Qualidade**: cada tipo de tarefa da tabela tem um "como fazer" (reproduzir antes de corrigir,
  tentar refutar na revisão…) que vai na primeira mensagem do ajudante, então chega também ao
  Codex; investigação e revisão são só leitura. O líder pode passar critérios de aceite, e o
  ajudante só entrega `done` respondendo a cada um. Um ajudante pode abrir até dois sub-ajudantes,
  cujos retornos voltam para ele. O líder pergunta a você com `ask_user` (o terminal fica "espera
  você" com as opções em botões). O recibo de cada abertura fica no fluxo da missão. Num workspace
  com várias pastas, o ajudante pode nascer na pasta do trabalho (`folder`).
- **Classificação e tabela viva**: sem `kind`, cada tipo pontua as palavras da atividade (as do
  título valem mais); quando nada bate ou dois tipos ficam próximos, o Claude Haiku decide pela
  tabela, rodando sem hooks, MCP, ferramentas nem sessão salva (alguns segundos, fração de
  centavo; dá para desligar). O líder pode propor mudanças na tabela (`routing_propose`, com o
  motivo); você aceita ou recusa em Ajustes, que mostra um selo com as pendentes, e a resposta
  chega no terminal dele.
- **Orçamento e uso**: cada missão pode ter um limite de tokens e/ou de custo (o custo conta só o
  Claude; o Codex não informa), ao criar, num modelo ou pelo botão Orçamento no cabeçalho. Aos 80%
  o Orbit avisa; no limite, interrompe os agentes, recusa as próximas ferramentas do Claude e não
  abre agentes novos até você aumentar. Ajustes › Uso mostra o mês: tokens por dia (Claude e
  Codex), por missão, workspace, CLI e modelo ou conta, os orçamentos em andamento e um CSV para
  copiar.
- **Continuidade**: retomar um agente mantém o número dele; ao abrir o Orbit, os agentes que
  estavam rodando voltam na mesma conversa, e quem devia uma entrega recebe um aviso para
  continuar (dá para desligar em Ajustes › Quem faz cada tarefa). A folga das contas do Codex é
  lida do último arquivo de sessão de cada conta, mesmo sem agente do Orbit rodando nela.
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

### Publicar uma versão

```bash
npm run release -- 0.2.0 --notes "O que mudou"            # build assinado em dist-release/v0.2.0
npm run release -- 0.2.0 --notes "O que mudou" --publish  # e cria a release no GitHub (gh)
```

A chave privada fica em `~/.tauri/orbit-updater.key` (fora do repositório). Sem ela não dá para
assinar versões novas, e os apps já instalados recusam qualquer outra: guarde uma cópia segura.
Para testar uma versão antes de publicar, abra o app com `ORBIT_UPDATE_DIR=dist-release/v0.2.0`.

Próximos passos: assinatura e notarização do `.app` (com a entitlement de microfone do hardened runtime); build para Macs Intel.
