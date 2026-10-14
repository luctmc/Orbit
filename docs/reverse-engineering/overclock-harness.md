# Overclock x Orbit: como funciona o harness multiagente e o piloto

Análise comportamental *clean-room*, feita em 14/10/2026. Fontes: árvore de processos e linhas de comando (`ps`), nomes das variáveis de ambiente (sem valores), arquivos de dados em `~/.overclock-app` (só esquema e chaves, com segredos omitidos) e skills e agentes instalados em `~/.claude`. Não abri o bundle (`sidecar/dist`, `*.jsc`) nem o código dos scripts `.mjs`. O papel de cada script foi deduzido do nome e do evento de hook a que está ligado. O REA não foi usado, porque exigiria baixar e executar um pacote externo, e os dados coletados já bastavam.

---

## 1. Como o harness do Overclock funciona

### 1.1 Processos

```
overclock (app nativo, pid 2357)
├── sidecar/bin/node sidecar/dist/index.js      ← servidor: MCP HTTP em 127.0.0.1:<porta>/mcp/claude
├── claude --model claude-opus-5-5 --resume <sessão> ...           ← PILOTO (pane-78)
└── claude --effort medium --model claude-sonnet-5-5 --resume ...  ← AJUDANTE (pane-89)
```

- Os panes de agente são filhos do **app**, que é dono dos PTYs, e não do sidecar. O sidecar só serve o MCP e as decisões.
- Os dois panes tinham ~22h de vida e usavam `--resume <id>`: ao reabrir o app, o Overclock **retoma automaticamente** a conversa de cada pane.
- Flags comuns a todos os panes Claude:
  - `--dangerously-skip-permissions`, e também `permissions.defaultMode: bypassPermissions` no settings.
  - `--mcp-config ~/.overclock-app/mcp-pane-pane-N.json`: um servidor `overclock` HTTP por pane, com bearer próprio.
  - `--settings ~/.overclock-app/claude-mcp-policy-pane-N.json`: hooks, statusLine, `skillOverrides` e `deniedMcpServers`.
  - `--allowedTools <lista>`: ferramentas nativas mais todas as `mcp__overclock__*` pré-aprovadas. A lista é **idêntica** para piloto e ajudante. O filtro por papel acontece no servidor MCP (veja 1.3).
  - `--append-system-prompt <texto>`: o "contrato de nascimento" do pane (veja 1.2).
  - `--model` sempre. `--effort` só quando o harness define (o piloto rodava em "padrão"). Sem `--add-dir`: o acesso a outras pastas vem de uma política escrita no prompt ("write_external").
