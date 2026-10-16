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
  `agent_list`, `mission_status`, `activity_status`, `handoff_list`. Ajudantes entregam com
  `handoff_submit`, que persiste o resultado e devolve `resultId` antes de avisar o líder.
  `handoff_list` consulta por resultado ou cursor `after`, mesmo depois que os eventos antigos
  saem do fluxo. Receber o aviso no terminal não confirma leitura nem validação do resultado.
- **Avisos recuperáveis**: resultado e aviso são gravados juntos. Sem destinatário vivo, o aviso
  aguarda; após reabertura ou troca de líder, pode chegar novamente com o mesmo identificador.
  `delivery_status` distingue persistido, Enter escrito no PTY e leitura confirmada pelo agente
  com `delivery_ack`. A recuperação repete o aviso, sem executar a atividade novamente.
- **Histórico de execução**: atividade, revisão do contrato, tentativa e resultado têm registros
  separados do terminal. A reserva é gravada antes de abrir o processo; uma abertura interrompida
  continua pendente e exige investigação antes de repetir com `retryReason`. Mudanças de critérios
  exigem uma revisão explícita e preservam as tentativas e evidências anteriores.
- **Identidade de execução**: cada abertura recebe um epoch novo, inclusive ao retomar a mesma
  sessão. Requisições capturadas por uma execução ou atribuição substituída são recusadas.
  `whoami` informa a tentativa; passar `attemptId` no retorno também protege o reenvio em uma
  conexão nova. Adaptadores Claude, Codex e Gemini descrevem os formatos cobertos por fixtures;
  isso não comprova compatibilidade universal com versões dos CLIs.
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
- **Mensagens e anexos**: o compositor tem múltiplas linhas (Enter envia; Shift+Enter quebra
  linha), rascunho por agente enquanto a missão permanece montada, seleção de arquivos,
  arrastar/soltar e colagem de imagens. Mostra prévias e permite remover antes de enviar. São até
  8 anexos, 4 MB por arquivo e 8 MB por mensagem. O sidecar guarda os arquivos localmente em
  `~/.orbit/attachments/<missão>` com permissões privadas; o agente recebe referências e usa suas
  ferramentas de leitura/imagem. Apagar a missão remove seus anexos. O rascunho só é limpo após
  confirmação de aceitação do motor; falha preserva o texto e os anexos.
- **Conversa**: o botão no painel de Claude/Codex apresenta mensagens dos arquivos de sessão,
  blocos de código e atividade recente. O terminal continua disponível para ferramentas,
  confirmações e saída ao vivo. Gemini/Antigravity apresentam a conversa pelo terminal.
- **Sugestões do maestro**: no campo de mensagem e no terminal do líder Claude/Codex, o Orbit
  sugere orientações a partir do objetivo, quadro e atividades. O texto aparece como prévia:
  **Tab insere; Enter envia; Esc dispensa**. O botão Inserir também preenche o campo sem enviar.
  A geração é local, sem chamadas extras a modelos. No terminal, exige um prompt reconhecido e
  eco correspondente ao que você digitou; menus, navegação ou texto selecionado não são
  completados pelo Orbit. O controle **Sugestões ligadas/desligadas** afeta os dois lugares e
  guarda a preferência localmente. Não é uma predição generativa de qualquer frase.
