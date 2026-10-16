# Plano: Orbit 10/10 como orquestrador

**Objetivo:** levar as três fatias auditadas na missão "Testar Orbit" (roteamento 6,5/10, ciclo de vida/verificação 7/10, prompts e MCP 6/10) a 10/10, com critérios que dão para medir.
**Base:** relatórios aceitos T1 (`4c14369e-18aa-485f-81b4-247907145898`), T2 (`3cd2619a-bf87-4682-a625-5ba0014e6105`) e T3 (`2e0fc236-e543-457f-a67d-feec08dd8d6d`), mais as correções dos revisores. Todas as referências `arquivo:linha` foram conferidas na árvore atual (HEAD `0481897`, com as mudanças locais não commitadas do usuário).
**Escopo original:** planejamento dos 66 itens.
**Revisão de 16/10/2026:** incorpora a auditoria de segurança/confiabilidade e uma trilha de harness adaptativo baseado em evidência. Os itens originais não são considerados implementados por esta revisão. Pesquisa, estado de execução e contrato da nova trilha: [Harness adaptativo](plans/2026-10-16-orbit-adaptive-harness.md), com [fontes e limites da pesquisa](analysis/2026-10-16-harness-github-research.md).

## Como ler este plano

- **Caminhos:** `src/x.ts` quer dizer `packages/sidecar/src/x.ts`, e `test/x.test.ts` quer dizer `packages/sidecar/test/x.test.ts`. Os outros caminhos partem da raiz do repositório.
- **Rodar os testes:** `npm test -w @orbit/sidecar` (é `node --test "test/**/*.test.ts"`, não vitest) e `npm run typecheck` na raiz. Hoje: 225/225 passam, typecheck limpo.
- **IDs:**
  - `R` = Roteamento
  - `V` = Ciclo de vida e verificação
  - `P` = Prompts e MCP
  - `O` = Observabilidade e watchdog
  - `T` = Testes e medição
- **Origem:** cada item cita o achado do relatório (ex.: `T1/W3`, `T2/B5`, `T3/C2`). `lacuna` marca o que os relatórios sugerem mas não listaram como item.
- **Repros e sondagens:** "repro R1…R7" são as reproduções do relatório T2, e "sondagem A…I" são as do relatório T1. Não confundir com os itens `R1…R14` deste plano.
- **Tamanho:** P = até meio dia, M = 1 a 2 dias, G = 3 dias ou mais.
- **Risco:** o que pode quebrar ao mudar.
- **Teste primeiro:** escreva o teste, veja ele falhar pelo motivo certo, e só depois mude o código.
- **Regra de pacotes:** itens que mexem nos mesmos arquivos ficam no mesmo pacote de trabalho (WP). `src/core.ts` tem 2.854 linhas e quase tudo passa por ele. Por isso:
  - Cada WP declara **todos** os arquivos que toca, testes incluídos, com faixa de linhas quando não toca o arquivo inteiro.
  - Dois WPs que podem rodar ao mesmo tempo nunca tocam o mesmo arquivo sem faixa, nem faixas que se cruzem. Isso vale para os marcados **∥** e para qualquer par da mesma fase que não esteja ordenado por **→**.
  - As faixas se referem às linhas da árvore atual. Um WP que vem depois (→) rebaseia e reencontra as linhas pelo nome da função.
  - Os WPs entram em `main` um de cada vez (rebase antes do merge).
- **Itens em partes:** alguns itens aparecem em dois WPs, por exemplo "R1 (parte pura)" e "R1 (parte core)". A parte que aparece depois depende da que aparece antes. Na linha **Depende de**, o texto antes de "· parte core:" ou "· parte final:" vale para a primeira parte, e o texto depois vale para a segunda.

---

## 1. O que 10/10 significa (definições mensuráveis)

### Roteamento (hoje 6,5)
1. **Dificuldade:**
   - No corpus rotulado de 40 atividades (T2 abaixo), a dificuldade inferida acerta pelo menos 90%.
   - Zero rebaixamentos indevidos: nenhuma atividade rotulada `dificil` ou de leitura (investigação/revisão) cai abaixo do assento da tabela.
   - Toda mudança de tier tem um decisor ou uma evidência forte registrada no recibo.
2. **Classificação:**
   - Os 7 casos do relatório T1 (sondagens D e E) e os falsos positivos `docker`, `failover` e `fixtures` saem corretos.
   - `sure=true` só aparece com acerto ≥ 95% no corpus.
3. **Contas:**
   - Uma CLI não instalada ou deslogada nunca é escolhida (teste de integração com `codex` ausente).
   - Uma leitura de uso ausente ou velha (> 15 min) nunca vence uma leitura fresca de até 50%.
   - Uma chave de API paga só é usada quando nenhuma assinatura de nenhuma CLI permitida tem folga.
4. **Folga e failover:**
   - Nenhum agente novo abre numa conta acima de 85% de uso.
   - Um agente que bate limite (429, usage limit ou overloaded) é detectado em até 60 s.
   - Quando há outra conta com folga, ele é reaberto nela com o contexto, sem ação do líder (teste E2E com CLI falsa).
5. **Correção:**
   - `backAt` reflete a janela que de fato bloqueia.
   - `dificil` nunca baixa o esforço.
   - A conta de API com `model` próprio sempre lança com esse modelo.
6. Todos os itens `R*` estão fechados, com testes verdes.

### Ciclo de vida e verificação (hoje 7)
1. **Independência:**
   - Nenhum caminho aceita um resultado sem um revisor que não seja o produtor, e um veredito `changes_required` não é sobrescrito sem um resultado novo.
   - Um líder não declara pronta uma missão com diff no workspace e zero resultados revisados, a não ser com `force` auditado.
2. **Somente leitura:**
   - Um painel somente leitura (Claude ou Codex) não consegue alterar arquivo por nenhuma ferramenta: Edit/Write, Bash com redirecionamento, `sed -i`, `git commit` ou `git merge`.
   - Isso é provado por teste de hook com pelo menos 12 comandos de escrita e 12 de leitura.
3. **Freshness:**
   - Artefatos criados pelo revisor (coverage, test-results) não invalidam a revisão.
   - Repositórios com submódulo ou repositório aninhado, arquivo maior que 32 MiB ou mais de 20.000 arquivos conseguem entregar `done`.
4. **Integração:** uma revisão de integração não é aceita enquanto existir branch de ajudante aceito e não mesclado, ou worktree sujo.
5. **Recuperação:**
   - Nenhum estado fica travado para sempre: lease com PID reutilizado, lease sem PID, aviso para destinatário fechado e obrigação do próprio líder promovido.
   - Cada um é coberto por teste de reinício.
6. **Liveness:** um ajudante sem saída e sem hook por N minutos (padrão 10) gera aviso persistido ao líder, e o aviso sobrevive a reinício.
7. Todos os itens `V*` estão fechados.

### Prompts e MCP (hoje 6)
1. **Tamanho:**
   - Prompt do líder agêntico ≤ 6.000 caracteres (hoje 10.873).
   - Esquemas MCP do líder ≤ 20.000 caracteres (hoje 27.346).
   - Prompt de um ajudante construtor ≤ 2.800 caracteres (hoje 3.448 a 3.883).
   - Os três são medidos por teste.
2. **Coerência:**
   - Zero contradições: o teste de lint de prompt (T1 abaixo) checa que toda ferramenta citada em texto visível a um papel está registrada para esse papel.
   - Existe um único caminho de conclusão, descrito em um único lugar.
3. **Superfície:**
   - O líder tem ≤ 34 ferramentas, com ou sem git (hoje 40 sem git e 41 com git). A conta item a item está em 2.3, na seção "Conta das ferramentas do líder".
   - Um conceito, um nome: "result" em ferramentas, campos e mensagens.
   - Sem esquemas duplicados.
4. **Idioma:** com `english=true`, todo texto voltado a agente (respostas de ferramenta, erros, avisos) sai em inglês, e todo texto voltado ao usuário sai em português. Teste por amostragem de todas as respostas de ferramenta.
5. **Squads:** os três squads embutidos chegam a `mission_ready` sem `force`, num teste ponta a ponta com CLIs falsas.
6. Todos os itens `P*` estão fechados.

### Transversal: observabilidade e watchdog
1. Todo agente vivo tem um estado de saúde (`ativo`, `ocioso`, `travado`, `no limite`, `sem entregar`), visível ao líder numa única ferramenta e na UI.
2. Cada decisão de roteamento é correlacionada com o desfecho da atividade: aceita de primeira, retrabalho ou rejeitada. Dá para gerar um relatório por tier e por tipo.
3. Os eventos críticos geram aviso persistido, nunca só texto digitado: limite atingido, failover, lease travado e destinatário fechado.

### Transversal: testes
1. Existe CI rodando `npm test` e `npm run typecheck` em todo PR.
2. Cada item deste plano tem pelo menos um teste que falhava antes da mudança.
3. Há suítes de caos (reinício, PID reutilizado, CLI ausente, limite no meio da tarefa) e um benchmark de roteamento com relatório comparável entre versões.

---

## 2. Itens por fatia

### 2.1 Roteamento (R)

#### R1 — A heurística de dificuldade sobrescreve a tabela sem confirmação
- **Problema:** `assessDifficulty` usa regex por substring, sem tratar negação, e roda mesmo quando o líder informou `kind`. Os vereditos `simples`/`dificil` são finais: o decisor só é consultado quando a heurística diz `normal`.
- **Origem:** T1/W1 (sondagem D).
- **Onde:**
  - `src/maestro.ts:73-82`: regex `risk` em `:75`, `small` e `changes` em `:78-79`.
  - `src/core.ts:1682-1684`: sempre avalia.
  - `src/core.ts:1691`: pula o decisor quando o veredito é `simples`.
  - `src/core.ts:1705`: o Haiku só altera `normal`.
  - `src/core.ts:1723`: aplica o tier.
  - `src/core.ts:388-391`: o mesmo vale para o modelo do líder com `adaptiveLead`.
- **Mudança:**
  1. `assessDifficulty` passa a devolver `{ difficulty, why, confidence: 'forte' | 'fraca' }`. Negação ("not a simple", "não é simples") vira `normal` com confiança fraca. Sinais de escopo ("across", "all files", "N arquivos", "todos os") contam como risco.
  2. Em `src/core.ts:1675-1730`:
     - Mudança de tier com confiança fraca exige o decisor, mesmo com `kind` dado.
     - Se o decisor falhar, fica `normal`.
     - Linhas com `readOnly=true` na tabela (investigação, revisão) nunca descem de tier.
  3. Em `src/core.ts:388-391`, o líder adaptativo nunca desce abaixo da linha `routing.lead`; só sobe.
- **Teste primeiro:** `test/complexity.test.ts`, novo caso "difficulty never downgrades on negation, scope or read-only rows". Usa as 7 frases da sondagem D com o resultado esperado:
  - "Not a simple problem" → `normal`.
  - "Rename User->Account across 300 files" → `dificil`.
  - "Fix typo in SECURITY.md" → `simples`.
  - "README documents the architecture" → `normal`.
  - "Run tests concurrently in CI" → `normal`.
  - "Small change: delete billing module and migrate callers" → `dificil`.
  - "Check deps, upgrade lodash" → `normal`.

  Parte core (WP 2.2): em `test/balance.test.ts`, um `spawn` com `kind=investigacao` e texto "simple" mantém `claude-opus-5-5`.
- **Partes:** a parte pura (passo 1, `src/maestro.ts`) fica na WP 2.1. A parte core (passos 2 e 3, `src/core.ts`) fica na WP 2.2, depois de R11.
- **Aceite:** os 7 casos e o corpus T2 com acerto ≥ 90%. Nenhuma linha somente leitura é rebaixada. O recibo mostra "dificuldade confirmada por Haiku" ou "mantida: evidência fraca".
- **Tamanho:** M · **Risco:** médio. Mais chamadas ao decisor custam tokens e até 30 s de spawn (mitigado por R11) · **Depende de:** T2 (corpus) · parte core: R11.

#### R2 — Não há detecção de limite em tempo de execução nem failover
- **Problema:** o roteamento acontece só no spawn. Um agente que esgota a conta no meio da tarefa fica parado, e nada o reabre em outra conta.
- **Origem:** T1/W2 + lacuna ("runtime rate-limit detection with account failover").
- **Onde:**
  - `src/usage.ts:40` (Claude, statusline/hook já recebe `rate_limits`) e `src/usage.ts:70` (rollout do Codex já traz `rate_limits`).
  - `packages/sidecar/hooks/statusline.mjs:38`.
  - `src/panes.ts:283-288`, onde está `lastOutputAt`.
  - Spawn e resume em `src/core.ts:2412-2466`.
- **Mudança:**
  1. Criar o módulo `src/limitWatch.ts` com a função pura `limitSignal(input)`. Ela recebe o texto da tela, `rate_limits` do statusline/rollout e o código de saída, e devolve `{ kind: 'usage_limit' | 'rate_limited' | 'overloaded', resetsAt } | null`, reconhecendo as mensagens das CLIs ("usage limit reached", "429", "overloaded_error", "rate limit").
  2. Em `core.ts`:
     - Separar esgotamento de quota confirmado pelo provedor, cooldown transitório (429), sobrecarga e erro de autenticação. Mensagens de terminal não autorizam inventar `usedPercent=100` nem um reset. Preservar a última leitura confirmada e sua origem; gravar cooldown/disponibilidade separadamente.
     - Emitir um aviso persistido ao líder.
     - Antes de qualquer troca, interromper a tentativa anterior, aguardar encerramento confirmado e liberar seu lease. Persistir o evento e o cooldown para impedir replay após crash. Se `settings.autoFailover` estiver ligado (padrão ligado), reabrir a tentativa com `retryReason='limite da conta X'` numa conta com folga, passando como tarefa o resumo da conversa (`conversationOf`) e o pedido "continue de onde parou".
  3. Quando não houver conta livre, o aviso ao líder mostra o `backAt` correto (R9).
- **Teste primeiro:**
  - `test/limitWatch.test.ts` (novo): tabela de saídas reais de Claude e Codex → sinal esperado; uma saída comum não gera sinal.
  - `test/failover.test.ts` (novo, com o fixture de `test/helpers.ts`): um ajudante na conta A emite "usage limit reached"; espera-se a conta A marcada cheia, uma tentativa nova na conta B com `retryReason`, e um aviso persistido ao líder.
- **Aceite:** detecção em ≤ 60 s. Uma tentativa nova por evento, sem tempestade de failover: no máximo 1 failover por atividade a cada 10 min. O teste de reinício mantém o aviso.
- **Tamanho:** G · **Risco:** alto. Um falso positivo reabre um agente sem necessidade; a mitigação é exigir o padrão exato e permitir desligar o failover nas Configurações · **Depende de:** O1 (watchdog compartilha o laço), R3, R9, V13 (aviso persistido).

#### R3 — A admissão não tem margem: 95% conta como "livre"
- **Problema:** uma conta é "cheia" só a partir de 95%, e o uso troca 1:15 com o número de agentes. Uma conta ociosa a 94% vence uma conta a 0% com 7 agentes.
- **Origem:** T1/W2 (sondagem I).
- **Onde:**
  - `packages/protocol/src/index.ts:661` (`ACCOUNT_FULL_PERCENT = 95`).
  - `src/maestro.ts:103`.
  - `src/maestro.ts:139-151`: `LIVE_WEIGHT`, `cliLoad`.
  - `src/maestro.ts:166-170`: `chooseAccount`.