- **A identidade do pane vai no ambiente** (só os nomes): `OVERCLOCK_PANE_ID`, `OVERCLOCK_MISSION_ID`, `OVERCLOCK_PANE_TOOL_PROFILE` (`orchestrator` | `worker`), `OVERCLOCK_SQUAD_ROLE`, `OVERCLOCK_PANE_AGENT` (CLI), `OVERCLOCK_CALLER_PANE_ID` e `OVERCLOCK_PANE_SPAWNED_BY` (só no ajudante: quem espera o retorno), `OVERCLOCK_GATE_DIR`, `OVERCLOCK_MCP_PORT`, `OVERCLOCK_MCP_BEARER_TOKEN`, `OVERCLOCK_*ARMS_DESCRIPTOR`, `OVERCLOCK_PERMISSION_LABEL`. Há também `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, que desliga a visão de subagentes nativa para não competir com os panes.
- **Contas simultâneas.** Nenhum dos dois panes Claude ativos tinha `CLAUDE_CONFIG_DIR`: os dois usavam a conta Claude padrão, e só existe uma conta Claude (`claude-oauth`). No Codex, a segunda conta é uma pasta `CODEX_HOME` própria (`~/.overclock-app/codex-accounts/codex-acc-2/`), com login, sessões, sqlite, `config.toml` e **cópias** de agentes e skills. A conta 1 é o `~/.codex` padrão. Ou seja, a separação de contas é feita trocando o diretório de configuração da CLI por pane: `CODEX_HOME` no Codex e, por dedução, `CLAUDE_CONFIG_DIR` no Claude. Isso não foi observado ao vivo porque só há uma conta Claude.
- **Query da URL MCP por pane** (token omitido):
  - Piloto: `toolProfile=orchestrator, model, workspacePath, cwd, missionId, callerPaneId, allowedCLIs=claude,codex, squadRole=orchestrator, missionType=agentic`.
  - Ajudante: `toolProfile=worker, model, effort, providerId (às vezes), workspacePath, cwd (outro repositório: o backend), missionId, callerPaneId, spawnedByPaneId, missionType=agentic`.
  - A URL carrega o contexto completo do pane, e o servidor monta a lista de ferramentas e as regras a partir dele.

### 1.2 O piloto (prompt de nascimento, resumido)

O prompt anexado ao piloto de uma missão agêntica diz, em essência:

1. **O piloto não executa nada.** Toda atividade, até responder uma frase, vira um ajudante via `pane_spawn` antes da resposta.
2. **O piloto não escolhe CLI, modelo nem esforço.** Ele passa `task: "<tipo de atividade>"` e o *harness* resolve CLI, modelo, esforço, skills e persona. Depois o piloto lê o **recibo** e informa a escolha real.
3. **Paralelismo em uma chamada só:** `pane_spawn({ panes: [...] })` para N ajudantes independentes. A tarefa vai no nascimento e nunca em um `pane_write` depois.
4. **Depois de delegar, o piloto encerra o turno.** O retorno chega por `handoff_submit` do ajudante, que é *digitado* na entrada do piloto e o acorda. É proibido fazer polling com `pane_read`, `pane_list` ou `handoff_list`. `pane_wait` serve só para confirmar o boot (limite de 15 s).
5. **Verificação:** conferir a evidência de cada ajudante antes de aceitar. Nunca declarar sucesso com ajudante falho ou bloqueado.
6. **Encerramento da missão:** quando o objetivo estiver verificado, o próprio piloto chama `handoff_submit({status:"done", ...})` como última ação. Isso marca a missão como `ready_to_integrate`, que é um status observado em `missions.json`.
7. **Perguntas ao humano** só quando falta informação que bloqueia, via `overclock_clarify`.
8. Também recebe: o inventário real de capacidades de mídia (com ou sem chave: o que não tem chave nem entra no plano), um bloco de **identidade do pane** (paneId, missão, workspace, cwd, quem chamou, papel, harness) para não precisar chamar `whoami`, a política de acesso ao workspace e o bloco "skill gate". O piloto não tem filtro de skills.
9. O papel do piloto é reforçado **a cada mensagem do usuário** por um hook `UserPromptSubmit` (`agentic-pilot-rule.mjs`) que só existe no pane do piloto.

O prompt do **ajudante** tem:

- a identidade, com o aviso explícito de que o pane chamador está esperando a devolutiva;
- o objetivo da missão como contexto, deixando claro que a tarefa é o pedido recebido;
- um **contrato de carga de skill**: a primeira ação é carregar a skill vinculada pela linha do harness, e isso é auditado no handoff. Entrega sem a skill carregada é rejeitada como "imitação";
- o *skill gate*: só as skills declaradas na linha ficam visíveis. As demais recebem `skillOverrides: "off"` no settings e são negadas no `PreToolUse:Skill`;
- uma regra branda: delegar só quando o trabalho é realmente paralelo.

### 1.3 Ferramentas (MCP `overclock`)

A lista completa de nomes vai em `--allowedTools`, com aliases antigos incluídos. O que cada pane *vê* depende do `toolProfile` (servidor) e do plano. Funções deduzidas dos nomes e das skills `oc-mcp`/`oc-pilot`:

| Grupo | Ferramentas | O que fazem |
|---|---|---|
| Controle de panes | `pane_spawn` (`prompt` \| `idle`, `panes[]` ≤ 24, `task`, `name`, `agent`, `model`, `effort`, `providerId`, `cwd`, `persona`, `allowedSkills`, `allowChildSpawns`, `autoCloseOnHandoff`, `expect`, `resume`, `toolProfile`, `delegateOnly`), `pane_write` (texto, `brief` gravado em arquivo e entregue como ponteiro, `writes[]`, `action:"interrupt"`), `pane_read` (`lastN`, `preferHandoff`, `paneId:"previous"`), `pane_wait` (boot ≤ 15 s; `panes[]` com `match`), `pane_list`, `pane_close` (`paneIds[]`), `pane_whoami`, `pane_attach`/`pane_detach` (espelha o PTY bruto por socket Unix, só para robô) | abrir, escrever, ler, interromper, fechar e espelhar terminais de agentes |
| Aliases antigos | `pane_spawn_many`, `pane_write_many`, `pane_read_many`, `pane_wait_idle`, `pane_wait_many`, `pane_list_providers` | nomes legados que caem nas ferramentas acima |
| Handoff | `handoff_submit` (`status` done/blocked/error/progress, `summary` ≤ 280, `fullText`, `artifacts`, `evidence{checks, commands{cmd,exitCode}, files, tested, deployed, wired}`, `to`), `handoff_list` (`ids h-N`, `panes`, `delegator`, `full`) | entrega estruturada. Cada tarefa ganha um id `h-N`. `to` acorda outro pane. `progress` é nota sem wake. Textos longos são condensados automaticamente |
| Missão | `overclock_mission` (`list/get/create/set_status/update`, com `workDir` fixo da missão e `objective` refinado) | contêiner da missão. O piloto fixa o repositório e refina o objetivo que todo ajudante recebe |
| Descoberta e harness | `overclock_list` (`providers`, `models`, `account_pick`, `account_windows`, `agents`, `skills`, `recipes`, `harness`, `vault`, `media_providers`). Com `kind:"harness"`: `query` (simula a regra), `action:"apply"` (edita a tabela em lote), `action:"propose"` (fila para o dono aprovar) | o piloto consulta o arsenal, a folga das contas e a tabela, e pode editar a tabela quando o dono pede |
| Squad | `overclock_squad` (`list/get/run/save/delete`) | times prontos: agentes, skills e roteiro |
| Pergunta formal | `overclock_clarify` (`question`, `kind`, `suggestions` ≤ 4) | só o piloto. O pane fica "aguardando esclarecimento" |
| Navegação e robô | `overclock_navigate`, `overclock_browser_act`, `overclock_status`, `app_observe`, `app_events` (cursor de eventos, substitui o polling) | dirigir a UI e o navegador interno |
| Outros | `overclock_cron_*`, `overclock_memory_*`, `overclock_catalog_*`/`marketplace` (dormentes), mídia e skins | fora do escopo desta análise |

Perfis observados na skill `oc-mcp`:

- **worker:** cerca de 12 ferramentas. Inclui `pane_spawn`, ou seja, ajudantes podem abrir sub-ajudantes, salvo quando o pai limita com `allowChildSpawns`.
- **orchestrator:** worker mais `pane_wait`, `pane_close`, `overclock_mission` e `overclock_clarify`.
- **full:** pane aberto pelo humano.
- **connector:** robô externo.

### 1.4 Decisões e "harness" (`config.json`, `decision-usage.json`, `usage-events.jsonl`)

- `harnessTable` (v2) tem **categorias**, cada uma com **tipos** de atividade:
  - Desenvolvimento: B1 fix de bug, B2 feature, B3 tooling/scripts, B4 release/build, B5 investigação/análise, B6 docs/processo.
  - Frontend: design DNA, fazer página, replicar página.
  - Texto: revisão, escrita/copy.
  - Geral: `default`.
- Cada tipo resolve **cinco valores**: CLI, modelo (e conta), esforço, skills e agente/persona. `rows: {}` vazio indica que valem os valores de fábrica do app. Exemplo ao vivo: o B1 virou `claude-sonnet-5-5`, esforço `medium`, skill `qa-fix-protocol`.
- **Classificação:** o piloto passa `task`. Se o tipo não existe, o app classifica o `prompt` (por palavra-chave ou pelo tipo do cartão no board) e, sem match, usa o `default` declarado no recibo. Campos explícitos no spawn vencem a tabela.
- **Recibo** do spawn, uma linha por fato:
  - `▸ harness:` mostra categoria › tipo, `via=` (quem escolheu a linha: palavra-chave, board, default, decisor) e os valores escolhidos.
  - `▸ decisor:` aparece só quando o decisor LLM não decidiu, com o motivo.
  - `▸ origens:` lista os campos que não vieram da tabela.
- `decisions.{account, harness, browser, navigate, agent}` são booleanos (todos `false` aqui) e `decider: "jev"`. O decisor é um LLM barato via OpenRouter que pode tomar essas decisões. Sem chave, a **regra** decide. `decision-usage.json` registra isso por dia: `requests/failed/cost`, `byDecision.continuation {byModel, byRule}` e `byDecider.jev.last {ok, reason}`. Hoje: 2 decisões de "continuation" tomadas pela regra porque não há chave do OpenRouter. A decisão "continuation" provavelmente responde se um ajudante que parou sem entregar deve ser continuado.
- `agenticOrchestratorModel` e `agenticOrchestratorProviderId` guardam o modelo e a conta padrão do piloto.
- `usage-events.jsonl` tem uma linha por pane aberto, com `cli, model, effort, agent, skillsAsked, mode (agentico), openedBy (humano | piloto), missionId`. Agregado: 1 piloto Opus aberto pelo humano e 7 ajudantes Sonnet em esforço médio abertos pelo piloto, com as skills `qa-fix-protocol`, `oc-blackbox`, `oc-stamp` (4×) e `oc-showcase`.

### 1.5 Contas e escolha de conta (`providers.json`, `token-activity.json`)

- `providers[]`: `{id, label, type (oauth | openai-compat | anthropic-compat), host (cli), env{nomes de variáveis}, availableModels, authMode, accountLabel, codexHomeDir}`. Mais `builtinEnabled`, `builtinModels`, `cliOrder` e `accountOrder: { codex: ["codex-cli", "codex-acc-2"] }`, que é a ordem/preferência de contas por CLI.
- Contas nesta máquina:
  - Claude: 1 (OAuth embutido).
  - Codex: 2 (a padrão e `codex-acc-2` com CODEX_HOME próprio).
  - Dois provedores OpenRouter: um via Codex (`OPENAI_BASE_URL`/`OPENAI_API_KEY`) e um via Claude Code (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`).