- **Ditado**: no app macOS, o botão usa um helper Swift com Speech/AVFoundation, transcrição
  parcial e final e parada por Esc. O áudio usa reconhecimento no dispositivo quando suportado;
  caso contrário, o macOS pode processá-lo pela Apple (o indicador mostra “Apple”). O helper é
  compilado no build e não salva áudio. Permissões de microfone e fala são pedidas pelo macOS;
  cada captura para em até 60 segundos. No navegador, usa Web Speech quando disponível. O Ditado
  do sistema também funciona nos campos. A captura real ainda precisa de validação manual com
  as permissões e o microfone do usuário; compilação e protocolo foram verificados.
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
  ocupado; a missão recebe os deltas por CLI/conta/sessão, sem somar outra vez um relatório
  repetido ou atrasado. Baseline, missão, dia e ledger são gravados juntos antes de confirmar o
  relatório. A Base mostra os tokens por dia (Claude e Codex) nos últimos
  12 meses. A barra de título mostra as janelas de 5 h e semanal de cada conta,
  com suas renovações. Tokens e contexto do Claude vêm da status line do Orbit (`POST /status`, com o token do
  agente); do Codex, o sidecar lê o arquivo de sessão em `~/.codex/sessions` aberto na pasta do
  agente. O custo que o Claude informa é o equivalente em preço de API (não é cobrado em
  assinatura). Claude/Codex consultam os limites atuais da conta sem iniciar tarefas de modelo.
  A barra segue a métrica do provedor: **Claude — percentual usado; Codex — percentual restante**,
  com o rótulo explícito e atualização nominal a cada 30 segundos, ao voltar
  ao app e pelo botão **Atualizar limites**. Dados vencidos aparecem como sem leitura atual;
  falhas preservam a data do último sucesso e usam espera progressiva até uma nova tentativa.
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
  recusa as ferramentas de edição do líder Claude e instala o papel ao abrir a conversa; depois de
  delegar ele encerra o turno e espera os retornos, e só fecha um ajudante que ainda não entregou
  com `force`. Para cada atividade o Orbit escolhe a CLI (pela tabela, que vem misturando Claude e
  Codex; sem `kind` ele classifica sozinho), o modelo, o esforço e a conta: a assinatura com mais
  folga contando os agentes que já estão nela, para espalhar o trabalho pelas suas contas; se todas
  as contas de uma CLI estão no limite, passa para a outra (se a missão permitir) e, sem nenhuma,
  recusa dizendo quando a primeira volta. Cada abertura devolve um recibo (tipo, troca de CLI,
  conta e motivo). O líder também tem `agent_spawn_many` e `accounts_status`.
- **Apagar para sempre**: um agente (menu ⋯ do terminal), uma missão (lixeira no cabeçalho da
  missão ou no cartão da Base) ou um workspace (Editar workspace › Apagar workspace, confirmando o
  nome). Sai do Orbit tudo o que ele guardava: agentes, fluxo, quadro, notas, propostas, uso
  registrado, cópias de trabalho, e, no workspace, a memória, os modelos e os agendamentos. Por
  escolha, também as conversas dos agentes no Claude Code e no Codex e o que a missão deixou na
  memória (marcadas), e os branches que ela criou (desmarcada). As pastas e os arquivos do projeto
  nunca são tocados.
- **Memória do projeto**: cada workspace lembra entre missões. Os líderes anotam com
  `project_note` decisões, fatos e lições que valem para as próximas missões; o resumo de cada
  missão pronta entra sozinho. Todo líder novo começa com essa memória (as fixadas primeiro), o
  dossiê a inclui e qualquer agente a lê com `project_memory`. Você vê, anota, fixa, edita e apaga
  em Editar workspace › Memória do projeto.
- **Limites atuais por conta**: o Orbit roda o `/usage` do Claude Code sem conversa (é um
  comando local: não chama modelo nem custa nada, e roda sem hooks nem MCP) para cada conta por
  assinatura, ao abrir e nominalmente a cada 30 segundos. O Codex consulta `account/rateLimits/read`
  da CLI; o Claude usa `/usage`, sem inferência. A distribuição usa o uso real da janela de 5 horas e
  da semana mesmo sem nenhum agente do Claude aberto.