- **Mudança:** criar o limiar `ACCOUNT_ADMIT_PERCENT = 85` no protocolo. Acima dele a conta não recebe agente novo, mas os agentes que já estão nela continuam. `full` (≥ 95) segue valendo para o `backAt`. Opcionalmente, reservar uma margem por tier: `dificil` exige uso ≤ 75.
- **Teste primeiro:** em `test/balance.test.ts`, o caso "an idle 94% account loses to a 0% account with agents": a sondagem I passa a escolher a conta a 0%. Em `test/admission.test.ts`, uma conta a 86% não é escolhida enquanto houver outra abaixo de 85.
- **Aceite:** a sondagem I inverte o resultado, e nenhum spawn abre numa conta acima de 85% quando existe alternativa.
- **Tamanho:** P · **Risco:** baixo. Com uma só conta, o usuário pode ver "sem folga" mais cedo; a mensagem precisa dizer "acima de 85%" · **Depende de:** nenhum.

#### R4 — Uso desconhecido conta como 0% e leituras velhas valem como atuais
- **Problema:** `used=null` é tratado como 0 na ordenação, e `updatedAt`, `checkedAt` e `refreshError` são ignorados na seleção.
- **Origem:** T1/W3 (sondagem F).
- **Onde:**
  - `src/maestro.ts:96-107` (`accountRooms`, `used` em `:102`).
  - `src/maestro.ts:149` (`r.used ?? 0`).
  - `src/maestro.ts:169` (`a.used ?? 0`).
- **Mudança:**
  - `accountRooms` recebe `now` e separa o percentual observado do estado `current|unknown|stale|error|exhausted`.
  - Falha de refresh nunca reduz a evidência anterior: uma conta observada a 98% continua indisponível, sem se transformar em 50%. Janela vencida exige nova leitura, sem renovação presumida.
  - Antes de admissão automática com leitura ausente ou vencida, solicitar refresh; sem confirmação, preservar a restrição conservadora e informar a causa. Validade deve ser coerente com a UI.
  - `cliLoad` e `chooseAccount` usam disponibilidade confirmada e capacidade; desconhecido não equivale a 0% nem a uma medição fictícia.
- **Teste primeiro:** em `test/balance.test.ts`:
  - "unread account does not beat a fresh 20% account" (sondagem F inverte).
  - "a 2h-old 10% reading loses to a fresh 30% one".
- **Aceite:** as duas asserções passam, e as sondagens F e G (`Claude 30% vs Codex sem leitura` → sem mudança de CLI) se invertem.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### R5 — Uma CLI não instalada ou de status desconhecido conta como utilizável
- **Problema:** "command not found: codex" vira `loggedIn:null`, que é tratado como utilizável. O spawn nunca consulta se a CLI está instalada, e o padrão é `claude+codex`. Um usuário só com Claude recebe painéis Codex que morrem logo ao abrir.
- **Origem:** T1/W3 (sondagem G; cenário inferido do código).
- **Onde:**
  - `src/accounts.ts:244-249`.
  - `src/maestro.ts:98`.
  - `src/core.ts:2412-2466`.
  - `src/core.ts:2758-2761` (`allowedClis` padrão).
  - `apps/desktop/src/components/dialogs.tsx:82`.
  - `src/routing.ts:55`, `src/routing.ts:56`, `src/routing.ts:59`: linhas que vão para o Codex.
- **Mudança:**
  1. `accounts.ts`: quando a saída casa com `/command not found|not recognized|ENOENT/`, devolver `{ loggedIn: false, message: 'CLI não instalada' }`.
  2. `rooms()` em `src/core.ts:1162` filtra CLIs com `installed=false` vindas de `this.clis`.
  3. `allowedClis()` em `src/core.ts:2758-2761` e o padrão do diálogo (`apps/desktop/src/components/dialogs.tsx:82`) passam a usar só as CLIs instaladas.
  4. A linha da tabela cujo CLI não está instalado vai direto para o `alt`, com o recibo "Codex não instalado".
- **Partes:** os passos 1 a 3 (instalação: `src/accounts.ts`, `src/core.ts:1162`, `src/core.ts:2758-2761`, `dialogs.tsx`) ficam na WP 2.3. O passo 4 mexe no spawn (`src/core.ts:2412-2466`) e fica na WP 2.2, como parte core.
- **Teste primeiro:**
  - `test/accounts.test.ts`: "command not found maps to logged out".
  - `test/cliInstall.test.ts` (novo): `rooms('codex')` vem vazio com o Codex desinstalado (WP 2.3). Na parte core (WP 2.2), com `codex` desinstalado, `kind=revisao` (linha Codex) abre em Claude com o recibo correto.
- **Aceite:** com o Codex ausente, nenhum painel Codex é criado em 20 spawns de tipos variados.
- **Tamanho:** M · **Risco:** médio. A detecção de instalação precisa estar pronta antes do primeiro spawn; se `this.clis` ainda não leu, tratar como desconhecido e não mover · **Depende de:** nenhum · parte core: R5 (instalação).

#### R6 — Chave de API paga é preferida à assinatura ociosa da outra CLI
- **Problema:** `cliLoad` devolve `null` quando as assinaturas estão cheias, o que impede o balanceamento. `chooseAccount` devolve a API com `exhausted=false`, então o ramo "outra CLI" nunca roda.
- **Origem:** T1/W4 (sondagem B).
- **Onde:**
  - `src/maestro.ts:148-151`.
  - `src/maestro.ts:171-174`.
  - `src/core.ts:2441-2446` (`there !== null && here !== null`).
  - `src/core.ts:2447-2459`.
- **Mudança:** `chooseAccount` ganha a opção `{ allowApi: boolean }`. No spawn:
  1. Tentar as assinaturas da CLI da linha.
  2. Depois, as assinaturas do `alt` e das outras CLIs permitidas.
  3. Só então a API (de qualquer CLI), em ordem de criação.

  `here === null` (CLI cheia) com `there !== null` passa a mover.
- **Teste primeiro:** em `test/balance.test.ts`, a sondagem B: Claude a 96%, API Claude automática e Codex a 10% → escolhe a assinatura do Codex.
- **Partes:** a ordem de busca em `chooseAccount` (`src/maestro.ts`) é a parte pura, na WP 2.1. A troca em `src/core.ts:2441-2459` é a parte core, na WP 2.2.
- **Aceite:** a API só aparece no recibo quando todas as assinaturas de todas as CLIs permitidas estão acima de 85% (R3).
- **Tamanho:** P · **Risco:** baixo · **Depende de:** R3 · parte core: R6 (parte pura).

#### R7 — O modelo próprio de uma conta de API é sobrescrito pela tabela ou pelo tier
- **Problema:** `account.model` só vale quando `request.model` é nulo, mas a tabela e o tier sempre preenchem IDs completos, e o remapeamento por variável de ambiente só cobre aliases.
- **Origem:** T1/W5 (plausível, depende do provedor).
- **Onde:**
  - `src/core.ts:2476-2478`.
  - `src/routing.ts:52-58`.
  - `src/maestro.ts:110-113`.
  - `src/command.ts:93` (`--model` do Claude; o relatório citou `:84`, que é a linha do Antigravity).
  - `src/accounts.ts:181-185`.
- **Mudança:** quando `account.kind === 'api' && account.model`, o modelo final é `account.model`, e o tier ajusta só o esforço. O recibo diz "modelo da conta de API". Alternativa: lançar com o alias (`opus`/`sonnet`/`haiku`) para o remapeamento de `src/accounts.ts:181-185` funcionar; preferir a primeira opção, que é explícita.
- **Teste primeiro:** em `test/balance.test.ts`, com assinaturas cheias e uma API com `model='glm-4.6'` e `baseUrl`, `kind=bug` lança com `glm-4.6`. Em `test/command.test.ts`, o comando gerado contém `--model glm-4.6`.
- **Aceite:** os dois testes passam e a sondagem B mais a conta com modelo não emite um ID Claude.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** R6 (mesma região do spawn).

#### R8 — `dificil` pode escolher o esforço mais baixo
- **Problema:** com níveis sem `medium` e `effort=null`, o índice vira 0 e o resultado é `low`.
- **Origem:** T1/W6 (sondagem C).
- **Onde:** `src/maestro.ts:129-133`.
- **Mudança:** partir do esforço padrão do modelo, ou do mediano dos níveis, e nunca devolver um índice menor que o do esforço de entrada. Para `dificil`: `max(at, idx(default), idx('medium')) + 1`, limitado ao topo.
- **Teste primeiro:** em `test/complexity.test.ts`, com níveis `[low, high, xhigh]` e `effort=null`, `dificil` → `high`; e com `effort='xhigh'` → `xhigh`.
- **Aceite:** propriedade testada: para todo conjunto de níveis e toda entrada, `idx(saida) >= idx(entrada)` quando `dificil`.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### R9 — O "volta em" mostra a janela errada
- **Problema:** o código pega o menor `resetsAt` entre as janelas cheias de uma conta. Com a semanal a 100% (72 h) e a de 5 h a 97% (2 h), diz "2 h".
- **Origem:** T1/W7 (sondagem A).
- **Onde:**
  - `src/maestro.ts:104`.
  - `src/maestro.ts:172-173`.
  - `src/core.ts:2461`.
- **Mudança:** por conta, usar o `max` dos `resetsAt` das janelas cheias. Entre contas, usar o `min`.
- **Teste primeiro:** em `test/balance.test.ts`, o caso da sondagem A dá `backAt` igual ao reset semanal.
- **Aceite:** o teste passa, e a mensagem de `src/core.ts:2461` mostra "em 3 d".
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### R10 — O classificador casa substrings e devolve `sure=true`
- **Problema:** `docker` → documentação, `failover` → bug, `Add fixtures for the parser` → bug (por "fix" dentro de "fixtures"), todos com `sure=true`. Com isso o decisor é pulado.
- **Origem:** T1/W8 (sondagem E). Pela correção do revisor, o exemplo certo é "Add fixtures for the parser", não "Add test fixtures".
- **Onde:**
  - `src/maestro.ts:16-25` (`KEYWORDS`).
  - `src/maestro.ts:63` (`sure`).
- **Mudança:**
  - Fechar com `\b` os radicais curtos: `doc\b|docs\b`, `fix(es|ed)?\b`, `fail(s|ed|ure)?\b`.
  - Criar uma lista de exclusão (`docker`, `failover`, `fixture`, `prefix`, `suffix`).
  - `sure` exige `best.score >= 3` ou palavra no título.
- **Teste primeiro:** em `test/routing.test.ts`:
  - "Set up Docker" → `operacao`, ou `sure=false`.
  - "database failover" → `sure=false`.
  - "Add fixtures for the parser" → `testes` ou `funcionalidade`, nunca `bug`.
  - Mais 10 frases já corretas hoje, que não podem regredir.
- **Aceite:** o corpus T2 tem precisão de `sure=true` ≥ 95%.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** T2.

#### R11 — O decisor ignora contas e missão e bloqueia o spawn por até 30 s
- **Problema:** o decisor roda `claude -p` sem o `envPrefix` da conta (usa sempre a conta deste Mac, mesmo cheia ou deslogada, ou numa missão só-Codex) e segura o spawn por até 30 s.
- **Origem:** T1/W9.
- **Onde:**
  - `src/decider.ts:17` (`TIMEOUT_MS`).
  - `src/decider.ts:53-81` (comando em `:57-68`).
  - `src/core.ts:1691-1708`.
- **Mudança:**
  - `decideTaskType` recebe `envPrefix` e `cli`.
  - `core` escolhe a conta Claude com folga via `chooseAccount`. Se a missão não permite Claude ou não há conta, pula o decisor, com o recibo "decisor indisponível".
  - O timeout cai para 12 s.
  - Se o decisor falhar, a dificuldade fica `normal`, nunca o veredito fraco da heurística (alinhado com R1).
- **Teste primeiro:** em `test/adaptive.test.ts`, com a missão `allowedClis=['codex']`, `run` não é chamado para o decisor. Com a conta builtin deslogada e outra conta Claude logada, o comando começa com o `envPrefix` dessa conta.
- **Aceite:** os dois testes passam, e nenhuma chamada ao decisor usa uma conta com `loggedIn=false`.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### R12 — `pickAccount` está morto e diverge de `chooseAccount`
- **Problema:** `pickAccount` ignora agentes vivos e pode devolver uma conta builtin deslogada. Só é alcançado por `accountFor` sem conta pedida, coisa que o spawn não faz.
- **Origem:** T1/W10 (sondagem H).
- **Onde:**
  - `src/accounts.ts:102-112`.
  - `src/accounts.ts:92-95` (`usedPercent`, só usado por ele).
  - `src/core.ts:13` (import).
  - `src/core.ts:1188-1197` (`accountFor`, chamada em `:1196`).
- **Mudança:** remover `pickAccount` e, se não tiver outro uso, `usedPercent`. `accountFor` sem conta pedida usa `chooseAccount(this.rooms(cli, this.liveByAccount()))` e lança o erro de "sem folga" se `exhausted`.
- **Teste primeiro:** em `test/accounts.test.ts`, trocar o teste de `pickAccount` (se existir) por "accountFor never returns a logged-out account". `rg pickAccount packages` não devolve nada.
- **Aceite:** typecheck e testes verdes, e uma única política de escolha.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum. Herda sozinho o uso efetivo da WP 2.1 (`effectiveUsed`) quando ela entrar em `main`.

#### R13 — O modelo de carga é simplificado demais
- **Problema:** o modelo de carga tem três simplificações:
  - `cliLoad` olha só a melhor assinatura e ignora a capacidade total.
  - Painéis ociosos, ou entregues mas ainda abertos, pesam 15 como se estivessem ativos.
  - Os limites por modelo (Opus semanal) são ignorados.
- **Origem:** T1/W11.
- **Onde:**
  - `src/maestro.ts:150`.
  - `src/core.ts:1153-1160` (`liveByAccount`, linha `:1157`).
  - `src/claudeUsage.ts:61-62`.
  - `src/accountLimits.ts:8`.
- **Mudança:**
  1. `liveByAccount` conta só os painéis com `status` diferente de `idle` e sem `handoffStatus` final. Os ociosos pesam 5.
  2. `cliLoad` = média ponderada das assinaturas abertas, mais os agentes divididos pelo número de contas.
  3. Ler a linha "Current week (Opus)" do `/usage` (claudeUsage) e o `rateLimitsByLimitId` por modelo do Codex, guardando `perModel` em `AccountLimits`. `accountRooms` recebe o modelo pretendido e considera o balde do modelo.
- **Teste primeiro:**
  - `test/claudeUsage.test.ts`: fixture de `/usage` com a linha Opus a 100% → `perModel.opus.usedPercent=100`.
  - `test/balance.test.ts`: "an Opus-tier helper skips an account whose Opus bucket is full".
  - `test/balance.test.ts`: "two idle delivered panes weigh less than one running".
- **Partes:** os passos 2 e 3 (`src/maestro.ts`, `src/claudeUsage.ts`, `src/accountLimits.ts`, `AccountLimits` em `packages/protocol/src/index.ts:451-462`) são a parte pura, na WP 2.1. O passo 1 (`liveByAccount`, `src/core.ts:1153-1160`) é a parte core, na WP 2.2.
- **Aceite:** os três testes passam.
- **Tamanho:** M · **Risco:** médio. O parse de `/usage` é frágil a mudanças de texto da CLI; manter um fallback que ignora `perModel` · **Depende de:** R4 · parte core: R13 (parte pura).