- **Escolha automática por folga:** um motor embutido (antigo "Redline") lê as janelas de limite de **todas** as contas (5 h, semanal, por modelo), com `status ok | queimada | sem leitura`, `usadoPercent`, `resetaEmMin` e `idadeMin` (idade da leitura). Dentro de uma missão agêntica **a conta é sempre do app**: um `providerId` de conta só fixa a CLI. Se todas as contas da CLI estão queimadas, **o pane não abre** e a recusa informa qual conta acabou e quando volta. O piloto pode pedir `account_pick` (recomendação com motivo e ranking) ou `account_windows`.
- `token-activity.json`: por arquivo de sessão, `{s, m, c (cli), a (rótulo da conta), d{dia:{modelo:[4 contadores]}}}`. Agregado: Claude "Conta 1" com 95 sessões, Codex "Conta 1" com 8, "Codex 2" com 6 e Gemini com 3. É a contabilidade de tokens por conta, modelo e dia, feita a partir dos arquivos de sessão das CLIs.
- `usage-claude-calls.json`: contagem por dia de **skills e subagentes** invocados por sessão (incremental, com offset).

### 1.6 Hooks por pane

| Evento | Piloto (pane-78) | Ajudante Claude (pane-89/102) | Ajudante Codex (`.codex/hooks.json` do projeto) |
|---|---|---|---|
| SessionStart | soft-status | soft-status | soft-status |
| UserPromptSubmit | soft-status + **agentic-pilot-rule** | **handoff-stop** + soft-status | soft-status |
| PreToolUse (`*`) | soft-status | **gate-shim-skill-gate** + soft-status | soft-status |
| PostToolUse (`*`) | soft-status | soft-status | soft-status |
| Notification | soft-status | soft-status | — |
| PermissionRequest | soft-status | soft-status | soft-status |
| Stop | soft-status | **handoff-stop** + soft-status | soft-status + **handoff-deliver** |
| statusLine | statusline-model | statusline-model | — |