- **Maestro 2**:
  - **Codex líder de verdade**: roda no sandbox só leitura (qualquer edição pede a sua aprovação) e
    recebe o papel na primeira mensagem; os retornos seguintes carregam apenas o conteúdo novo.
  - **Trocar o líder** (botão "Trocar líder" no cabeçalho): por um agente novo, de qualquer CLI,
    modelo e esforço, ou promovendo um ajudante. O novo líder recebe o dossiê da missão (objetivo,
    decisões anotadas com `mission_note`, quadro, ajudantes e o que cada um deve, retornos,
    branches e o fim da conversa do líder anterior, lido dos arquivos do Claude e do Codex) e pode
    relê-lo com `mission_briefing`. Quem devia ao líder antigo passa a dever ao novo.
  - **Distribuição justa**: cada tipo de tarefa tem um equivalente em outra CLI; quando a CLI da
    tabela está bem mais ocupada (uso da melhor conta + 15 pontos por agente rodando, 30 de
    diferença), a tarefa vai para o equivalente, e o recibo diz por quê.
  - **Modelo pela dificuldade**: o Orbit infere complexidade pelo escopo e risco, inclusive
    quando o líder já escolheu `kind`. Operações delimitadas usam um modelo leve e esforço baixo;
    arquitetura, concorrência e risco elevam os recursos. O líder pode complementar essa decisão
    com `difficulty`. No Codex, modelos leves/avançados são escolhidos do catálogo anunciado pelo
    CLI; famílias desconhecidas mantêm o modelo configurado. IDs, capacidades e níveis válidos
    estão disponíveis para os agentes em `model_catalog`. A política usa faixas relativas, sem
    inventar preços ou benchmarks. Escolhas explícitas de CLI/modelo/esforço são preservadas.
  - **Líder automático**: ao criar missão agêntica, a opção de escolha pelo objetivo também
    reduz o líder para tarefas simples. Desligue a opção para fixar sua configuração. Modelos
    salvos de missão conservam a configuração explícita que tinham.
  - **Atividades persistentes**: uma tarefa repetida reutiliza agente/resultado, inclusive em
    chamadas concorrentes, após fechar o terminal ou reabrir o Orbit. `activityId` mantém a
    identidade quando o texto muda; `retryReason` explica uma nova execução. Resultados e aceite
    ficam no registro da atividade, separados de novas tarefas do mesmo terminal.
  - **Lotes concorrentes**: `agent_spawn_many` classifica atividades independentes em paralelo
    e seleciona contas na abertura síncrona de cada processo. Handoffs repetidos não despertam
    novamente o líder; mensagens simultâneas passam por uma fila que preserva paste/Enter e
    agrupa retornos pendentes.
  - **Em inglês**: as instruções aos agentes são em inglês e, com a opção ligada (padrão), eles
    trabalham e se falam em inglês; o que você lê (respostas, perguntas, resumo final) vem em
    português.
  - Um agente reaberto ou retomado mantém o agente, o modelo e o esforço que tinha.
- **Entregas e pendências**: o ajudante entrega com `handoff_submit` e um status (`done` com evidência,
  que o Orbit exige; `blocked` com a pergunta; `progress`, só registrado), para quem pediu ou para
  outro agente (`to`, um revisor, por exemplo, que passa a dever a entrega). Se ele encerrar o turno
  sem entregar, o Orbit cobra uma vez (hook Stop no Claude; no Codex, o fim do turno vem do
  arquivo de sessão e a cobrança é digitada no terminal) e, na vez seguinte, manda a última
  mensagem dele para quem espera. Uma mensagem do líder é trabalho novo: o ajudante volta a dever a
  entrega. O líder interrompe (`agent_interrupt`, Esc e nova orientação), retoma na mesma conversa
  (`agent_resume`) e, com o objetivo verificado, declara a missão pronta (`mission_ready`): ela
  ganha o selo "Pronta", o resumo entra no relatório e você recebe um aviso. Fechar o terminal
  não cancela trabalho pendente; `blocked` e retornos automáticos precisam ser resolvidos.
  `mission_status.pendingDeliveries` inclui atividades de terminais fechados. Para dispensar
  pendências, `mission_ready` exige `force` e `reason`, preservados no registro e no resumo.
  Retomar a mesma conversa mantém o uso já contabilizado, inclusive o último relatório Codex.