#### R14 — Não há retorno do desfecho para calibrar o tier
- **Problema:** nada registra se o tier escolhido funcionou (retrabalho, rejeição da revisão), então a política não aprende nem pode ser auditada.
- **Origem:** lacuna (T1, "capability/cost model with outcome feedback").
- **Onde:**
  - `src/maestro.ts:5-8` (`decisionReceipt`).
  - `src/store.ts:388-394` (`startingAttempt` grava `decision`).
  - `src/store.ts:484-499` (`saveVerification`).
- **Mudança:** ao gravar a verificação de escopo `result`, anexar à tentativa `outcome: 'accepted_first' | 'changes_required' | 'retried' | 'waived'`. Criar o relatório `routingOutcomes(missionId?)` em `src/report.ts`, agrupado por `taskTypeId × difficulty × cli × model`, com taxa de aceite de primeira, tokens e custo.
- **Teste primeiro:** em `test/report.test.ts`, 3 atividades sintéticas (uma aceita de primeira, uma com `changes_required` e depois aceita, uma dispensada) → o relatório traz as três linhas com as contagens certas.
- **Aceite:** o relatório aparece em `orbit report` (`packages/sidecar/hooks/report.mjs`) e na UI de uso.
- **Tamanho:** M · **Risco:** baixo · **Depende de:** V1 (verdict estável).

### 2.2 Ciclo de vida e verificação (V)

#### V1 — Qualquer `accepted` posterior anula um `changes_required`
- **Implementação 16/10:** bloqueio de novo aceite sobre resultado rejeitado e proteção de leitura de históricos contraditórios aplicados; regressões em `packages/sidecar/test/harnessEvidence.test.ts`. Demais itens V não ficam concluídos por essa correção.
- **Problema:** `acceptedResult` olha só a última verificação. Uma rejeição do revisor é anulada em silêncio por um aceite seguinte, por exemplo do líder.
- **Origem:** T2/B1 (repro R1).
- **Onde:** `src/core.ts:1886-1887`, `src/store.ts:484-499`.
- **Mudança:**
  - Um resultado com qualquer `changes_required` (escopo `result`) fica rejeitado: só um resultado novo (nova tentativa) pode ser aceito.
  - `verifyResult` recusa `accepted` para um `resultId` que já tem `changes_required`, com a mensagem "rejeitado por #N; peça correção e um novo resultado".
  - Aceitar sobre `unverified` continua permitido.
- **Teste primeiro:** em `test/orchestration.test.ts`, o caso "a later accepted cannot override a reviewer's changes_required" reproduz R1 e espera `throws /rejeitado/`.
- **Aceite:** R1 inverte, e `verificationStatus` mostra `valid=false, reason='changes_required por #N'`.
- **Tamanho:** P · **Risco:** médio. Um revisor que errou trava o resultado; a saída é um resultado novo do produtor ou o `force` auditado · **Depende de:** nenhum.

#### V2 — A revisão independente não é independente do líder
- **Problema:** os checks são autodeclarados, e o líder pode inspecionar e aceitar sozinho o resultado de um ajudante. Também pode fazer a revisão de integração. Um ajudante mais o líder certificam uma missão.
- **Origem:** T2/W1 + lacuna ("independent review that cannot be overridden").
- **Onde:**
  - `src/core.ts:1904` (`provenance`).
  - `src/core.ts:1923` (proíbe só o produtor).
  - `test/orchestration.test.ts:23-33` (o líder aceita).
  - `src/store.ts:492`.
- **Mudança:** criar a política `settings.reviewPolicy` com três valores:
  - `'lead-allowed'`: o comportamento de hoje, mas o recibo marca "revisado pelo líder".
  - `'independent'` (novo padrão em agêntica e squad): o revisor de escopo `result` precisa ser um painel `crew` que não é o produtor nem ancestral dele, e o de integração precisa ser diferente de todos os produtores.
  - `'strict'`: além disso, o revisor precisa estar noutra CLI, ou noutro modelo, que o produtor.

  O registro passa a guardar `reviewer.role`. Os checks continuam autodeclarados (Orbit não executa comandos), mas o recibo e a UI mostram quem revisou.
- **Teste primeiro:** em `test/orchestration.test.ts`, com `reviewPolicy='independent'`, `verifyResult(lead, …)` lança `/revisor independente/`. Um ajudante `revisao` aceita. Ajustar o teste de `:23-33` para a política `lead-allowed`.
- **Aceite:** o teste novo passa e o fluxo agêntico padrão não aceita resultado revisado só pelo líder.
- **Tamanho:** M · **Risco:** médio. Muda o fluxo padrão e exige P2 (isenção de revisão de revisão) para não criar regressão infinita · **Depende de:** V1, P2.

#### V3 — `force` dispensa tudo só com um texto
- **Problema:** `mission_ready(force, reason)` dispensa entregas, revisões e integração de uma vez, e nada limita isso além do prompt.
- **Origem:** T2/W2.
- **Onde:** `src/core.ts:1985-2006` (gate em `:1990-1994`).
- **Mudança:**
  - `force` passa a exigir `waive: string[]` com os IDs de atividade dispensados explicitamente, e não "todos". Uma atividade com `changes_required` (V1) não pode ser dispensada, a não ser com `settings.allowWaiveRejected`.
  - O resumo final lista cada dispensa.
  - A UI mostra um selo "pronta com dispensas".
- **Teste primeiro:** em `test/finalization.test.ts`:
  - "force without waive list is refused".
  - "force cannot waive a rejected result".
  - "waived ids appear in readySummary".
- **Aceite:** os três testes passam.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** V1.

#### V4 — Somente leitura não vale para o Bash
- **Problema:** para o Claude, somente leitura nega só `EDIT_TOOLS`. Um líder agêntico, ou um ajudante "somente leitura", escreve por Bash (`cat >`, `sed -i`, `git commit`) e quebra a serialização de writers.
- **Origem:** T2/W3 + T3/C1 + lacuna ("read-only enforcement for Bash").
- **Onde:**
  - `src/core.ts:69` (`EDIT_TOOLS`).
  - `src/core.ts:2327-2335` (hook PreToolUse).
  - `src/core.ts:2511` (`isReadOnly`).
  - `src/core.ts:2545` (sandbox só no Codex).
  - `src/core.ts:2564`.
- **Mudança:**
  1. Aplicar somente leitura estrita no filesystem/processo por sandbox compatível ou execução isolada. O filtro puro `src/readOnlyGuard.ts` pode ser uma defesa adicional, nunca a fronteira de segurança. Uma escolha explícita incompatível deve falhar; uma escolha automática pode usar um adapter compatível. O filtro adicional detecta:
     - redirecionamento `>`/`>>` fora de `/dev/null` e do scratchpad (`$TMPDIR`);
     - `tee`, `sed -i`, `perl -pi`, `rm`, `mv`, `cp`, `mkdir`, `touch`, `chmod`, `truncate`, `dd of=`;
     - `git commit|merge|rebase|reset|checkout|switch|stash|apply|am|cherry-pick|push`, `npm|pnpm|yarn install|add|remove`;
     - `python -c`/`node -e` com `writeFile`/`open(...,'w')`.

     Na dúvida (heredoc para arquivo, `eval`), nega.
  2. O hook em `src/core.ts:2327` passa a aplicar `bashWrites` quando `tool_name === 'Bash'` e o painel é somente leitura (inclui o líder agêntico/squad, `src/core.ts:2332`).
  3. Para o Claude, lançar os painéis somente leitura também com `--disallowedTools` para as ferramentas de edição (segunda barreira).
  4. Atualizar o recibo de `src/core.ts:2564`.
- **Teste primeiro:** `test/readOnlyGuard.test.ts` (novo), com 12 comandos de escrita negados e 12 de leitura permitidos: `git diff`, `git log`, `npm test`, `cat`, `rg`, `ls`, `node --test`, `git status`, `sed -n`, `jq`, `wc`, `head`. Em `test/hooks.test.ts`, um payload `PreToolUse Bash "echo x > src/a.ts"` num painel somente leitura → `deny`.
- **Aceite:** os dois testes passam, e o cenário "líder escreve por Bash e declara pronto" de T2/W3 é negado.
- **Tamanho:** M · **Risco:** alto. A sandbox deve limitar os caminhos de escrita, com scratch explícito. `.gitignore` não concede permissão; `npm test`, `node script.mjs` e intérpretes podem escrever e precisam do mesmo confinamento · **Depende de:** nenhum para o código. Mas só entra em `main` junto com a WP 0.3 (ferramenta `integrate`); antes disso, o líder Claude de missão com git perderia o único jeito de mesclar.

#### V5 — Uma missão com diff e zero resultados revisados pode ser declarada pronta
- **Problema:** `readiness` não vê resultado gerenciado e libera `mission_ready` sem revisão nenhuma, mesmo com o workspace alterado.
- **Origem:** T2/W3 (cenário) + sugestão 1.
- **Onde:** `src/core.ts:1975-1983` (`hasManagedResults` em `:1979-1981`).
- **Mudança:**
  - Em missões agêntica e squad, `readiness` calcula `sourceRevision` do workspace contra o fingerprint gravado na criação da missão (novo campo `mission.baseSource`).
  - Se mudou e não há resultado revisado, devolve `unreviewedChanges=true`, que bloqueia sem `force`.
  - Em missões com git, comparar `git diff --quiet base..HEAD` mais o worktree sujo.
- **Teste primeiro:** em `test/finalization.test.ts`, "ready is refused when the workspace changed and no result was reviewed".
- **Aceite:** o teste passa, e uma missão sem mudança nenhuma continua podendo ficar pronta sem revisão.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** V7 (reusa a lógica de git).

#### V6 — Os artefatos do próprio revisor invalidam a revisão
- **Problema:** qualquer arquivo não ignorado criado entre `result_inspect` e `verification_submit` (coverage/, test-results/) torna o aceite impossível. Resultados somente leitura também ficam presos ao source.
- **Origem:** T2/B2 (repro R2).
- **Onde:**
  - `src/core.ts:1861-1866` (`refreshSource`).
  - `src/core.ts:1924`.
  - `src/core.ts:2131` (fingerprint no `done`).
  - `src/verification.ts:16-61`.
- **Mudança:**
  1. `sourceRevision` honra um `.orbitignore` na raiz, com padrões gitignore, e tem uma lista padrão (`coverage/`, `test-results/`, `.nyc_output/`, `playwright-report/`, `*.lcov`, `__snapshots__/*.snap.new`).
  2. Resultados de atividades `readOnly` gravam `source` com `bound=false`: o refresh só compara HEAD e index, não o conteúdo dos arquivos não rastreados.
  3. A mensagem de erro diz qual caminho mudou (o diff das `entries`).
- **Teste primeiro:** em `test/verification.test.ts`:
  - "reviewer artifacts in coverage/ do not change the fingerprint" (reproduz R2).
  - "the error names the changed path".
- **Aceite:** R2 inverte, e um arquivo de código alterado continua invalidando.
- **Tamanho:** M · **Risco:** médio. Ignorar demais abre brecha; a lista padrão é curta e o `.orbitignore` é versionado · **Depende de:** nenhum.

#### V7 — A integração não confere se os branches foram mesclados
- **Problema:** `integrationState` faz o hash só de `leadPath`. Um branch de ajudante aceito e esquecido passa na revisão de integração, e mudanças não commitadas do ajudante se perdem no merge.
- **Origem:** T2/B8 + lacuna ("merge check at integration").
- **Onde:**
  - `src/core.ts:1868-1876`.
  - `src/core.ts:2110-2114` (`commitsAhead` só aparece no texto).
  - `src/core.ts:296` (`branches`).
  - `src/git.ts:93` (`commitsAhead`).
  - `src/git.ts:57` (`dirtyFiles`).
- **Mudança:**
  - Em `verifyResult` com escopo `integration` e `accepted`, e em `readiness`: para cada resultado aceito cujo painel tem `branch`, exigir `commitsAhead(repo, mission.branch, helperBranch).length === 0` e `dirtyFiles(worktree).length === 0`.
  - O erro lista os branches pendentes com o comando `git merge` (ou a ferramenta `integrate` de P1).
- **Teste primeiro:** em `test/worktrees.test.ts` (usa `test/gitFixture.ts`), "integration accept is refused while an accepted helper branch is not merged" e "… while the helper worktree is dirty".
- **Aceite:** os dois testes passam, e depois do merge o aceite funciona.
- **Tamanho:** M · **Risco:** baixo · **Depende de:** nenhum.

#### V8 — Os limites do fingerprint impedem qualquer `done`
- **Problema:** um arquivo acima de 32 MiB, um total acima de 128 MiB, mais de 20.000 arquivos ou um repositório aninhado/submódulo fazem o `handoff done` lançar erro. Só `blocked` funciona.
- **Origem:** T2/B3 (repros R3 e R3b).
- **Onde:**
  - `src/verification.ts:7` (limites).
  - `src/verification.ts:31` e `src/verification.ts:43` (contagem).
  - `src/verification.ts:50` (diretório).
  - `src/verification.ts:51` (tamanho).
  - `src/core.ts:2131`.
- **Mudança:**
  1. Diretório listado pelo git (gitlink/submódulo/repositório aninhado): registrar `[path, 'gitlink:' + (git -C path rev-parse HEAD || 'dirty-unknown'), mode]` em vez de lançar.
  2. Arquivos grandes: hash completo por streaming com memória limitada e verificação de consistência do arquivo durante a leitura; não usar apenas prefixo/sufixo, tamanho e mtime.
  3. Muitos arquivos/bytes: snapshot completo ou blobs verificáveis fora da thread principal. Evidência parcial/degradada deve impedir aceite automático e indicar a lacuna; `git diff --stat` não substitui conteúdo.
  4. Rodar o fingerprint fora do caminho síncrono do motor, com prazo e cancelamento sem registrar sucesso parcial.
- **Teste primeiro:** em `test/verification.test.ts`:
  - "a middle-byte change in a 33 MiB file changes its digest even with preserved size and mtime" (R3).
  - "an untracked nested git repo yields a gitlink entry" (R3b).
  - "over 20k files yields complete asynchronous evidence or blocks acceptance explicitly".
- **Aceite:** R3 e R3b entregam `done`, e uma mudança num arquivo grande ainda altera o digest.
- **Tamanho:** M · **Risco:** médio. O modo degradado é mais fraco; precisa ficar visível na revisão · **Depende de:** V6 (mesmo arquivo; fazer junto).

#### V9 — Um lease velho bloqueia writers para sempre
- **Problema:** depois de um crash:
  - Um lease com PID que o sistema reutilizou bloqueia enquanto esse PID estiver vivo (correção do revisor).
  - Um lease sem PID (crash entre reservar e `bindExecutionProcess`) nunca é limpo (correção do revisor).
  - `clearExecution`, `forgetPane` e `forgetMission` não apagam leases.

  O resultado é "Conflito de escrita" mesmo numa missão nova.
- **Origem:** T2/B5 (repro R5).
- **Onde:**
  - `src/store.ts:228-246` (`startExecution`, laço em `:232-238`, `continue` sem PID em `:234`).
  - `src/store.ts:252-255` (`bindExecutionProcess`).
  - `src/store.ts:271-278` (`clearExecution`).
  - `src/store.ts:1092` (`forgetPane`).
  - `src/store.ts:1105-1110` (`forgetMission`).