Papel deduzido de cada script (só pelo nome e pelo evento):

- **soft-status:** informa o status do pane ao app (rodando, ocioso, pedindo permissão) em todos os eventos.
- **agentic-pilot-rule:** só no piloto e só no `UserPromptSubmit`. Reinjeta a regra "você é o piloto, não executa" a cada mensagem, para o modelo não "esquecer" e começar a fazer o trabalho sozinho.
- **handoff-stop:**
  - No `Stop` do ajudante: **impede o ajudante de encerrar o turno sem ter feito `handoff_submit`** quando há alguém esperando, devolvendo-o ao trabalho com a instrução de entregar. Bate com a decisão "continuation".
  - No `UserPromptSubmit`: registra a origem da entrada e/ou reseta o estado.
- **gate-shim-skill-gate** (com `skill-gate-pane-N.mjs` por pane): aplica a whitelist de skills da linha do harness e registra quando a skill vinculada foi carregada.
- **handoff-deliver** (Codex, no Stop): como o Codex não tem o mesmo controle, ao fim do turno o hook **entrega automaticamente** o resultado ao pane chamador.
- **gate-shim-release-gate:** existe, mas não estava ligado em nenhum pane ativo. Provavelmente bloqueia ações de release ou push.
- **statusline-model:** linha de status com o modelo (e provavelmente com consumo).

Arquivos marcadores (dados simples):

- `handoff-pending-pane-78` = `1`: o piloto tem um handoff pendente. Ou ainda não fez o próprio `done`, ou há retornos aguardando entrega a ele.
- `input-origin-pane-78` = `human` e `input-origin-pane-100` = `system`: quem digitou a última entrada do pane (humano ou o sistema, como um wake de handoff ou a tarefa de nascimento). Provavelmente serve ao handoff-stop: só se cobra a devolutiva quando a entrada veio do chamador, não quando o humano está só conversando com o ajudante.
- `skill-loaded-pane-N-<skill>` = `1`: prova de que o ajudante carregou a skill vinculada, auditada no handoff (a regra anti-"imitação").
- Na policy: `deniedMcpServers: [redline]`, porque o motor de contas é interno e não um MCP no pane. `skipDangerousModePermissionPrompt: true`.

### 1.7 Protocolo de orquestração (skills `oc-*` e agentes `qa-swarm-*`)

- **Papéis por skill**, copiados no boot para a pasta de skills de **todas** as CLIs: `~/.claude`, `~/.codex` e cada `CODEX_HOME` extra, `~/.gemini` etc.
  - `oc-pilot` coordena.
  - `oc-builder` executa: lê antes de editar, faz a menor mudança, verifica com evidência nova, faz commit com pathspec e fecha com `handoff_submit` + `evidence`.
  - `oc-scout` pesquisa sem editar e devolve achados com `path:line`.
  - `oc-conveyor` revisa de forma adversarial: um achado por linha, sem editar, e na dúvida rejeita.
  - Métodos: `oc-route` (plano), `oc-blackbox` (causa raiz antes do conserto), `oc-stamp` (evidência antes de dizer "pronto") e `oc-showcase` (UI).
- **Ciclo do piloto:** decompor → delegar tudo (com `name` curto e uma chamada para N) → encerrar o turno → aceitar só com evidência → entregar com prova e limites.
- **Briefing do ajudante:**
  - superfície (arquivos), **um** entregável, formato de evidência e formato de retorno;
  - **fronteira e GATE**: quais arquivos *não* tocar porque outro ajudante está neles;
  - **briefing por ponteiro** ("executa o cartão X") em vez de colar o dossiê. Eles mediram 80–91% menos tokens.
- **Contra colisão de arquivos:**
  - agrupar por arquivo, com um executor por cluster e `git add` específico, nunca `-A`;
  - quando o compartilhamento é inevitável, um worktree para cada;
  - passos sequenciais acoplados vão para *um* ajudante só.