- **Qualidade**: cada tipo de tarefa da tabela tem um "como fazer" (reproduzir antes de corrigir,
  tentar refutar na revisão…) que vai na primeira mensagem do ajudante, então chega também ao
  Codex; investigação e revisão são só leitura. O líder pode passar critérios de aceite, e o
  ajudante só entrega `done` respondendo a cada um. Um ajudante pode abrir até dois sub-ajudantes,
  cujos retornos voltam para ele. O líder pergunta a você com `ask_user` (o terminal fica "espera
  você" com as opções em botões). O recibo de cada abertura fica no fluxo da missão. Num workspace
  com várias pastas, o ajudante pode nascer na pasta do trabalho (`folder`).
- **Classificação e tabela viva**: sem `kind`, cada tipo pontua as palavras da atividade (as do
  título valem mais); para atividades ambíguas que não são operações simples, o Claude Haiku decide pela
  tabela, rodando sem hooks, MCP, ferramentas nem sessão salva (dá para desligar). O líder pode propor mudanças na tabela (`routing_propose`, com o
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

O encerramento do CLI encerra o pane com seu status real. No Codex só leitura, pastas extras são referenciadas pelo caminho absoluto, sem solicitar raízes graváveis com `--add-dir`. Para um diagnóstico opt-in com as contas Claude/Codex autenticadas, execute `node scripts/verify-live-clis.mjs --live`; ele lê um arquivo sintético e verifica o retorno MCP, consumindo uso das contas. A [análise do Overclock e validação real](docs/analysis/overclock-runtime-followup.md) detalha evidências e limites.

### Publicar uma versão

```bash
npm run release -- 0.2.0 --notes "O que mudou"            # build assinado em dist-release/v0.2.0
npm run release -- 0.2.0 --notes "O que mudou" --publish  # e cria a release no GitHub (gh)
```

A chave privada fica em `~/.tauri/orbit-updater.key` (fora do repositório). Sem ela não dá para
assinar versões novas, e os apps já instalados recusam qualquer outra: guarde uma cópia segura.
Para testar uma versão antes de publicar, abra o app com `ORBIT_UPDATE_DIR=dist-release/v0.2.0`.

Próximos passos: assinatura e notarização do `.app` (com a entitlement de microfone do hardened runtime); build para Macs Intel.

### Fluxo oficial de ajustes e atualizações

Qualquer ajuste usa uma branch `feature/orbit-*` ou `fix/orbit-*` baseada na `main` atual.
As regras para todos os agentes estão em [AGENTS.md](AGENTS.md).

```bash
npm run agent:setup
npm run agent:status
npm run agent:begin -- feature/orbit-resumo_do_ajuste scripts/arquivo.mjs
# entre na worktree exibida; instale dependências, faça o ajuste e commits específicos
npm run agent:finish
```

`agent:begin` reserva arquivos/pastas e recusa sobreposição com outras worktrees do clone.
As reservas ficam no diretório Git compartilhado, fora do código versionado. Se um trabalho
for abandonado, coordene com o responsável antes de remover sua entrada de
`git rev-parse --git-common-dir`/`orbit-agent-claims.json`. Entre clones diferentes, coordene
pelo PR. `agent:finish` para em qualquer erro e não resolve conflitos nem força pushes.
Os hooks são proteção local; o check `Validate / validate` também verifica o nome da branch
no PR. Ative esse check e a exigência de PR nas regras de proteção de `main` quando o plano
do repositório permitir.

Após merge, [Official release](../../actions/workflows/release.yml) valida o código e publica
uma nova versão Apple Silicon, com o arquivo `Orbit_<versão>_aarch64.app.tar.gz`, assinatura,
`latest.json` e `source.json`. A versão passa da maior entre a versão-base do código e tags
existentes; o commit da `main` não recebe um bump recursivo. Execuções simultâneas não cancelam
a publicação em andamento; se vários merges chegarem juntos, o GitHub pode agrupar os pendentes
na versão do commit mais recente. Reexecutar um commit já publicado não gera outra versão.

Configure nos secrets de Actions a **mesma** `TAURI_SIGNING_PRIVATE_KEY` usada pelas instalações
existentes e, se necessário, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. A chave nunca é versionada.
Se a publicação falhar, a versão anterior continua oficial; consulte o log antes de reexecutar.
A release aponta para o commit exato do build e só se torna latest após o upload completo.

O download fica em [Releases](https://github.com/luctmc/Orbit/releases/latest). Como o repositório
é privado, é necessário ter acesso e autenticar o GitHub CLI (`gh auth login`) para o app buscar
e baixar atualizações. O Orbit verifica novas versões ao abrir e a cada seis horas; também
permite buscar e instalar pelo app. As assinaturas do updater são preservadas; assinatura
Developer ID/notarização Apple e suporte Intel continuam sendo trabalhos separados.