- **Mudança:**
  1. Gravar `{ pid, startedAt }`, com `startedAt` vindo de `ps -o lstart= -p PID` (macOS/Linux) no `bind`. No reinício, um lease cujo PID está vivo mas com `lstart` diferente é tratado como morto.
  2. Lease sem PID herdado de uma execução anterior (`inheritedExecutions`) é morto: o processo nunca chegou a ser associado.
  3. `forgetPane` e `forgetMission` apagam `executionPolicies[paneId]` quando não há processo vivo associado à época atual.
  4. Ação de UI e servidor `lease.release(paneId)`, com confirmação do usuário, para os casos restantes.
- **Teste primeiro:** em `test/executionLease.test.ts`:
  - "a reused PID with a different start time does not block" (R5).
  - "an inherited pid-less lease is cleared on restart".
  - "forgetMission removes its leases".
- **Aceite:** R5 inverte, e os três testes passam.
- **Tamanho:** M · **Risco:** médio. Liberar um lease de um processo vivo de verdade permite dois writers; o `lstart` precisa bater exatamente · **Depende de:** nenhum.

#### V10 — O líder promovido perde a conversa do líder anterior
- **Problema:** `changeLead` calcula `previous.turns` mas só passa para um líder novo. O ajudante promovido recebe "leia o fim da conversa anterior", mas `mission_briefing` é chamado sem `previous`.
- **Origem:** T2/B9.
- **Onde:**
  - `src/core.ts:845`, `src/core.ts:857`, `src/core.ts:865-867`.
  - `src/mcp.ts:261-263`.
  - `test/leadership.test.ts:133-137`.
- **Mudança:**
  - Ao trocar de líder, gravar `mission.previousLead = { paneId, turns: últimos N turnos (limitados a 12 KB) }` no store.
  - `missionBriefing(missionId)` usa `previous ?? store.previousLead(missionId)`.
  - O evento de `src/core.ts:865` só diz "com o dossiê" quando o tail foi gravado.
- **Teste primeiro:** em `test/leadership.test.ts`, depois de promover, `mission_briefing` chamado pelo promovido contém "End of the previous lead's conversation" e uma frase do líder antigo.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### V11 — O ajudante promovido mantém a própria obrigação pendente
- **Problema:** `reassignDeliveries` passa a obrigação do ajudante para ele mesmo, e um líder não tem `handoff_submit`. Resultado: `mission_ready` só sai com `force`.
- **Origem:** T2/B4 (repro R4).
- **Onde:**
  - `src/store.ts:918-923`.
  - `src/core.ts:862`.
  - `src/mcp.ts:359` (`handoff_submit` só para crew).
- **Mudança:** em `changeLead` com `promote`, marcar a obrigação pendente do próprio promovido como `superseded`, com `replacementId=null` e o resumo "promovido a líder". `reassignDeliveries` ignora registros com `paneId === next`.
- **Teste primeiro:** em `test/leadership.test.ts`, depois de promover, `pendingDeliveries` não contém o promovido e `missionReady` não falha por "#N".
- **Aceite:** R4 inverte.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### V12 — Um aviso para um destinatário fechado fica preso para sempre
- **Problema:** um resultado entregue `to` um revisor que depois foi fechado não chega a ninguém. A busca do destinatário falha e o aviso é pulado em silêncio.
- **Origem:** T2/B6 (repro R6).
- **Onde:**
  - `src/core.ts:1517-1534` (destinatário em `:1520-1521`).
  - `test/deliveryQueue.test.ts:114`.
- **Mudança:** em `dispatchDeliveries`, se `recipient.kind === 'pane'` e o painel não existe ou está `exited` sem tentativa ativa, redirecionar para o líder: `store.retargetNotice(id, {kind:'lead'})`, com o evento "redirecionado: #N fechado". Marcar a obrigação do revisor fechado como `superseded`.
- **Teste primeiro:** em `test/deliveryQueue.test.ts`, "a notice to a closed reviewer is re-routed to the lead" (R6).
- **Aceite:** R6 inverte. O caso já existente "reviewer exited and restarted" continua verde.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### V13 — Ajudante que sai sem entregar avisa só por texto digitado
- **Problema:** `tellAssigner` digita no terminal do líder se ele estiver vivo. Se não estiver, devolve `null` e nada é persistido.
- **Origem:** T2/Q1.
- **Onde:**
  - `src/core.ts:208`.
  - `src/core.ts:2035-2042`.
- **Mudança:** trocar por uma notificação persistida (`store.addNotification` do tipo `exit_without_result`), entregue pelo mesmo outbox com ACK. `tellAssigner` fica só como atalho visual.
- **Teste primeiro:** em `test/deliveryObligations.test.ts`, um ajudante sai sem entregar com o líder morto; depois o líder é reaberto e recebe o aviso.
- **Aceite:** o teste passa, e o aviso tem `deliveryId` e aceita `delivery_ack`.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### V14 — Qualquer `agent_send` do líder vira trabalho obrigatório novo
- **Problema:** uma pergunta de esclarecimento depois do aceite cria uma obrigação e uma atividade novas, revoga o `ready` e exige nova revisão mais nova integração, herdando os critérios antigos. Isso empurra o líder para o `force`.
- **Origem:** T2/B7 (repro R7).
- **Onde:**
  - `src/core.ts:1814-1819` (`sendTo`, `assign` em `:1818`).
  - `src/core.ts:2009-2019`.
  - `src/store.ts:871-882`.
  - Esquema de `agent_send` em `src/mcp.ts:317`.
- **Mudança:** `agent_send` ganha `newWork?: boolean`, padrão `false` quando o destinatário já entregou `done` aceito e `true` nos outros casos. Com `newWork=false`, não chama `assign`. A resposta da ferramenta diz qual dos dois aconteceu.
- **Teste primeiro:** em `test/delivery.test.ts`, depois de accepted+ready, um `agent_send` sem `newWork` mantém o `ready`. Com `newWork=true`, revoga (R7).
- **Aceite:** os dois testes passam.
- **Tamanho:** P · **Risco:** médio. O líder pode pedir trabalho real sem `newWork=true` e o trabalho ficar sem revisão; a descrição da ferramenta e o recibo precisam ser explícitos · **Depende de:** P12 (mesma área do MCP).

#### V15 — A retomada pula painéis sem `sessionId` e não avisa o líder
- **Problema:** a retomada tem três lacunas:
  - Painéis sem `sessionId` são ignorados.
  - Uma falha de retomada vira só um evento de UI.
  - O líder retomado não recebe a lista de quem não voltou e pode esperar para sempre.
- **Origem:** T2/Q5.
- **Onde:**
  - `src/core.ts:1798-1811` (filtro em `:1801`, falha em `:1808`).
  - `src/core.ts:70` (`RESUME_NOTE`).
- **Mudança:**
  - Depois do laço, montar a lista `{ pane, motivo }` dos que não voltaram, incluindo os sem `sessionId`.
  - Se houver líder retomado, enviar a ele um aviso persistido "não voltaram: #N (motivo); reabra com agent_resume ou outro ajudante".
  - Marcar as tentativas como `stopped` com o motivo.
- **Teste primeiro:** em `test/restart.test.ts`, um ajudante sem `sessionId` mais um com falha de resume → o líder retomado recebe um aviso que lista os dois.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** V13 (mesmo mecanismo de aviso persistido).

#### V16 — Um estado com `version !== 1` é apagado ao carregar
- **Problema:** `load()` devolve um estado vazio quando a versão é diferente, e o construtor grava esse vazio por cima de `state.json`. Um downgrade apaga tudo (latente hoje).
- **Origem:** T2/Q5.
- **Onde:** `src/store.ts:1178-1183` (`:1181`), `src/store.ts:225`.
- **Mudança:** com versão desconhecida, renomear o arquivo para `state.json.v{N}.bak`, registrar um erro visível na UI e abrir em modo somente leitura (sem `flush`) até o usuário decidir.
- **Teste primeiro:** em `test/stateVersion.test.ts` (novo; `test/restart.test.ts` fica com a WP 1.3), "an unknown state version is backed up, not overwritten".
- **Aceite:** o teste passa, e o arquivo original continua existindo byte a byte.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### V17 — Uma falha de disco ao confirmar o envio faz o aviso ser redigitado
- **Problema:** se `markNoticeAccepted` falhar depois que o texto já foi digitado, o `finally` limpa a chave e o próximo ciclo digita o texto de novo.
- **Origem:** T2/Q1.
- **Onde:** `src/core.ts:1526-1530`, `src/core.ts:171` (timer de 2 s).
- **Mudança:** guardar em memória `typedNotices: Map<noticeId:epoch, at>` antes do `finally`. `dispatchDeliveries` pula as chaves digitadas e tenta só gravar de novo o `markNoticeAccepted`.
- **Teste primeiro:** em `test/deliveryQueue.test.ts`, com o store forçado a lançar em `markNoticeAccepted` uma vez, o PTY recebe o texto exatamente uma vez em 3 ciclos.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### V18 — A deduplicação por `activityId` ignora mudança de tarefa
- **Problema:**
  - Sem `activityId`, uma paráfrase da tarefa duplica o trabalho.
  - Com `activityId`, uma tarefa diferente com os mesmos critérios devolve o painel antigo em silêncio, porque `contractHash` não inclui o texto da tarefa.
- **Origem:** T2/Q3.
- **Onde:**
  - `src/activityLedger.ts:11-12` (`contractHash`).
  - `src/core.ts:1607-1614` (`delegationKey`).
  - `src/store.ts:358-365`.
- **Mudança:**
  - Incluir `taskDigest` (sha256 do texto normalizado) no registro da atividade, sem colocá-lo no `contractHash`.
  - Num replay com `activityId` igual e `taskDigest` diferente, devolver o painel com o aviso "tarefa diferente da original; use retryReason para uma revisão nova", em vez do silêncio.
  - O caso sem `activityId` não faz parte de V18: o passo 1 do prompt novo de P10 (Fase 3) já manda usar o id do card como `activityId`.
- **Teste primeiro:** em `test/activityLedger.test.ts`, "same activityId with a different task returns a warning".
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### V19 — Um conflito de writer é recusado em vez de enfileirado
- **Problema:** um writer em conflito é recusado, e o líder precisa lembrar de reabrir mais tarde.
- **Origem:** T2/Q3.
- **Onde:** `src/store.ts:240-242`, `src/scheduler.ts:17-19`, `src/core.ts:1664-1667` (o `catch` que chama `failAttempt`, para a tentativa reservada não ficar órfã quando a abertura falha), `src/core.ts:2597-2601` (o `catch` do lançamento que solta o lease de execução).
- **Mudança:** criar a opção `queue: true` em `agent_spawn` (em `ADMISSION_FIELDS` e `HelperInput`, `src/mcp.ts:52-58`).
  - Com ela, um conflito mantém a tentativa `reserved` e grava o pedido numa fila persistida do store (`spawnQueue`, junto de `startExecution`).
  - Quando o lease em conflito é liberado, `src/scheduler.ts` escolhe o próximo da fila. O core só liga isso no ouvinte de `terminated` (`src/core.ts:169`, que chama `releaseExecution`).
  - Sem `queue`, o comportamento de hoje fica.
- **Teste primeiro:** em `test/admission.test.ts`, um segundo writer com `queue=true` fica na fila e abre sozinho quando o primeiro sai.
- **Aceite:** o teste passa, e a fila sobrevive a um reinício simulado no mesmo arquivo (`test/admission.test.ts`; `test/restart.test.ts` fica com a WP 1.3).
- **Tamanho:** M · **Risco:** médio · **Depende de:** V9.

#### V20 — Com `resumeOnStart` desligado, nada volta e ninguém sabe
- **Problema:** com a opção desligada, `resumeCrews` sai na primeira linha. Ninguém fica sabendo quem estava rodando, as obrigações ficam pendentes e as tentativas continuam como se estivessem vivas. O líder reaberto à mão não recebe a lista de V15.
- **Origem:** T2/Q5 ("With `resumeOnStart` off, nothing resumes").
- **Onde:**
  - `src/core.ts:1798-1799` (`resumeCrews` e o `return` cedo).
  - `src/store.ts:77`, `src/store.ts:148`, `src/store.ts:152` (`wasRunning`, que não é esvaziado nesse caso).
  - `src/store.ts:18` (padrão `resumeOnStart: true`).
  - `apps/desktop/src/components/RoutingDialog.tsx:211` (a opção na UI).
- **Mudança:**
  - Com a opção desligada, `resumeCrews` ainda esvazia `wasRunning` e monta a mesma lista `{ pane, motivo: 'retomada automática desligada' }` de V15.
  - As tentativas dessa lista viram `stopped`, com o motivo no campo `error`.
  - A missão ganha um aviso persistido (V13) para o líder, entregue quando ele for reaberto. A UI da missão mostra "N agentes não foram retomados", com o botão de reabrir cada um.
- **Teste primeiro:** em `test/restart.test.ts`, "resumeOnStart=false stops the running attempts and lists them to the lead": com a opção desligada e dois ajudantes que estavam rodando, nenhum é reaberto, as duas tentativas ficam `stopped` e o líder reaberto recebe um aviso com os dois.
- **Aceite:** o teste passa, e com a opção ligada o caso de V15 continua igual.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** V15 (mesma lista e mesmo aviso).

#### V21 — `mission_ready` não exige que os avisos de resultado tenham sido confirmados
- **Problema:** `readiness` olha obrigações, validação e integração, mas não o estado dos avisos. O líder pode declarar a missão pronta com um aviso de resultado em `persisted` ou `pty_accepted`, ou seja, sem nunca ter confirmado que leu o resultado.
- **Origem:** T2/Q1 ("ACK is not required for `mission_ready`").
- **Onde:**
  - `src/core.ts:1975-1983` (`readiness`).
  - `src/core.ts:1985-1994` (gates de `missionReady`).
  - `src/store.ts:293-295` (`notifications(missionId, pendingOnly)` já filtra os não confirmados).
  - `packages/protocol/src/index.ts:399-409` (`DeliveryNotice.state`).
- **Mudança:**
  - `readiness` devolve `unacknowledged`: os avisos da missão que não estão em `agent_acknowledged` e que apontam para o resultado atual de uma atividade não dispensada.
  - Sem `force`, `mission_ready` (e o caminho de `verification_submit(readySummary)`) recusa com a lista de `deliveryId` e o pedido "confirme com delivery_ack".
  - Avisos redirecionados por V12 contam para o novo destinatário, então um revisor fechado não trava a missão.
- **Teste primeiro:** em `test/finalization.test.ts`, "ready is refused while a result notice is not acknowledged": com resultado aceito e integração revisada, mas o aviso ao líder ainda em `pty_accepted`, `missionReady` lança `/delivery_ack/`. Depois do `delivery_ack`, passa.
- **Aceite:** o teste passa, e uma missão sem avisos pendentes conclui como hoje.
- **Tamanho:** P · **Risco:** baixo. Um líder antigo que não confirma avisos passa a ver uma recusa a mais; a mensagem diz o que fazer · **Depende de:** V12 (redirecionamento para destinatário fechado).