- **Portão de decisão por tiers** (agentes `qa-swarm-*`): trivial → Haiku com esforço baixo, limitado → Sonnet médio, difícil → Opus alto/xhigh (com workflow), complexo e paralelo → um worker que roda um enxame. Regra: "começar barato e só subir com motivo concreto". O sub-orquestrador anuncia a decisão em uma linha (`⚙ Spawning <agente> [model, effort, skill] — motivo`).
- **Hierarquia L1/L2:** o piloto abre sub-orquestradores (scout/builder/reviewer) que abrem workers folha. Um observador barato vigia panes travados pelos metadados, sem raspar o terminal.
- **Verificação:**
  - para afirmações importantes, um cético separado (`oc-conveyor`) tenta refutar; em alto risco, 2–3 verificadores e vale a maioria;
  - repetir até duas rodadas sem nada novo;
  - revisar **por referência** (diff, commit, cartão), não pela prosa do handoff;
  - `expect.schema` no spawn: o app valida os `artifacts` no `handoff_submit` e devolve ao ajudante o que faltou (até `retries` vezes). Só a entrega boa chega ao piloto.
- **Squads** (`squads.json`): `{id, name, agents[{id, agentName, category scout|builder|reviewer|orchestrator, cli, model?, effort?, allowedSkills?}], orchestratorInstructions, builtin, minAppVersion}`. As instruções de cada membro vivem no arquivo do agente, e só o piloto recebe texto livre. Os seis squads de fábrica são todos Claude, com o orquestrador em Opus e builders pesados em Opus com esforço alto.
- **Missões** (`missions.json`): `{id, workspaceId, title, status (running | ready_to_integrate | archived), type (agentic | libre | squad), objective, createdAt/updatedAt, archivedAt/By/Reason}`.

---

## 2. Tabela comparativa Overclock x Orbit