#### V22 — Num checkout compartilhado, outro writer invalida os resultados pendentes
- **Problema:** é o ponto de T2/B2 que V6 não cobre. Sem worktrees, todos os writers usam a mesma cópia, e o fingerprint de cada resultado cobre a cópia inteira. Quando o writer seguinte muda qualquer arquivo, todo resultado que ainda espera revisão passa a falhar com "O código foi alterado desde a entrega", mesmo que a mudança não tenha nada a ver com ele.
- **Origem:** T2/B2 ("The same happens to every pending result in a shared checkout whenever any writer touches any file").
- **Onde:**
  - `src/core.ts:1861-1866` (`refreshSource` compara o digest da cópia inteira).
  - `src/core.ts:2131` (fingerprint no `done`).
  - `src/core.ts:2554` (`startExecution`, onde começa a tentativa writer).
  - `src/store.ts:240-242` (o lease só impede writers ao mesmo tempo, não um depois do outro).
  - `src/verification.ts:16-61`.
- **Mudança:**
  1. Ao começar uma tentativa writer (`src/core.ts:2554`), gravar o fingerprint de partida na tentativa (`baseSource`, em `ActivityAttempt`).
  2. No `done`, gravar em `source.touched` os caminhos cujas `entries` mudaram entre `baseSource` e o fingerprint da entrega.
  3. Quando o resultado tem `touched`, `refreshSource` compara blobs/conteúdo e tombstones desses caminhos, mais dependências explicitamente vinculadas. HEAD e index globais ficam na revisão de integração, para que um commit ou staging de outro arquivo não invalide o resultado independente.
  4. Se outro writer mexeu num caminho de `touched`, o erro diz qual caminho e qual painel tinha o lease naquele intervalo.
  5. Resultados sem `touched` (históricos ou somente leitura, V6) seguem a regra de V6.
- **Teste primeiro:** em `test/sharedCheckout.test.ts` (novo, com `test/gitFixture.ts`), dois writers em sequência na mesma cópia:
  - "a later writer outside the touched paths does not invalidate a pending result".
  - "a later writer on a touched path invalidates it and the error names the path".
- **Aceite:** os dois testes passam, e a revisão de integração continua cobrindo a cópia inteira (`src/core.ts:1868-1876` não muda).
- **Tamanho:** M · **Risco:** médio. Um arquivo criado por um writer e apagado por outro some de `touched`; por isso a revisão de integração continua sendo o portão final · **Depende de:** V6, V8 (mesmo formato de `entries`).

### 2.3 Prompts e MCP (P)

#### P1 — O líder de missão com git recebe ordem de mesclar, mas é somente leitura
- **Problema:** o líder de missão com git recebe "faça `git merge` e commit", mas roda em modo somente leitura. Um líder Codex não consegue integrar; um líder Claude só consegue por causa do buraco do Bash (V4).
- **Origem:** T3/C1.
- **Onde:**
  - `src/prompts.ts:173-178` (`worktreeNote` do líder).
  - `src/prompts.ts:58`.
  - `src/core.ts:2511`, `src/core.ts:2545`.
  - `src/mcp.ts:253` (`branches`).
- **Mudança:**
  - Criar a ferramenta de líder `integrate({ agent })`. O core roda `git merge --no-ff <branch>` no `leadPath` (via `src/git.ts`, função nova `mergeBranch`), devolve conflitos sem resolver (aborta o merge) e faz commit.
  - `integrate` é registrada só em missão com git e substitui `branches` (`src/mcp.ts:252-259`). Sem `agent`, ela devolve o mesmo resumo que `branches` devolve hoje. Assim o número de ferramentas do líder não muda (ver "Conta das ferramentas do líder").
  - Em conflito, a resposta manda abrir um ajudante `bug` no branch da missão.
  - Atualizar `worktreeNote` para "integre com a ferramenta integrate".
- **Teste primeiro:** em `test/worktrees.test.ts`, "integrate merges an accepted helper branch from a read-only lead" e "integrate aborts and reports a conflict".
- **Aceite:** os dois testes passam, e um líder Codex somente leitura integra um ajudante num teste com `test/gitFixture.ts`.
- **Tamanho:** M · **Risco:** médio. Um merge automático feito pelo Orbit precisa nunca deixar o repositório no meio de um merge · **Depende de:** V7.

#### P2 — A revisão de revisão nunca termina
- **Problema:** toda atividade reservada recebe `verificationRequired=true`, inclusive o resultado do próprio revisor `revisao` e as investigações. O prompt diz "todo resultado exige revisor" sem prever exceção.
- **Origem:** T3/C2 + lacuna ("review-of-review exemption").
- **Onde:**
  - `src/store.ts:349` e `src/store.ts:373` (`verificationRequired = true`).
  - `src/prompts.ts:90`.
  - `src/core.ts:1923`.
- **Mudança:** `reserveActivity` recebe `verificationRequired`, que é `false` quando o tipo é `revisao`, o papel de squad é de revisão (flag nova `reviewer: true` em `SquadRole`) ou a atividade é `readOnly` de investigação com `noReview: true` pedido pelo líder. A obrigação de entrega continua. O texto de `src/prompts.ts:90` passa a dizer: "Results of kind revisao are not reviewed again; their verdict is the review."
- **Teste primeiro:** em `test/finalization.test.ts`, uma missão com 1 construtor e 1 revisor `revisao` que aceita, mais a revisão de integração pelo revisor, chega a `ready` sem `force` e sem revisar o revisor.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** médio. Uma investigação sem revisão pode trazer conclusão errada; só isentar por pedido explícito · **Depende de:** nenhum.

#### P3 — Os squads embutidos não passam pelas portas de verificação
- **Problema:** os playbooks não têm passo de `result_inspect`/`verification_submit` (Auditoria nem tem revisor), e `readiness` recusa o `ready`.
- **Origem:** T3/C3.
- **Onde:**
  - `src/squads.ts:20-26` (Correção de bug).
  - `src/squads.ts:40-46` (Funcionalidade).
  - `src/squads.ts:56` e `src/squads.ts:60-65` (Auditoria).
  - `src/prompts.ts:75`.
  - `src/core.ts:1990-1992`.
- **Mudança:**
  1. Marcar `revisor`, `verificador` e os três auditores com `reviewer: true` (P2).
  2. Acrescentar ao playbook o passo "O Revisor registra o parecer com result_inspect + verification_submit no resultado do Construtor e depois a revisão de integração com readySummary".
  3. Na Auditoria, os auditores são somente leitura e isentos (P2), e a integração é revisada por um deles ou pelo líder conforme `reviewPolicy` (V2).
  4. `src/prompts.ts:75` passa a listar os 3 passos de conclusão.
- **Teste primeiro:** em `test/squads.test.ts`, um teste ponta a ponta por squad (fixture com CLIs falsas que entregam `done` e revisam) chega a `ready` sem `force`.
- **Aceite:** os 3 testes passam.
- **Tamanho:** M · **Risco:** baixo · **Depende de:** P2, V2.

#### P4 — "Aceitar" tem dois sentidos
- **Problema:** `src/prompts.ts:60` usa "aceitar" no sentido informal (pedir evidência por `agent_send`), enquanto o `VERIFICATION_NOTE` define o aceite formal.
- **Origem:** T3/C4.
- **Onde:** `src/prompts.ts:60`, `src/prompts.ts:15`.
- **Mudança:** reescrever `:60` como "If evidence is missing, ask the helper with agent_send before reviewing." Reservar "accept" para `verification_submit`.
- **Teste primeiro:** em `test/prompts.test.ts` (novo, ver T1), "the lead prompt uses 'accept' only with verification_submit": nenhuma frase com `accept` sem `verification_submit` na mesma frase.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** T1.

#### P5 — O ajudante recebe texto de líder
- **Problema:** todo ajudante recebe o `VERIFICATION_NOTE` inteiro (integração, `mission_ready`, `force`) e a instrução de `delivery_ack`, mesmo sem nunca receber avisos. São uns 300 tokens de ruído por construtor.
- **Origem:** T3/C5.
- **Onde:** `src/prompts.ts:121`, `src/prompts.ts:123`, `src/prompts.ts:105-125`.
- **Mudança:**
  - Dividir o texto em `VERIFICATION_REVIEWER`, só a parte de escopo `result`, dada só a `taskType.id==='revisao'` ou a papel com `reviewer: true`.
  - A instrução de `delivery_ack` só vai quando `children > 0`, ou quando o ajudante é revisor (recebe resultados por `to`).
- **Teste primeiro:** em `test/prompts.test.ts`, `crewRole(... funcionalidade)` não contém `scope="integration"` nem `mission_ready`, e tem ≤ 2.800 caracteres. `crewRole(... revisao)` contém `result_inspect`.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** T1, P2.

#### P6 — Textos visíveis ao ajudante citam `handoff_list`, que só o líder tem
- **Problema:** textos que um ajudante vê mandam usar `handoff_list`, uma ferramenta que só o líder tem.
- **Origem:** T3/B1, mais as duas ocorrências apontadas pelo revisor.
- **Onde:**
  - `src/mcp.ts:132` (descrição de `activity_status`).
  - `src/mcp.ts:374` (resposta de `handoff_submit` duplicado).
  - `src/core.ts:1557` (`more.tool` no retorno de `delivery_ack`, que ajudantes com sub-ajudantes e revisores também chamam).
  - `src/core.ts:2128` (texto do aviso "(detalhes em handoff_list)", que chega a revisores via `to`).
  - Registro em `src/mcp.ts:303` (dentro do bloco do líder, `src/mcp.ts:166`).
- **Mudança:** registrar `handoff_list` também para crew, com escopo `deliveredTo === caller.id`. A ferramenta já aceita `resultId` (`src/mcp.ts:303-305`), então não é preciso criar `result_get`, e o líder não ganha ferramenta nova. Trocar as 4 referências pelo nome que o destinatário tem. Com P14, o nome final é `result_list`.
- **Teste primeiro:** em `test/prompts.test.ts` (lint T1), para cada papel, todo nome de ferramenta citado em prompts, descrições, respostas e avisos que esse papel recebe está entre as ferramentas registradas para ele.
- **Passo final (destrava T1):** em `test/prompts.test.ts`, remover o `todo` dos casos de lint por papel (`lead`, `crew`, `crew com children`). Eles passam a rodar sem `todo` e precisam estar verdes neste WP.
- **Aceite:** o lint passa para `lead`, `crew` e `crew com children`, sem `todo`.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** T1.

#### P7 — O esquema de critérios do `handoff_submit` é mais frouxo que o do `verification_submit`
- **Problema:** em `handoff_submit`, `criteria.how` não tem `min(1)` e `item` não tem máximo, enquanto `verification_submit` exige os dois.
- **Origem:** T3/B2.
- **Onde:** `src/mcp.ts:369`, comparado com `src/mcp.ts:154`.
- **Mudança:** usar `item: z.number().int().min(1).max(8)` e `how: z.string().min(1).max(300)`. O core valida `item <= acceptance.length`.
- **Teste primeiro:** em `test/mcp.test.ts`, um `handoff_submit` com `how: ''` ou `item: 9` → `isError`.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### P8 — Copiar o `attemptId` à mão é cerimônia
- **Problema:** o ajudante precisa copiar `whoami.agent.attemptId` para o handoff, mas o campo é opcional e o servidor já sabe a tentativa de quem chama.
- **Origem:** T3/B3.
- **Onde:** `src/prompts.ts:122`, `src/mcp.ts:364`, `src/store.ts:342-345`.
- **Mudança:** remover a frase do prompt. O core preenche `attemptId = store.currentPaneAttempt(caller.id)?.id` quando ausente. O campo continua aceito para compatibilidade, mas some da descrição.
- **Teste primeiro:** em `test/submission.test.ts`, um handoff sem `attemptId` grava o resultado com a tentativa atual, e um `attemptId` velho continua sendo recusado.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### P9 — A nota do navegador omite ferramentas
- **Problema:** o `BROWSER_NOTE` não cita `browser_key` nem `browser_scroll`.
- **Origem:** T3/B4.
- **Onde:** `src/prompts.ts:13`, `src/mcp.ts:456`, `src/mcp.ts:464`.
- **Mudança:** gerar a lista a partir das ferramentas registradas com prefixo `browser_` (constante exportada de `mcp.ts`).
- **Teste primeiro:** em `test/prompts.test.ts`, o conjunto de ferramentas `browser_*` citadas é igual ao conjunto registrado.
- **Passo final (destrava T1):** em `test/prompts.test.ts`, remover o `todo` do caso de lint do navegador (`browser_*`), que passa a rodar sem `todo`.
- **Aceite:** o teste passa, sem `todo`.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** T1.

#### P10 — O prompt do líder espalha as regras das portas
- **Problema:** as regras de conclusão aparecem em 8 lugares, com mecânica interna demais e cerca de 2,7k tokens.
- **Origem:** T3/W1 + lacuna ("prompt simplification with no contradictions").
- **Onde:**
  - `src/prompts.ts:15`.
  - `src/prompts.ts:55`.
  - `src/prompts.ts:61-64`.
  - `src/prompts.ts:90-91`.
  - `src/mcp.ts:153`, `src/mcp.ts:241`.
- **Mudança:** reescrever o bloco `orchestrate` como um caminho feliz de 6 passos, com uns 1,2k tokens:
  1. Um card por atividade; o id do card vira `activityId`.
  2. `agent_spawn` com `kind` e `accept`.
  3. Encerrar o turno.
  4. Ao chegar um aviso, `delivery_ack(includeResult)`; depois abrir um revisor `revisao`, ou revisar você mesmo se `reviewPolicy` permitir.
  5. Integrar (`integrate`, P1), depois `result_inspect(scope=integration)` e `verification_submit(readySummary)`.
  6. Dispensas só com `mission_waive` (P11).

  Apagar `:55` e as frases de mecânica de `:61-62`; as semânticas de `retryReason`, `dependsOn` e `readOnly` ficam nas descrições das ferramentas e nos erros.
- **Teste primeiro:** em `test/prompts.test.ts`, `leadRole(agentica)` tem ≤ 6.000 caracteres. Cada um dos termos `mission_ready`/`mission_waive`, `readySummary` e `scope="integration"` aparece em no máximo 1 parágrafo.
- **Aceite:** o teste passa, e um benchmark (T4) com o prompt novo não piora a taxa de missões concluídas sem `force`.
- **Tamanho:** M · **Risco:** médio. Um prompt mais curto pode perder um comportamento que só o texto garantia; o T4 mede isso · **Depende de:** P1, P2, P11, P12, T1.

#### P11 — Há dois caminhos de conclusão
- **Problema:** dá para concluir por `mission_ready` ou por `verification_submit(readySummary)`, e os dois são explicados 8 vezes.
- **Origem:** T3/W2.
- **Onde:** `src/mcp.ts:240-244` (`mission_ready`), `src/mcp.ts:152-155`, `src/core.ts:1985-2006`.
- **Mudança:**
  - A conclusão normal passa a ser só `verification_submit(readySummary)`.
  - Renomear `mission_ready` para `mission_waive({ summary, waive: string[], reason })`, usado só para dispensas (V3).
  - Manter um alias `mission_ready` por uma versão, que devolve erro orientando quando chamado sem `force`.
- **Teste primeiro:** em `test/mcp.test.ts`:
  - "lead tool list has mission_waive and no mission_ready (after alias removal)".
  - "mission_waive without waive list fails".
  - Em `test/finalization.test.ts`, o fluxo normal conclui só com `verification_submit`.
- **Aceite:** os testes passam, e o texto do prompt descreve um caminho só.
- **Tamanho:** M · **Risco:** médio. Quebra o hábito de líderes antigos; o alias cobre uma versão · **Depende de:** V3.

#### P12 — As ferramentas de status se sobrepõem
- **Problema:** `agent_list`, `activity_status`, `delivery_status` e `verification_status` repetem o que `mission_status` e `missionProgress` já reúnem.
- **Origem:** T3/W6 + lacuna ("overlapping status tools").
- **Onde:**
  - `src/mcp.ts:93` (`agent_list`).
  - `src/mcp.ts:116-129` (`mission_status`).
  - `src/mcp.ts:131` (`activity_status`).
  - `src/mcp.ts:142` (`delivery_status`).
  - `src/mcp.ts:157` (`verification_status`).
  - `src/core.ts:1955` (`missionProgress`).
- **Mudança:**
  - Criar `mission_progress`, que expõe `core.missionProgress` mais `pendingDeliveries` e o `health` de cada agente (O1), com um filtro opcional `activityId`.
  - Remover `activity_status`, `delivery_status`, `verification_status` e `agent_list`, que já está contido em `mission_status.agents`.
  - Saldo: +1 −4 = −3. O líder vai de 40 para 37 ferramentas sem git (41 → 38 com git).
- **Teste primeiro:** em `test/mcp.test.ts`, a contagem de ferramentas do líder cai exatamente 3 em relação a antes de P12. `mission_progress` devolve as atividades, a validade, o estado de integração e `health` (reusar `test/missionProgress.test.ts`). A meta final (≤ 34) é testada em P22.
- **Aceite:** os testes passam.
- **Tamanho:** M · **Risco:** baixo · **Depende de:** O1 (campo `health`).

#### P13 — `agent_spawn` e `agent_spawn_many` duplicam o esquema
- **Problema:** as duas ferramentas têm o mesmo esquema de campos duplicado, cerca de 1,7k tokens juntas.
- **Origem:** T3/W7.
- **Onde:** `src/mcp.ts:194`, `src/mcp.ts:199`.
- **Mudança:** manter só `agent_spawn({ helpers: Helper[1..8] })`. Para compatibilidade, aceitar também um objeto único na raiz por uma versão.
- **Teste primeiro:** em `test/mcp.test.ts`, `agent_spawn` com `helpers` de 2 itens abre 2 painéis, e o tamanho total dos esquemas do líder é ≤ 20.000 caracteres.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### P14 — Um conceito tem três nomes
- **Problema:** o mesmo conceito aparece como "handoff" (`handoff_submit`, `handoff_list`), "delivery" (`delivery_ack`, `delivery_status`, `pendingDeliveries`) e "result" (`result_inspect`, `resultId`).
- **Origem:** T3/W9 + lacuna ("handoff/delivery/result naming").
- **Onde:**
  - `src/mcp.ts:161` (`delivery_ack`).
  - `src/mcp.ts:303` (`handoff_list`).
  - `src/mcp.ts:360` (`handoff_submit`).
  - `src/mcp.ts:126` (`pendingDeliveries`).
  - `src/prompts.ts:41`, `src/prompts.ts:122`.
- **Mudança:**
  - Renomear para `result_submit`, `result_list` (que P6 já liberou para crew) e `result_ack`. São só trocas de nome: a contagem de ferramentas não muda.
  - Renomear o campo `pendingDeliveries` para `pendingResults` nas respostas.
  - Manter os nomes antigos como aliases ocultos por uma versão, com a resposta "renomeado para …".
  - Atualizar o hook de Stop (`HANDOFF_NUDGE`).
- **Teste primeiro:** em `test/prompts.test.ts` (lint), nenhum texto voltado a agente contém `handoff_` ou `delivery_` fora da lista de aliases. Em `test/mcp.test.ts`, os aliases respondem.
- **Aceite:** os testes passam.
- **Tamanho:** M · **Risco:** médio. Toca todos os prompts e testes de MCP; fazer depois de P6 e P12 · **Depende de:** P6, P11, P12.

#### P15 — O idioma do texto voltado a agente é misturado
- **Problema:** com `english=true`, as respostas de ferramenta, os erros, `RESUME_NOTE`, o cabeçalho dos avisos, `agentView.role`, as descrições da tabela e os briefs de squad continuam em português.
- **Origem:** T3/W11.
- **Onde:**
  - `src/mcp.ts:20-27` (erros).
  - `src/mcp.ts:34-36` (`'líder'`/`'ajudante'`).
  - `src/mcp.ts:197`, `src/mcp.ts:374`.
  - `src/core.ts:70`, `src/core.ts:2129`.
  - `src/prompts.ts:48`.
  - `src/routing.ts:52-59`.
  - `src/squads.ts:20-70`.
- **Mudança:**
  - Criar `src/messages.ts` com uma tabela `{ id: { en, pt } }` e uma função `msg(id, english, vars)`.
  - Converter as respostas de ferramenta e os erros lançados para agentes (o `guardTool` traduz pelo id do erro). Os erros que vão à UI continuam em português.
  - As descrições da tabela e os briefs de squad, escritos pelo usuário, vão marcados "(user-written, Portuguese)".
  - Criar a regra de idioma para `project_note`: português, porque o usuário lê.
- **Teste primeiro:** em `test/mcp.test.ts`, chamar cada ferramenta do líder e do ajudante com entradas válidas e inválidas com `english=true`. Nenhuma resposta pode conter um destes marcadores de português: `ção`, `não`, `você`, ` de #`.
- **Aceite:** o teste passa, e com `english=false` tudo sai em português.
- **Tamanho:** G · **Risco:** médio. Muitas strings; fazer por último, depois das renomeações · **Depende de:** P11, P12, P13, P14, P20, P21, P22.

#### P16 — A tabela de roteamento completa vai no prompt do líder
- **Problema:** a tabela vai com CLI, modelo e esforço no prompt do líder, ao lado da instrução "não escolha CLIs".
- **Origem:** T3/W12.
- **Onde:** `src/prompts.ts:19-27` (`routingTable`), `src/prompts.ts:84`, `src/prompts.ts:87-88`.
- **Mudança:** mostrar só `kind` com o nome e a descrição de uma linha, sem CLI, modelo ou esforço.
- **Teste primeiro:** em `test/prompts.test.ts`, `leadRole(agentica)` não contém `claude-opus-5-5` nem `effort`.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** T1.

#### P17 — As descrições de ferramentas têm jargão interno
- **Problema:** várias descrições usam termos internos, como "R4", "legacy compatible", "None means code validation" e "No skill compliance…".
- **Origem:** T3/W13.
- **Onde:**
  - `src/mcp.ts:107`, `src/mcp.ts:112`.
  - `src/mcp.ts:143`, `src/mcp.ts:148`.
  - `src/mcp.ts:158`, `src/mcp.ts:163`.
  - `src/mcp.ts:304`.
- **Mudança:** reescrever cada uma como "Use when…" mais uma frase sobre o que devolve.
- **Teste primeiro:** em `test/prompts.test.ts`, nenhuma descrição contém `R4`, `legacy`, `compatibility` ou `guarantee`, e cada descrição tem ≤ 300 caracteres.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** P12 (descrições removidas não precisam de reescrita).

#### P18 — O briefing não mostra o estado de revisão
- **Problema:** o briefing não diz quais resultados estão aceitos, quais faltam e se a integração está em dia. Também mostra só os 8 últimos resultados e não tem um mapa atividade→card→resultado.
- **Origem:** T3/G1, G2.
- **Onde:** `src/core.ts:770-824` (resultados em `:808`), `src/core.ts:1948`, `src/core.ts:1955`.
- **Mudança:** acrescentar duas seções:
  - `## Review state`, a partir de `missionProgress`: aceito, falta revisão, rejeitado e integração atual/velha.
  - `## Activities`, uma tabela `activityId | card | resultId atual | estado`, com todos os itens. Seções grandes viram referência via `contextPack`.
- **Teste primeiro:** em `test/contextIntegration.test.ts`, numa missão com 10 resultados, o briefing lista os 10 IDs (inline ou por referência) e a seção de revisão mostra "rejeitado" para o rejeitado.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** V1.

#### P19 — `mission_note` é exclusivo do líder
- **Problema:** as decisões dos ajudantes só sobrevivem no texto do handoff.
- **Origem:** T3/G3.
- **Onde:** `src/mcp.ts:270`.
- **Mudança:** manter como está, por decisão consciente, e registrar no `crewRole` a frase "Put decisions that must outlive you in your handoff details." Alternativa: liberar `mission_note` para crew com o prefixo `#N`.
- **Teste primeiro:** em `test/prompts.test.ts`, `crewRole` contém "decisions" na instrução de entrega.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** P5.

#### P20 — Duas ferramentas para anotar
- **Problema:** `project_note` e `mission_note` fazem a mesma coisa (gravar uma nota) e só mudam o destino. São dois esquemas e duas descrições que se citam.
- **Origem:** lacuna ("overlapping tools"; necessária para a meta de ≤ 34 ferramentas).
- **Onde:** `src/mcp.ts:265-268` (`project_note`), `src/mcp.ts:270-273` (`mission_note`).
- **Mudança:** uma ferramenta só, `note({ scope: 'missao' | 'projeto', kind?, text })`. `kind` (`decisao`, `fato`, `licao`) é exigido só com `scope='projeto'`. O core continua chamando `addNote` e `addProjectNote`. Saldo: −1.
- **Teste primeiro:** em `test/mcp.test.ts`, `note` com `scope='missao'` aparece no briefing, e `scope='projeto'` sem `kind` → `isError`.
- **Aceite:** o teste passa, e a lista do líder não tem mais `project_note` nem `mission_note`.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### P21 — `accounts_status` é mais uma ferramenta de status
- **Problema:** a folga das contas é um status da missão, mas fica numa ferramenta separada.
- **Origem:** T3/W6 (status sobrepostos) + lacuna (meta de ≤ 34 ferramentas).
- **Onde:** `src/mcp.ts:212-214` (`accounts_status`), `src/mcp.ts:116-129` (`mission_status`).
- **Mudança:** `mission_status` ganha a seção `accounts` (o mesmo `core.capacity(missionId)`), só quando quem chama é o líder. `accounts_status` sai. Saldo: −1.
- **Teste primeiro:** em `test/mcp.test.ts`, `mission_status` do líder tem `accounts`, e o de um ajudante não tem.
- **Aceite:** o teste passa.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** P12 (mesma área das ferramentas de status).

#### P22 — `agent_resume` duplica `agent_send`
- **Problema:** para falar com um ajudante, o líder usa `agent_send` se ele está vivo e `agent_resume` se ele saiu. A diferença é um detalhe que o Orbit já conhece.
- **Origem:** lacuna (meta de ≤ 34 ferramentas).
- **Onde:** `src/mcp.ts:232-238` (`agent_resume`), `src/mcp.ts:317-323` (`agent_send`), `src/core.ts:1814-1819` (`sendTo`).
- **Mudança:** quando o líder chama `agent_send` para um ajudante que saiu, o core faz o que `resumeHelper` faz hoje: retoma na mesma conversa e digita a mensagem. A resposta diz "retomado". Para um ajudante, `agent_send` para um agente que saiu continua sendo erro. `agent_resume` sai. Saldo: −1.
- **Teste primeiro:** em `test/mcp.test.ts`, um `agent_send` do líder para um ajudante `exited` retoma o painel com a mesma `sessionId`. Aqui também fica o teste final da meta: a lista do líder, sem os aliases de P11/P14, tem ≤ 33 ferramentas sem git e ≤ 34 com git.
- **Aceite:** os testes passam.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** V14 (mesma ferramenta; a regra de `newWork` vale também para a retomada).

#### Conta das ferramentas do líder
Hoje o líder tem 40 ferramentas numa missão sem git e 41 com git (a mais é `branches`). As contas abaixo saem do registro em `src/mcp.ts:78-476`.

| Item | Muda | Sem git | Com git |
|---|---|---|---|
| hoje | — | 40 | 41 |
| P1 | +`integrate` −`branches`, só com git | 40 | 41 |
| P12 | +`mission_progress` −`activity_status` −`delivery_status` −`verification_status` −`agent_list` | 37 | 38 |
| P13 | −`agent_spawn_many` | 36 | 37 |
| P11 | `mission_ready` → `mission_waive` (troca de nome) | 36 | 37 |
| P6 | `handoff_list` liberada para crew; o líder não ganha nada | 36 | 37 |
| P20 | `project_note` + `mission_note` → `note` | 35 | 36 |
| P21 | −`accounts_status` (vira seção de `mission_status`) | 34 | 35 |
| P22 | −`agent_resume` (absorvida por `agent_send`) | 33 | 34 |
| P14 | trocas de nome (`result_submit`, `result_list`, `result_ack`) | 33 | 34 |

Resultado: 40 − 3 − 1 − 1 − 1 − 1 = 33 sem git, e 41 − 3 − 1 − 1 − 1 − 1 = 34 com git. A meta ≤ 34 vale nos dois casos.

Os aliases de P11 e P14 (`mission_ready`, `handoff_list`, `delivery_ack`) ficam registrados por uma versão. Nessa versão o teste de P22 desconta a lista `LEGACY_ALIASES`; na versão seguinte os aliases saem e a conta crua já fica ≤ 34. Nenhum outro item deste plano cria ferramenta de líder: V14 e V19 só acrescentam campos, e V9 é uma ação da UI e do servidor, não do MCP.

---

## 3. Itens transversais

### 3.1 Observabilidade e watchdog (O)

#### O1 — Não há watchdog de travamento
- **Problema:** um ajudante preso no meio do turno (ferramenta longa, diálogo de permissão, CLI congelada) nunca é detectado.
- **Origem:** T2/Q1, sugestão 8 + lacuna ("stall watchdog").
- **Onde:**
  - `src/panes.ts:14` e `src/panes.ts:283-288` (`lastOutputAt`, `DELIVERY_QUIET_MS`).
  - `src/core.ts:171` (timer de entregas, que é o modelo para o novo timer).
  - `src/core.ts:2030-2032` (`owesHandoff`).
- **Mudança:**
  1. Criar o módulo puro `src/watchdog.ts` com `health(pane, now, lastOutputAt, lastHookAt, status)`, que devolve `'ativo' | 'ocioso' | 'travado' | 'esperando_permissao' | 'sem_entregar' | 'no_limite'`. Os limiares (padrão 10 min sem saída nem hook com status `running`; 3 min em `waiting`) ficam nas Configurações.
  2. Um timer de 30 s em `core` avalia os painéis que devem entrega. Na transição para `travado` ou `esperando_permissao`, cria uma notificação persistida (V13) ao assignador, uma vez por transição.
  3. `health` entra em `agentView` (`src/mcp.ts:34-48`), então já aparece em `mission_status.agents` nesta fase. Quando P12 criar `mission_progress` (Fase 3), ela herda o campo. O selo na UI fica com O2 (Fase 4).
- **Teste primeiro:** em `test/watchdog.test.ts` (novo), uma tabela de casos para `health`. Num teste de integração com relógio falso, um ajudante sem saída por 11 min gera exatamente 1 aviso, e o aviso sobrevive a reinício.
- **Aceite:** os testes passam, e não há aviso para um ajudante `idle` que já entregou.
- **Tamanho:** M · **Risco:** médio. Ferramentas legítimas longas (build de 15 min) geram falso positivo; o aviso é informativo, não mata nada · **Depende de:** V13.