| # | Item | Overclock | Orbit | Situação |
|---|---|---|---|---|
| 1 | Usuário escolhe só o líder e o app escolhe o resto | Tabela de harness por tipo, mais a conta por folga | Tabela "quem faz cada tarefa" por `kind`, mais `pickAccount` | **igual** (conceito) |
| 2 | O líder não executa | Regra rígida no prompt, reforçada por hook a cada mensagem | Prompt pede para "ler o código o suficiente" e "não refazer o que delegou" | **parcial**: o líder pode executar |
| 3 | Classificação quando o líder não passa o tipo | Classifica o prompt (palavra-chave, board, LLM opcional) e cai num default declarado | `kind` é opcional e, sem ele, cai em Claude padrão sem classificar | **falta** |
| 4 | Recibo da escolha (CLI, modelo, esforço, skills, conta e por quê) | Recibo com `via=` e `origens` | Linha curta "X #N aberto (título; modelo, esforço)" sem conta nem motivo | **parcial** |
| 5 | Tabela padrão mistura Claude e Codex | Cinco valores por linha, incluindo CLI. Missão declara `allowedCLIs` | `DEFAULT_ROUTING` 100% Claude. O usuário pode trocar a CLI por linha | **parcial** |
| 6 | Skills por tipo e gate | Skills vinculadas, contrato de carga auditado, `skillOverrides` + PreToolUse | `skills` + `onlySkills` por linha, gate no PreToolUse (só Claude), sem contrato de carga | **parcial** |
| 7 | Várias contas por CLI | Pasta de config por conta (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`) e ordem por CLI | `AccountFiles`: pasta por conta, links simbólicos para settings/skills/agents, chave por `apiKeyHelper` | **igual** |
| 8 | Leitura de folga das contas | Motor lê as janelas de todas as contas, com idade da leitura e "sem leitura" | Limites só chegam de panes rodando (status line ou rollout do Codex). Conta sem leitura conta como 0% usado | **parcial** |
| 9 | Escolha de conta | Por folga dentro da missão agêntica. Recusa quando todas estão queimadas e diz quando voltam | Assinatura com mais folga, API só com as assinaturas ≥ 95% (e `auto`). Se todas estão cheias, abre mesmo assim | **parcial** |
| 10 | Ferramenta de contas para o líder | `account_pick` e `account_windows` | Nenhuma | **falta** |
| 11 | Spawn em lote | `panes[]` (≤ 24) numa chamada só | Um `agent_spawn` por chamada | **falta** |
| 12 | Ajudante em outra pasta ou repositório | `cwd` por ajudante e `workDir` da missão | `cwd` = pasta principal, as outras via `--add-dir` | **parcial** |
| 13 | Retorno acorda o líder | `handoff_submit` digitado na entrada do piloto ("← pane-N (h-N): …") | `handoff_submit` digitado no terminal do líder ("[Orbit] Retorno de #N") | **igual** |
| 14 | Proibição de polling | Explícita, e `pane_wait` só para boot | Não há instrução. `agent_read` e `agent_list` convidam a fazer polling | **parcial** |
| 15 | Handoff obrigatório (Stop) | `handoff-stop` segura o ajudante até entregar. `handoff-deliver` entrega pelo Codex | Hook de Stop só marca "ocioso" | **falta** |
| 16 | Handoff estruturado | `status`, `evidence` (comandos com exit code, arquivos, checks), `artifacts`, `fullText`, id `h-N` | `summary` + `details` em texto livre | **parcial** |
| 17 | Contrato de entrega (`expect`) | Schema validado no submit, com retry automático | Não existe | **falta** |
| 18 | Agentes conversam entre si | `pane_write` para qualquer pane, `handoff.to` para outro pane, `progress` sem wake | `agent_send` e `agent_read` de qualquer agente da missão. Handoff só vai ao líder | **parcial** |
| 19 | Ajudante abre sub-ajudante | Sim (perfil worker tem `pane_spawn`), com limite `allowChildSpawns` | Não: só o líder tem `agent_spawn` | **falta** |
| 20 | Retomar ajudante fechado com o contexto | `pane_spawn({resume:"h-N", prompt})` | Só pela UI (`restartPane` com resume). O líder não tem a ferramenta | **parcial** |
| 21 | Interromper um ajudante | `pane_write({action:"interrupt"})` | Não há (só fechar) | **falta** |
| 22 | Pergunta formal ao humano | `overclock_clarify` com sugestões | O líder pergunta no próprio terminal | **parcial** |
| 23 | Missão concluída pelo piloto | `handoff_submit done` do piloto põe a missão em `ready_to_integrate` | Missão só `active` ou `archived`, sem "pronta" | **falta** |
| 24 | Status por hooks (Claude) | soft-status em 7 eventos | `statusFromHook` em 6 eventos | **igual** |
| 25 | Status e hooks no Codex | Hooks do Codex via `.codex/hooks.json` (status + entrega) | Sem hooks. Faz polling do arquivo de sessão (rollout) só para uso e limites | **parcial** |
| 26 | Papéis e métodos (builder/scout/reviewer, evidência, causa raiz) | Skills `oc-*` instaladas em todas as CLIs | Briefs de papel nos squads de fábrica; tipos da tabela só com descrição | **parcial** |
| 27 | Portão de tiers (barato por padrão) | Instrução explícita: começar barato e subir com motivo | Embutido na tabela padrão (Haiku para docs, Sonnet na maioria, Opus em investigação), sem instrução ao líder | **parcial** |
| 28 | Anticolisão de arquivos | GATE no briefing, cluster por arquivo, worktree quando precisa | Prompt diz "mesmos arquivos → mesmo ajudante". Worktree e branch por ajudante na missão git | **igual** (Orbit tem até mais com worktrees) |
| 29 | Verificação cética | Revisor separado, 2–3 verificadores, revisão por referência | Squad "Auditoria" e "Revisor" no Caça-bugs. No modo agêntico só "verifique testes e build" | **parcial** |
| 30 | Squads | Agentes + skills + roteiro, CLI por membro | Papéis com CLI, modelo, brief, skills e playbook | **igual** |
| 31 | Edição da tabela pelo agente (com proposta) | `apply` (dono ou orquestrador) e `propose` (worker) | Só pela UI | **falta** (baixo impacto) |
| 32 | Registro das decisões | `usage-events` (quem abriu, modelo, skills) e `decision-usage` | Evento "Agente #N aberto — CLI · conta · modelo · esforço · papel" no fluxo | **parcial** |
| 33 | Retomar panes ao reabrir o app | Automático (`--resume`) | Manual (botão retomar) | **parcial** |
| 34 | Decisor LLM opcional | "JEV" via OpenRouter (conta, harness, continuação), com fallback para regra | Não existe | **falta** |
| 35 | Navegador compartilhado e quadro | Navegador próprio, board externo (OverClick via MCP) | `browser_*` compartilhado e `board_*` nativo | **igual / Orbit à frente** |

---

## 3. Lacunas do Orbit, por impacto no uso pessoal

> Cenário: "o usuário escolhe só o líder; o maestro decide sozinho o melhor agente para cada tarefa, Claude ou Codex, usando várias contas do Claude e do Codex ao mesmo tempo, e os agentes conversam entre si".

### 1. O maestro não decide de fato entre Claude e Codex (itens 3, 4, 5)

- **Overclock:**
  - O piloto só declara o *tipo* da atividade.
  - O app resolve CLI, modelo, esforço, skills e conta pela tabela. Sem tipo, classifica o prompt e cai num default declarado.
  - A missão tem `allowedCLIs`.
  - O recibo diz o que foi escolhido e por quê (`via=`, `origens`).
- **Orbit:**
  - `kind` é opcional. Sem ele, o ajudante vira Claude padrão.
  - A tabela de fábrica é toda Claude, então Codex só entra se o usuário editar a tabela.
  - O recibo não mostra conta nem motivo.
- **Proposta:**
  - **Tabela de fábrica mista:** por exemplo, implementação e testes em Codex (modelo forte de código, esforço médio), investigação e revisão em Claude Opus, docs em Haiku. Manter a escolha do usuário na UI.
  - **"CLIs permitidas" na criação da missão agêntica:** Claude, Codex ou ambos. A resolução respeita isso: se a linha pede uma CLI fora da lista, usa a linha equivalente da outra CLI.
  - **Classificação no sidecar quando falta `kind`:** regras por palavra-chave sobre título e tarefa (bug/erro → bug, teste → testes etc.) e default explícito. Opcionalmente, um classificador LLM barato com fallback para a regra.
  - **Recibo devolvido pelo `agent_spawn`:** tipo (e se veio do líder, da regra ou do default), CLI, modelo, esforço, conta (e "mais folga: X% usado na janela de 5 h"), skills. Gravar no fluxo da missão. O líder repassa ao usuário.
  - **Precedência:** campo explícito > linha da tabela > default.

### 2. Várias contas ao mesmo tempo: a folga é cega e não há recusa (itens 8, 9, 10)

- **Overclock:** lê as janelas de **todas** as contas mesmo ociosas, distingue "sem leitura" de "0%", mostra a idade da leitura, recusa abrir quando tudo está queimado (dizendo quando volta) e expõe `account_pick` e `account_windows` ao piloto.
- **Orbit:**
  - O limite só chega quando um pane daquela conta roda.
  - Conta nunca usada parece vazia, o que é ótimo para espalhar carga mas pode cair numa conta estourada.
  - Cinco ajudantes abertos de uma vez caem todos na mesma conta, porque o "uso" não muda entre um spawn e outro.
  - Quando tudo está cheio, abre mesmo assim.
- **Proposta:**
  - **Pesar a carga em andamento:** contar panes vivos por conta e desempatar, ou penalizar, quem já tem N agentes. Ao abrir um lote, distribuir em rodízio entre as assinaturas com folga.
  - **Leitura ativa periódica** de cada conta, com aviso de "leitura de X min atrás":
    - Codex: ler o último `token_count` dos rollouts de cada `CODEX_HOME`, inclusive de sessões antigas.
    - Claude: guardar o último limite reportado por conta, com hora e reset.
  - **Estados explícitos:** `ok` / `cheia` / `sem leitura`. Quando a CLI inteira está cheia, tentar a mesma linha na **outra CLI** (se permitida na missão) e, só se não houver, recusar dizendo quando a primeira conta volta. Contas de API continuam só com `auto`.
  - **Ferramenta `accounts` para o líder** (somente leitura): folga de cada conta e qual seria escolhida.
  - **Aplicar a mesma regra ao líder** ao criar a missão.

### 3. Entrega não é garantida: ajudante pode parar sem `handoff_submit` (itens 15, 25)

- **Overclock:**
  - Hook de Stop do ajudante segura o fim do turno até haver devolutiva, mas só quando a entrada veio do chamador (marcador de origem da entrada).
  - No Codex, um hook de Stop entrega automaticamente.
- **Orbit:** o Stop só marca ocioso. O líder fica esperando um retorno que nunca vem, ou começa a fazer polling.
- **Proposta:**
  - **Claude:** no hook de Stop de um ajudante sem entrega, responder com bloqueio de parada ("chame handoff_submit com o resumo; se estiver bloqueado, use status bloqueado"). Limitar a 1–2 cobranças e, depois disso, avisar o líder: "#N parou sem entregar; última mensagem: …".
  - **Origem da entrada:** registrar quem enviou a última entrada (líder, sistema ou humano) e não cobrar quando o humano está conversando com o ajudante.
  - **Codex:** usar o fim de turno detectado no rollout (evento de conclusão de tarefa). Se não houve handoff, entregar automaticamente a última resposta do agente ao líder, marcada como "entrega automática", ou digitar a cobrança no terminal do Codex.

### 4. O líder não é forçado a só orquestrar e a esperar sem polling (itens 2, 14, 23)

- **Overclock:**
  - Prompt rígido ("o piloto não executa"), reforçado por hook `UserPromptSubmit` a cada mensagem.
  - Proibição explícita de polling.
  - O piloto encerra a missão com um "done" que a põe em "pronta para integrar".
- **Orbit:** o líder lê código, pode executar e tem `agent_read` à mão. Nada marca a missão como concluída.
- **Proposta:**
  - **No modo agêntico:** frase "você não executa; delegue cada atividade; depois de delegar, encerre o turno; o retorno chega sozinho; não use agent_read ou agent_list para esperar". `agent_read` fica só para diagnosticar um ajudante travado.
  - **Hook `UserPromptSubmit` do líder agêntico** com `additionalContext` curto reforçando a regra.
  - **Ferramenta `mission_done(summary, evidence)` para o líder:** muda a missão para "pronta" (novo status), notifica o usuário e, na missão git, sugere abrir o PR.

### 5. Comunicação entre agentes é só pelo líder (itens 18, 19, 20, 21)

- **Overclock:**
  - Qualquer pane escreve em qualquer pane.
  - O handoff pode ir para outro pane (`to`), e há notas de progresso sem acordar ninguém.
  - Ajudantes podem abrir sub-ajudantes com teto.
  - O piloto retoma um ajudante fechado com o contexto (`resume`) e pode interromper.
- **Orbit:** `agent_send` e `agent_read` já existem para todos (bom), mas o handoff só vai ao líder, só o líder abre agentes e retomar ou interromper só acontece na UI.
- **Proposta:**
  - `handoff_submit` com `to` opcional (outro agente da missão) e `status: "progresso"` (registra no fluxo sem digitar no líder).
  - `agent_spawn` liberado para ajudantes que o líder marcar como "sub-líder", com limite de filhos. O líder herda os retornos agregados.
  - `agent_spawn({resume: N, task})` reaproveita a conversa de um ajudante fechado.
  - `agent_interrupt(N)`: Esc no terminal, sem fechar.

### 6. Spawn em lote e pasta por ajudante (itens 11, 12)

- **Overclock:** `panes[]` numa chamada só (o grid é recalculado uma vez) e `cwd` por ajudante, o que deixa o ajudante nascer no repositório certo.
- **Orbit:** um por chamada. O ajudante sempre nasce na pasta principal.
- **Proposta:**
  - `agent_spawn({ agents: [{title, task, kind, ...}, ...] })` com resolução de contas feita em conjunto (usa a lacuna 2 para espalhar).
  - Campo `folder` restrito às pastas do workspace, definindo o `cwd`.

### 7. Entrega sem estrutura nem contrato (itens 16, 17, 29)

- **Overclock:** evidência estruturada (comandos com exit code, arquivos, checks por requisito, testado), `expect.schema` validado no submit com retry, cético separado para afirmações importantes e revisão por referência (diff/commit).
- **Orbit:** resumo e detalhes livres. Verificação final genérica.
- **Proposta:**
  - `handoff_submit` aceita `evidence {commands:[{cmd, exitCode}], files:[…], tested}` opcional. O Orbit mostra isso no fluxo e marca como "sem evidência" a entrega de implementação que não traz nada.
  - Instrução ao líder: para correções e "pronto" importantes, abrir um ajudante revisor (linha `revisao` na tabela, de preferência na **outra** CLI, para ter uma segunda opinião) antes de aceitar.
  - `expect` simples: lista de campos obrigatórios em vez de JSON Schema completo, com uma devolução automática ao ajudante.

### 8. Papéis e skills chegam fracos ao Codex (itens 6, 26, 27)

- **Overclock:** copia as mesmas skills de papel e método para a pasta de skills de cada CLI e de cada conta, e a linha da tabela vincula a skill com contrato de carga.
- **Orbit:**
  - O tipo de tarefa só tem descrição.
  - O gate de skills funciona só no Claude.
  - As contas extras de Codex recebem `skills` via link simbólico (bom), mas o ajudante Codex não recebe disciplina de papel.
- **Proposta:**
  - **Campo "instruções" por linha da tabela**, como o `brief` dos papéis de squad, entregue no prompt de papel. Isso vale igual para Claude e Codex, porque vai no texto inicial.
  - **Instruções de fábrica curtas**, escritas pelo próprio Orbit: implementar com a menor mudança, rodar testes e entregar com evidência; investigar sem editar, com `arquivo:linha`; revisar tentando refutar.
  - **Política de tiers no prompt do líder:** "comece barato; suba de modelo só com motivo".

### 9. Continuidade e observabilidade (itens 32, 33, 34)

- **Overclock:** retoma todos os panes ao reabrir, registra cada decisão (quem abriu, tipo, modelo, skills) e conta decisões por regra e por LLM.
- **Orbit:** retomada manual. O fluxo da missão registra a abertura, mas não o motivo.
- **Proposta:**
  - Ao iniciar o sidecar, oferecer "retomar a tripulação" das missões ativas (`--resume` / `codex resume` com a mesma conta).
  - Registrar no evento de spawn o tipo, a origem da decisão e a conta escolhida com a folga, para avaliar depois se a tabela está boa.
  - Decisor LLM só se a classificação por regra se mostrar insuficiente.

### Fora de escopo (ignorado)

Pagamento, licença, planos Boost/Pro/Ultra, marketplace, geração de mídia, skins, voz (ClockVoice/Jarvis) e robô externo (Arms).

---

## 4. Teste ao vivo do Orbit (v0.2.7, 14/10/2026)

Missão agêntica num Orbit separado. O usuário escolheu só o líder (Claude Haiku), e a tabela mandava "Testes" para o Codex (esforço baixo) e "Documentação" para o Claude Haiku. O objetivo pedia um teste novo e um `DOCS.md`, com os dois ajudantes combinando entre si o nome do teste, sem passar pelo líder.

- **Funcionou:**
  - o líder classificou as atividades e o Orbit abriu o Codex para o teste e o Claude para a documentação;
  - os ajudantes combinaram o nome diretamente (`agent_send`): o Codex relatou "nome combinado e confirmado diretamente com #39", e o `DOCS.md` cita o nome certo;
  - `npm test` passou (5/5), e os dois retornos chegaram ao líder, que resumiu quem fez o quê.
- **Falhou:** o líder fechou o primeiro Codex (#38) antes de ele entregar ("por erro meu") e abriu outro (#40) com a mesma tarefa. Sem uma forma de esperar e sem proteção contra fechar quem não entregou, o líder julgou pela tela e errou. Isso confirma as lacunas 3 e 4 acima e acrescenta uma: o `agent_close` deveria recusar fechar um ajudante que ainda não entregou, salvo pedido explícito.
- **Custo:** cerca de 294 mil tokens (líder Haiku com esforço alto, a maior parte em cache).