#### O2 — A saúde e os recibos de roteamento estão espalhados
- **Problema:** o recibo de decisão existe, mas não há visão agregada de saúde por conta, failovers, tiers e desfechos.
- **Origem:** lacuna.
- **Onde:**
  - `src/report.ts`.
  - `src/measurements.ts:74` (`HarnessMeasurements`).
  - `src/core.ts:1210` (`mission.progress`).
  - `apps/desktop/src/components/UsagePanel.tsx`.
- **Mudança:**
  - Juntar R14 (desfechos), R2 (failovers), O1 (saúde) e V9 (leases) num relatório `orbitHealth()`, exposto por `mission.progress` e por `orbit report --health`.
  - Na UI, um selo por agente e um contador de failovers e avisos por missão.
- **Teste primeiro:** em `test/report.test.ts`, uma missão sintética com 1 failover, 1 travado e 1 lease liberado → o relatório traz os 3 contadores.
- **Aceite:** o teste passa, e a UI mostra o selo (verificar com `npm run typecheck` e um teste visual manual descrito no PR).
- **Tamanho:** M · **Risco:** baixo · **Depende de:** R2, R14, O1, V9.

#### O3 — Eventos críticos só aparecem como texto digitado ou evento de UI
- **Problema:** limite atingido, failover, lease travado, destinatário fechado e falha de retomada não deixam rastro que o líder possa reconhecer.
- **Origem:** T2 (padrão observado em B6, Q1 e Q5).
- **Onde:** `src/core.ts:208`, `src/core.ts:1808`, `src/core.ts:1520-1521`.
- **Mudança:** toda situação dessas passa por `store.addNotification` com `kind` tipado (`exit_without_result`, `stalled`, `limit_hit`, `failover`, `lease_blocked`, `resume_failed`, `retargeted`) e é entregue pelo outbox com ACK. É a soma de V12, V13, V15, O1 e R2 com um tipo comum.
- **Teste primeiro:** em `test/deliveryQueue.test.ts`, "every critical notification kind is persisted and acknowledged", parametrizado pelos 7 tipos.
- **Aceite:** o teste passa.
- **Tamanho:** P (depois dos itens base) · **Risco:** baixo · **Depende de:** V12, V13, V15, O1, R2.

### 3.2 Testes e medição (T)

#### T1 — Não há testes de regressão de prompt
- **Problema:** `leadRole` não é testado em `test/`. Ferramentas citadas sem registro (P6, P9) passaram despercebidas.
- **Origem:** T3/W16.
- **Onde:** criar `test/prompts.test.ts`.
- **Mudança:** criar o arquivo com:
  1. **Orçamento de tamanho:**
     - `leadRole` agêntico ≤ 6.000 caracteres.
     - `leadRole` squad ≤ 6.500 caracteres.
     - `crewRole` construtor ≤ 2.800 caracteres.
     - `crewRole` revisor ≤ 3.600 caracteres.
     - Esquemas do líder ≤ 20.000 caracteres, medidos com `listTools` como em `test/mcp.test.ts`.
  2. **Lint de ferramentas:** extrair os tokens `[a-z]+_[a-z_]+` de todo texto que um papel recebe e checar que estão registrados para esse papel. Os textos são o prompt, as descrições, as respostas de exemplo e o texto de aviso (`src/core.ts:2129`).
  3. **Lint de contradição:** frases proibidas por papel, por exemplo `git merge` no prompt de líder somente leitura.

  Começar com os limites atuais (para passar hoje) e apertar a cada item.
- **Teste primeiro:** o próprio arquivo, com os limites de hoje (passam). Os casos de lint que dependem de P6 (ferramentas citadas por papel) e de P9 (ferramentas `browser_*`) entram marcados `todo`, como as asserções de limiar de T2. Assim a WP 0.0 fica verde e o CI pode ser exigido desde a Fase 0.
- **Aceite:** a WP 0.0 passa com os casos de P6 e P9 em `todo`. Depois de P6 e P9, nenhum caso de `test/prompts.test.ts` fica `todo`.
- **Tamanho:** P · **Risco:** baixo · **Depende de:** nenhum.

#### T2 — Não há corpus rotulado de roteamento
- **Problema:** a classificação e a dificuldade não têm uma medida de acerto.
- **Origem:** lacuna (T1, sondagens D e E).
- **Onde:** criar `test/fixtures/routing-corpus.json` e `test/routingCorpus.test.ts`.
- **Mudança:**
  - O corpus tem 40 atividades `{ title, task, kind, difficulty, readOnly }`: as 7 da sondagem D, as 3 da sondagem E com a correção do revisor, e mais 30 reais tiradas do histórico de missões.
  - O teste calcula a acurácia de `classifyTask` e `assessDifficulty`, a precisão de `sure=true` e o número de rebaixamentos indevidos.
  - O teste imprime uma tabela e falha abaixo dos limiares da seção 1.
- **Teste primeiro:** o próprio arquivo, com os limiares de 10/10; hoje essas asserções falhariam. Como T2 entra na Fase 0 (WP 0.0), junto com o CI, as asserções de limiar entram marcadas `todo` (a tabela já é impressa). R1 e R10 as destravam na Fase 2.
- **Aceite:** a acurácia de dificuldade fica ≥ 90%, a precisão de `sure` ≥ 95% e há zero rebaixamentos indevidos.
- **Tamanho:** M · **Risco:** baixo · **Depende de:** nenhum.

#### T3 — Não há suíte de caos
- **Problema:** os cenários de falha das auditorias foram reproduzidos com scripts avulsos e não ficaram no repositório.
- **Origem:** T2 (repros R1 a R7), T1 (sondagens A a I).
- **Onde:** criar `test/chaos.test.ts`, usando `test/r2Fixture.ts` e `test/reviewFixture.ts`.
- **Mudança:** transformar cada repro e cada sondagem num teste que verifica o comportamento **corrigido**:
  - R1 a R7 viram V1, V6, V8, V11, V9, V12 e V14.
  - A a I viram R9, R6, R8, R1, R10, R4, R5, R12 e R3.

  Cada item deste plano usa o seu, mas a suíte junta todos para a re-auditoria.
- **Teste primeiro:** o próprio arquivo, com todos os casos marcados `todo` e destravados conforme cada item fecha.
- **Partes:** o esqueleto com `todo` fica na WP 0.0. A parte final (nenhum `todo`) fica na WP 4.2.
- **Aceite:** 16 casos verdes e nenhum `todo`.
- **Tamanho:** M · **Risco:** baixo · **Depende de:** nenhum · parte final: V1, V6, V8, V11, V9, V12, V14, R9, R6, R8, R1, R10, R4, R5, R12, R3.

#### T4 — O benchmark de ponta a ponta não mede as portas nem o failover
- **Problema:** `src/benchmarks/` (`src/benchmarks/corpus.ts:30`, `src/benchmarks/evaluation.ts:32`, `src/benchmarks/autonomy.ts:20`) mede tarefas, mas não mede conclusão sem `force`, retrabalho por tier ou failover.
- **Origem:** lacuna.
- **Onde:**
  - `src/benchmarks/evaluation.ts:32` (`acceptedRun`).
  - `src/benchmarks/evaluation.ts:49` (`evaluateRuns`).
  - `src/benchmarks/corpus.ts:30`.
- **Mudança:**
  - Acrescentar a `BenchmarkRun` os campos `forced`, `waivedCount`, `failovers`, `stalls`, `reviewRejections`, `leadPromptChars` e `toolCalls`.
  - Criar 3 tarefas novas no corpus: "two helpers touch disjoint files + integrate", "limit hit mid-task (fake CLI)" e "squad bugfix end-to-end".
  - `evaluateRuns` reporta:
    - a taxa de missões prontas sem `force`;
    - a mediana de chamadas de ferramenta do líder;
    - os tokens por missão.
- **Teste primeiro:** em `test/benchmarkEvaluation.test.ts`, uma `run` com `forced=true` não conta como `acceptedRun`, e o relatório tem as colunas novas.
- **Aceite:** o teste passa, e existe uma linha de base gravada em `docs/plans/` antes da Fase 3 (comparação de P10).
- **Partes:** o código e a linha de base ficam na WP 3.0. A rodada final, que compara o prompt novo, fica na WP 4.2.
- **Tamanho:** M · **Risco:** baixo · **Depende de:** nenhum para o código; na linha de base, as tarefas de limite e de squad podem falhar, e isso é o esperado · parte final: P10, P3, R2.

#### T5 — Não há CI
- **Problema:** não existe `.github/workflows`. Os 225 testes e o typecheck dependem de alguém lembrar de rodar.
- **Origem:** lacuna.
- **Onde:** criar `.github/workflows/ci.yml`.
- **Mudança:** criar um job em `macos-latest` e `ubuntu-latest` (Node 24 suportado, respeitando `package.json` `engines >=24.11`; sem fallback para Node 22) que roda `npm ci`, `npm run typecheck` e `npm test`. Exigir o job em PRs para `main`.
- **Teste primeiro:** não se aplica a código. A prova de que o CI bloqueia é um PR descartável, com uma asserção falsa de propósito, que **não entra em `main`**: o CI precisa ficar vermelho nele, e o PR é fechado sem merge.
- **Aceite:** o CI está verde em `main` e vermelho no PR descartável, que é fechado sem merge.
- **Tamanho:** P · **Risco:** baixo. O teste de `browser` pode exigir o Chromium no runner; marcar `skip` sem binário · **Depende de:** nenhum.

---

## 4. Lacunas pedidas e onde estão cobertas

| Lacuna | Itens |
|---|---|
| Detecção de rate limit em tempo de execução, com failover de conta | R2, R3, O3 |
| Watchdog de travamento | O1, O3 |
| Revisão independente que não pode ser anulada | V1, V2, V3 |
| Somente leitura aplicada ao Bash | V4, V5 |
| Isenção de revisão de revisão | P2, P3 |
| Checagem de merge na integração | V7, P1 |
| Consolidar ferramentas (nomes handoff/delivery/result, status sobrepostos) | P11, P12, P13, P14, P6, P20, P21, P22 |
| Simplificar o prompt sem contradições | P10, P4, P5, P16, P17, T1 |
| Calibrar o tier pelo desfecho | R14, O2 |
| Saúde de CLI antes de rotear | R5 |
| Retomada desligada (`resumeOnStart=false`) | V20 |
| ACK dos avisos exigido para concluir a missão | V21 |
| Checkout compartilhado invalida resultados pendentes de outros writers | V22 |

**Contagem:** Roteamento 14 (R1–R14) · Ciclo de vida/verificação 22 (V1–V22) · Prompts e MCP 22 (P1–P22) · Observabilidade 3 (O1–O3) · Testes 5 (T1–T5). Total: 66 itens.

---

## 5. Roteiro em fases

As regras de execução valem para todas as fases:
- Cada WP vira um branch próprio, de preferência num worktree separado (`git worktree add ../orbit-wpX.Y -b wp/X.Y main`).
- Uma fase só começa quando todos os WPs da fase anterior entraram em `main`.
- Os WPs marcados **∥** rodam em paralelo.
- Os marcados **→** esperam o WP citado entrar em `main`, salvo a entrega atômica explicitamente definida para 0.2+0.3. Essa dupla usa uma branch de integração, sem exigir que 0.2 entre sozinho em `main`.
- Dois WPs da mesma fase sem **→** entre eles podem rodar ao mesmo tempo, então seguem a regra de **∥**: arquivos e faixas disjuntos (ver "Regra de pacotes").
- Dentro de um WP, a ordem é a dos IDs listados.
- Cada item vira um commit, com o ID na mensagem (ex.: `V1: veredito changes_required é final`).
- Antes do merge de cada WP: `npm run typecheck` e `npm test -w @orbit/sidecar` verdes, mais o teste novo de cada item.
- A coluna "Arquivos" lista tudo o que o WP toca, testes incluídos. `src/` e `test/` partem de `packages/sidecar/`.

### Fase 0 — Base de medição e correções críticas das portas (segurança)

| WP | Itens | Arquivos (com faixas) | Paralelo |
|---|---|---|---|
| 0.0 Base | T5, T1 (limites atuais), T2 (limiares `todo`), T3 (esqueleto `todo`) | `.github/workflows/ci.yml`, `test/prompts.test.ts`, `test/fixtures/routing-corpus.json`, `test/routingCorpus.test.ts`, `test/chaos.test.ts` | ∥ 0.1, 0.2 |
| 0.1 Portas de verificação | V1, V3, V7, V5, P2 | `src/core.ts:365-385`, `src/core.ts:1868-2006`, `src/store.ts:18`, `src/store.ts:347-386`, `src/store.ts:484-516`, `src/store.ts:666`, `src/git.ts`, `src/prompts.ts:90`, `packages/protocol/src/index.ts:148-175`, `packages/protocol/src/index.ts:469-482`, `packages/protocol/src/index.ts:810-819`, `test/orchestration.test.ts`, `test/finalization.test.ts`, `test/worktrees.test.ts` | ∥ 0.0, 0.2 |
| 0.2 Somente leitura real | V4 | `src/readOnlyGuard.ts` (novo), `src/core.ts:66-72`, `src/core.ts:2320-2340`, `src/core.ts:2511-2567`, `src/command.ts`, `src/adapters/claude.ts`, `test/readOnlyGuard.test.ts`, `test/hooks.test.ts` | ∥ 0.0, 0.1 (desenvolve em paralelo; merge em `main` só junto com 0.3) |
| 0.3 Independência e integração | V2, P1 | `src/core.ts:285-300`, `src/core.ts:1895-1946`, `src/store.ts:18`, `src/store.ts:484-499`, `src/store.ts:666`, `src/git.ts`, `src/mcp.ts:240-260`, `src/prompts.ts:55-60`, `src/prompts.ts:171-184`, `packages/protocol/src/index.ts:318-352`, `packages/protocol/src/index.ts:810-819`, `test/orchestration.test.ts`, `test/worktrees.test.ts` | → depois de 0.1; desenvolver sobre branch de integração contendo 0.2, com entrega atômica 0.2+0.3 em `main` |

**Saída da fase:**
- O repro R1 (V1) está verde em `test/chaos.test.ts`.
- O cenário "líder escreve por Bash e declara pronto" é negado.
- Um líder Codex integra pela ferramenta `integrate`.
- `test/routingCorpus.test.ts` imprime a tabela de acurácia de hoje (limiares ainda `todo`).

### Fase 1 — Confiabilidade do ciclo de vida

| WP | Itens | Arquivos (com faixas) | Paralelo |
|---|---|---|---|
| 1.1 Fingerprint robusto | V6, V8, V22 | `src/verification.ts`, `src/core.ts:1861-1866`, `src/core.ts:2125-2135`, `src/core.ts:2550-2556`, `src/store.ts:388-394`, `packages/protocol/src/index.ts:254-291`, `packages/protocol/src/index.ts:302-306`, `test/verification.test.ts`, `test/sharedCheckout.test.ts` | ∥ 1.2, 1.3 |
| 1.2 Leases e estado | V9, V16, V19 | `src/store.ts:225-278`, `src/store.ts:1088-1137`, `src/store.ts:1178-1183`, `src/scheduler.ts`, `src/core.ts:169`, `src/core.ts:1664-1667`, `src/core.ts:2597-2601`, `src/mcp.ts:52-58`, `src/server.ts`, `packages/protocol/src/index.ts:293-301`, `packages/protocol/src/index.ts:860-959`, `apps/desktop/src/App.tsx`, `apps/desktop/src/components/PaneView.tsx`, `apps/desktop/src/orbit/client.ts`, `test/executionLease.test.ts`, `test/stateVersion.test.ts`, `test/admission.test.ts` | ∥ 1.1, 1.3 |
| 1.3 Entregas e liderança | V10, V11, V12, V13, V15, V20, V21, V17, V18 | `src/core.ts:200-215`, `src/core.ts:842-870`, `src/core.ts:1510-1534`, `src/core.ts:1600-1620`, `src/core.ts:1795-1812`, `src/core.ts:1975-1994`, `src/core.ts:2030-2042`, `src/store.ts:293-330`, `src/store.ts:355-366`, `src/store.ts:871-923`, `src/activityLedger.ts`, `src/mcp.ts:261-263`, `packages/protocol/src/index.ts:148-175`, `packages/protocol/src/index.ts:236-252`, `packages/protocol/src/index.ts:399-409`, `apps/desktop/src/components/MissionView.tsx`, `test/leadership.test.ts`, `test/deliveryQueue.test.ts`, `test/deliveryObligations.test.ts`, `test/restart.test.ts`, `test/activityLedger.test.ts`, `test/finalization.test.ts` | ∥ 1.1, 1.2 |
| 1.4 Watchdog | O1 | `src/watchdog.ts` (novo), `src/panes.ts:14`, `src/panes.ts:280-288`, `src/core.ts:160-215`, `src/mcp.ts:34-48`, `src/store.ts:18`, `src/store.ts:666`, `packages/protocol/src/index.ts:354-397`, `packages/protocol/src/index.ts:810-819`, `test/watchdog.test.ts` | → depois de 1.2 e 1.3 |

**Saída da fase:**
- Os repros R2, R3/R3b, R4, R5 e R6 estão verdes em `test/chaos.test.ts`.
- Um ajudante sem saída por 11 min gera aviso persistido.
- Os testes de V20 (retomada desligada), V21 (ACK para concluir) e V22 (checkout compartilhado) passam.

> Atenção: 1.2 e 1.3 mexem em `src/store.ts`, mas em faixas disjuntas (`:225-278`/`:1088-1183` contra `:293-330`/`:355-366`/`:871-923`). V15 e V20 marcam tentativas com o `failAttempt` que já existe (`src/store.ts:396-404`), sem editá-lo. Fazer merge de 1.2 antes de 1.3 e rebasear.

### Fase 2 — Roteamento

| WP | Itens | Arquivos (com faixas) | Paralelo |
|---|---|---|---|
| 2.1 Política pura do maestro | R3, R4, R8, R9, R10, R6 (parte pura), R1 (parte pura), R13 (parte pura) | `src/maestro.ts`, `src/claudeUsage.ts`, `src/accountLimits.ts`, `packages/protocol/src/index.ts:451-462`, `packages/protocol/src/index.ts:661-662`, `test/balance.test.ts`, `test/complexity.test.ts`, `test/routing.test.ts`, `test/claudeUsage.test.ts`, `test/admission.test.ts` | ∥ 2.3, 2.5 |
| 2.3 Instalação e contas | R5 (instalação), R12 | `src/accounts.ts`, `src/clis.ts`, `src/core.ts:13`, `src/core.ts:1153-1200`, `src/core.ts:2755-2761`, `apps/desktop/src/components/dialogs.tsx:82`, `test/accounts.test.ts`, `test/cliInstall.test.ts` | ∥ 2.1, 2.5 |
| 2.2 Fiação do spawn | R11, R1 (parte core), R5 (parte core), R6 (parte core), R7, R13 (parte core) | `src/core.ts:384-391`, `src/core.ts:1153-1160`, `src/core.ts:1675-1730`, `src/core.ts:2412-2482`, `src/decider.ts`, `src/command.ts`, `test/adaptive.test.ts`, `test/command.test.ts`, `test/balance.test.ts`, `test/cliInstall.test.ts` | → depois de 2.1 e 2.3; ∥ 2.5 |
| 2.4 Failover em tempo de execução | R2, O3 | `src/limitWatch.ts` (novo), `src/usage.ts`, `packages/sidecar/hooks/statusline.mjs`, `src/core.ts:200-215`, `src/core.ts:1517-1534`, `src/core.ts:1795-1812`, `src/core.ts:2150-2230`, `src/store.ts:18`, `src/store.ts:293-330`, `src/store.ts:666`, `packages/protocol/src/index.ts:399-409`, `packages/protocol/src/index.ts:810-819`, `test/limitWatch.test.ts`, `test/failover.test.ts`, `test/deliveryQueue.test.ts` | → depois de 2.2; ∥ 2.5 |
| 2.5 Desfecho por tier | R14 | `src/store.ts:388-394`, `src/store.ts:484-516`, `src/report.ts`, `packages/sidecar/hooks/report.mjs`, `apps/desktop/src/components/UsagePanel.tsx`, `packages/protocol/src/index.ts:254-275`, `test/report.test.ts` | ∥ 2.1, 2.2, 2.3, 2.4 |

**Saída da fase:**
- T2 passa nos limiares de 10/10, sem `todo`.
- As sondagens A–I de T3 estão verdes.
- O failover E2E com CLI falsa passa.

### Fase 3 — Ergonomia: prompts e superfície MCP

| WP | Itens | Arquivos (com faixas) | Paralelo |
|---|---|---|---|
| 3.0 Linha de base do benchmark | T4 | `src/benchmarks/corpus.ts`, `src/benchmarks/evaluation.ts`, `src/benchmarks/autonomy.ts`, `test/benchmarkEvaluation.test.ts`, `docs/plans/` (linha de base gravada) | → antes de 3.1 |
| 3.1 Superfície MCP | P7, P8, P12, P13, P11, P6, P20, P21, V14, P22, P17, P14 | `src/mcp.ts`, `src/prompts.ts:41`, `src/prompts.ts:122`, `src/core.ts:821`, `src/core.ts:1536-1560`, `src/core.ts:1814-1819`, `src/core.ts:1975-2019`, `src/core.ts:2085-2140`, `src/store.ts:342-345`, `src/store.ts:871-882`, `test/mcp.test.ts`, `test/submission.test.ts`, `test/prompts.test.ts`, `test/delivery.test.ts`, `test/missionProgress.test.ts`, `test/finalization.test.ts` | → depois de 3.0 |
| 3.2 Prompts | P4, P5, P9, P16, P19, P3 (texto do playbook) | `src/prompts.ts`, `src/squads.ts`, `src/mcp.ts:415-476`, `test/prompts.test.ts`, `test/squads.test.ts` | → depois de 3.1; ∥ 3.4 |
| 3.4 Briefing | P18 | `src/core.ts:765-830`, `src/contextPack.ts`, `test/contextIntegration.test.ts` | → depois de 3.1; ∥ 3.2 |
| 3.3 Prompt do líder e idioma | P10, P15 | `src/prompts.ts`, `src/messages.ts` (novo), `src/mcp.ts`, `src/core.ts` (strings), `src/routing.ts:52-59`, `src/squads.ts:20-70`, `test/prompts.test.ts`, `test/mcp.test.ts` | → depois de 3.2 e 3.4 |

Por que 3.1 e 3.2 não rodam mais juntos: P8 e P14 mudam `src/prompts.ts:41` e `:122`, que P5 reescreve (`:105-125`); P6 e P14 põem o lint em `test/prompts.test.ts`, que 3.2 também usa; e P9 exporta a lista `browser_*` de `src/mcp.ts`. 3.4 também espera 3.1 porque P14 renomeia `handoff_list` no texto do briefing (`src/core.ts:821`).

**Saída da fase:**
- Os orçamentos de T1 estão apertados para os valores de 10/10.
- O líder tem ≤ 34 ferramentas, com ou sem git (teste de P22).
- Os 3 squads chegam a `ready` sem `force`.
- Com o prompt novo, T4 não piora a taxa sem `force` nem a mediana de chamadas.

### Fase 4 — Observabilidade e re-auditoria

| WP | Itens | Arquivos (com faixas) | Paralelo |
|---|---|---|---|
| 4.1 Painel de saúde | O2 | `src/report.ts`, `src/measurements.ts`, `src/core.ts:1205-1215`, `packages/sidecar/hooks/report.mjs`, `apps/desktop/src/components/UsagePanel.tsx`, `apps/desktop/src/components/MissionView.tsx`, `test/report.test.ts` | ∥ 4.2 |
| 4.2 Benchmarks finais | T4 (parte final: rodar), T3 (parte final: sem `todo`) | `test/chaos.test.ts`, `docs/plans/` (relatório) | ∥ 4.1 |
| 4.3 Re-auditoria | seção 6 (sem item novo) | nenhum arquivo: três auditorias somente leitura, uma por fatia | → depois de 4.1 e 4.2 |

### Verificação mecânica do roteiro

As tabelas acima e as linhas **Depende de** foram conferidas por um script que:
- confere que cada um dos 66 itens aparece em pelo menos um WP;
- para cada item (ou parte), confere que toda dependência fica numa fase anterior, ou na mesma fase num WP que vem antes por **→**, ou antes no mesmo WP;
- para cada par de WPs da mesma fase que podem rodar ao mesmo tempo, confere que não há arquivo nem faixa de linhas em comum.

Resultado na revisão desta versão: 0 violações de ordem e 0 sobreposições.

---

## 6. Como medir o progresso

### 6.1 Testes e benchmarks a acompanhar

| Medida | Comando | Hoje | Meta 10/10 |
|---|---|---|---|
| Suíte completa | `npm test -w @orbit/sidecar` | 225/225 | 100% verde, com ≥ 66 testes novos (um por item no mínimo) |
| Typecheck | `npm run typecheck` | ok | ok |
| Acurácia de dificuldade (T2) | `node --test test/routingCorpus.test.ts` | não medida (7/7 da sondagem D erram) | ≥ 90%, zero rebaixamentos indevidos |
| Precisão de `sure=true` (T2) | idem | não medida | ≥ 95% |
| Prompt do líder agêntico (T1) | `node --test test/prompts.test.ts` | 10.873 caracteres | ≤ 6.000 |
| Esquemas MCP do líder (T1) | idem | 27.346 caracteres / 40 ferramentas (41 com git) | ≤ 20.000 / ≤ 34 com ou sem git (conta em 2.3) |
| Prompt do ajudante construtor (T1) | idem | 3.448–3.883 caracteres | ≤ 2.800 |
| Lint de ferramentas por papel (T1) | idem | 2 casos sem registro (P6, P9) | passa |
| Caos (T3) | `node --test test/chaos.test.ts` | 0/16 | 16/16 |
| Missões prontas sem `force` (T4) | benchmark `src/benchmarks/` | linha de base em 3.0 | ≥ linha de base, e 100% nos 3 squads |
| Tempo até detectar limite (R2) | `node --test test/failover.test.ts` | infinito | ≤ 60 s |
| Tempo até avisar de travamento (O1) | `node --test test/watchdog.test.ts` | infinito | ≤ limiar + 30 s |

### 6.2 Checklist de re-auditoria

Rodar as três auditorias de novo com as mesmas perguntas dos relatórios T1, T2 e T3, por agentes somente leitura, mais um revisor independente cada. Para cada linha, a evidência é o comando ou o teste citado. A nota é 10 só se todas as linhas da fatia estiverem marcadas.

**Roteamento**
- [ ] As 9 sondagens A–I de T1 reexecutadas em `test/chaos.test.ts`, todas com o comportamento corrigido.
- [ ] T2: acurácia de dificuldade ≥ 90%, precisão de `sure` ≥ 95%, zero rebaixamentos indevidos.
- [ ] Com `codex` removido do PATH, 20 spawns variados não abrem painel Codex (R5).
- [ ] Uma API paga só é escolhida com todas as assinaturas acima de 85% (R3, R6).
- [ ] Failover E2E: limite simulado na conta A gera a tentativa nova na conta B em ≤ 60 s, com aviso persistido (R2).
- [ ] `rg pickAccount packages` vazio (R12).
- [ ] O relatório de desfecho por tier existe e tem dados de pelo menos uma missão real (R14).

**Ciclo de vida e verificação**
- [ ] R1–R7 de T2 em `test/chaos.test.ts`, todos corrigidos.
- [ ] `test/readOnlyGuard.test.ts`: 12 escritas negadas, 12 leituras permitidas, e o cenário "líder escreve por Bash" negado (V4).
- [ ] Um `accepted` depois de `changes_required` é recusado, e o líder não revisa sozinho com `reviewPolicy='independent'` (V1, V2).
- [ ] A revisão de integração é recusada com branch aceito e não mesclado ou worktree sujo (V7).
- [ ] Coverage do revisor, um arquivo de 33 MiB e um repositório aninhado não impedem `done` nem a revisão (V6, V8).
- [ ] Um PID reutilizado, um lease sem PID e uma missão apagada não deixam writer bloqueado (V9).
- [ ] Todo aviso crítico tem `deliveryId`, sobrevive a reinício e aceita ACK (O3).
- [ ] Com `resumeOnStart` desligado, as tentativas que estavam rodando ficam `stopped` e o líder recebe a lista (V20).
- [ ] `mission_ready` é recusado enquanto houver aviso de resultado sem `delivery_ack` (V21).
- [ ] Num checkout compartilhado, um writer seguinte fora dos caminhos tocados não invalida um resultado pendente (V22).
- [ ] Um travamento simulado gera exatamente 1 aviso (O1).

**Prompts e MCP**
- [ ] `test/prompts.test.ts` verde com os orçamentos de 10/10.
- [ ] O lint de ferramentas por papel não acusa nenhuma referência órfã (P6, P9).
- [ ] Existe um caminho de conclusão só, descrito em um parágrafo só (P10, P11).
- [ ] Ferramentas do líder ≤ 34, com e sem git, sem contar os aliases de uma versão. Não aparecem `handoff_` nem `delivery_` em texto voltado a agente, fora os aliases (P1, P6, P11–P14, P20–P22).
- [ ] Com `english=true`, nenhuma resposta de ferramenta tem marcadores de português (P15).
- [ ] Os 3 squads embutidos chegam a `ready` sem `force` (P3).
- [ ] Um líder Codex somente leitura integra pela ferramenta `integrate` (P1).
- [ ] O benchmark T4 com o prompt novo tem taxa sem `force` maior ou igual à linha de base.

**Transversal**
- [ ] O CI está verde em `main` e bloqueia PRs vermelhos (T5).
- [ ] O painel de saúde mostra agentes, failovers, travamentos e leases (O2).


## 7. Harness adaptativo baseado em evidências — revisão de 16/10/2026

A trilha H é detalhada em [Harness adaptativo](plans/2026-10-16-orbit-adaptive-harness.md). Ela acrescenta seleção conjunta de modelo/esforço/estratégia, composição de módulos por contrato da tarefa, benchmark versionado, aprendizado por resultados verificados e explicação da decisão. Não substitui os gates V/R por uma pontuação de modelo.

A tabela de tipos permanece como restrição humana e fallback quando faltam dados, sem afirmar que seus presets são ótimos. Permissões, orçamento, aceitação independente e admissão de writers são invariantes fora da otimização. A métrica de sucesso é qualidade verificada por unidade de tempo/consumo; nenhuma economia é presumida por redução de caracteres.

A trilha exige também um gate de inicialização do motor: a UI deve receber handshake antes de retomadas lentas, e I/O síncrono não pode bloquear watchdog, status nem consulta de limites. A demora observada no app instalado continua uma pendência até ser reproduzida e corrigida com teste.
