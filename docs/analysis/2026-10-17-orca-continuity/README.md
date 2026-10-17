# Orca → Orbit: contexto e execução confiável

Data: 2026-10-17. Orbit baseline: PR55, `7602e7675af54099e5706550187b2da335b5d31f`, release 0.2.24. Orca analisado: [`09f12fa6dcbc910fea9113c3adf0617b0efe3e35`](https://github.com/stablyai/orca/tree/09f12fa6dcbc910fea9113c3adf0617b0efe3e35), obtido do HEAD remoto nesta etapa. Os hashes de arquivos estão em [orca-sources.json](orca-sources.json).

Esta é uma entrega delimitada de continuidade, seleção de instruções e idempotência. Não é uma reescrita do harness, nem evidência de que Orca ou Orbit produz respostas melhores em geral.

## Realidade e coordenação

- Pane178 concluiu e confirmou a remoção das nove worktrees com backups preservados, checkout oficial limpo em main7602e767 e Orbit.app 0.2.24 rodando.
- O trabalho usa uma branch nova baseada em origin/main, exclusivamente no checkout oficial. A instrução atual do usuário para não criar worktree/pasta irmã prevaleceu sobre `agent:begin`, que obrigatoriamente cria uma pasta irmã. As reservas foram registradas no mesmo registro Git compartilhado, após `agent:status` vazio, sem desativar hooks. `agent:setup`, npm ci e o restante do fluxo de validação/publicação foram mantidos.
- Conta1 recebida como instrução desta etapa. Não houve troca de conta/provedor deste agente nem chamadas pagas de inferência para pesquisa/benchmark/testes. Os agentes das jornadas são processos locais determinísticos.
- A cópia do código Orca e o snapshot de baseline estão em `/tmp`, somente para análise e comparação, sem worktree Git ou edição das árvores removidas. Nenhum build concorrente foi iniciado.

## Mapa dos fluxos e testes

Os caminhos Orca abaixo são relativos ao commit fixado; os caminhos Orbit referem-se ao código desta entrega. Ler testes upstream não equivale a executá-los. A suíte completa do Orca não foi instalada/executada.

| Fluxo | Orca: código/testes lidos | Orbit: fluxo completo e resultado |
| --- | --- | --- |
| Prompt e instruções | `src/main/runtime/orchestration/preamble.ts`, `preamble.test.ts`; `worker/deliver-worker-dispatch-preamble.ts` e `worker-start-prompt-budget.ts` sob `src/main/runtime/rpc/methods/orchestration/` | MCP/UI → `core.openHelper`/`changeLead` → `spawn` → `prompts.ts` + `buildContextPack` → `agentFiles.ts` → `command.ts` → PTY. Corrigida duplicação direta de instruções/memória ao trocar líder. Objetivo, decisões, critérios, pendências e referências continuam disponíveis. O tool de recuperação conserva o briefing completo. Testes: `taskContinuity`, `promptBudget`, `contextIntegration`. |
| Skills e ferramentas por tarefa | `src/main/skills/agent-skill-selection.ts` e testes; preâmbulo só anuncia subdispatch quando permitido | `scanCatalog` → `missionSkills` (CLI, projeto, disabled, whitelist) → seleção explícita/design → entrega inline íntegra ou `skill_load` por hash. Adaptado seletor MIT de ID exato, alias não ambíguo e deduplicação. Skill explícita ausente/alterada recusa abertura, antes de processo/worktree; automática ausente permanece diagnosticada. Metadados selecionados aparecem antes do restante, sem esconder recursos elegíveis. Perfil externo Orbit continua configurável; não foram retiradas ferramentas nativas essenciais. Testes: `skillSelection`, `taskContinuity`, `skillPackages`, `designSkills`, `toolProfile`. |
| Histórico, contexto e compactação | `src/main/codex/codex-structured-journal-compactions.ts` e testes; evento item substitui fallback legado sem duplicar marcador | Orbit conserva histórico na sessão nativa, `missionBriefing`/ContextLibrary para recuperação; não implementa uma segunda compactação por LLM. Causa encontrada: `setPaneSpec(task:null)` descartava atribuição para reabertura nova. Agora atribuição original é persistida; resume sem mensagem envia zero bytes de tarefa; mensagens de retomada não sobrescrevem a atribuição. Testes: `taskContinuity`, `leadership`, `restart`, `contextPack`. Não foi copiado o journal estruturado do Orca para PTYs. |
| Resultados estruturados/handoffs | Preamble vincula taskId + dispatchId ao resultado; `dispatch-task-source.ts`; `worker-start-prompt-contract.test.ts` preserva settlement antecipado | `handoff` → `commitActivityResult` transacional → resultado retido, notice persistido, ACK por epoch → inspeção/verification independente → readiness. Já existiam digest, critérios e evidência bounded; não foram substituídos por texto livre nem aceitação automática. Testes: `activityLedger`, `delivery`, `orchestration`, `verification`, `taskContinuity`. |
| Dispatch, fila, estados, retries/idempotência | `db/mutation-receipts/mutation-receipt-store.ts` recusa mesmo requestId com payload diferente; `structured-agent-session-task-queue.ts`; `worker-start-prompt-contract.test.ts` distingue input aceito e início desconhecido | `spawnHelper` → chave/lock → reserva persistida → classificação/admissão → spawn → resultado. Causa encontrada: lock aceitava qualquer payload para mesma chave e contrato não incluía tarefa/modelo/esforço/dificuldade. Novo requestHash persistido protege replay concorrente e após restart; retry explícito de payload novo incrementa revisão. Verifica replay antes de fechar agente anterior. Processos de tarefas idênticas não duplicam. Tentativas antigas sem hash são diagnosticadas, não presumidas equivalentes. Testes: `taskContinuity`, `adaptive`, `activityLedger`, `admission`. |
| Modelo, effort e catálogo/capacidades | `src/shared/agent-launch-model-preferences.ts`; `worker/worker-launch-preferences.ts` e testes distinguem solicitado/efetivo e recusam overrides não aplicáveis | MCP `kind`/escolha explícita → classificação → taskPolicy/harness/catálogo/quota por conta → adapter/command → recibo solicitado/resolvido/aplicado/observado. Mantidas escolhas explícitas e validação de efforts/capacidades. Mudança de escolha não pode reutilizar recibo de outro pedido. Classificação auxiliar Claude agora respeita allowedClis: missão só Codex não tenta Haiku. Não há novo vencedor automático de modelo nem alegação de melhor qualidade. Testes: `taskContinuity`, `routing`, `maestro`, `admission`, `benchmarkHarnessMatrix`; jornada verifica modelo/effort/recibo. |
| Uso/custo/budgets | `src/main/codex-usage/codex-usage-record-parser.ts`; `claude-usage/transcript-record-parser.ts`; `usage/agent-token-usage.ts`; `worker-start-budgets.ts` | Rollout/transcript → readers com identidade/cursor → `sessionAccounting`/watermark → store/ledger → missão/budget/relatório. Cache Codex incluído em input; Claude separado: contabilização já trata os provedores distintamente. Contagens ausentes/custo desconhecido não viram economia. Auxiliares já são contabilizados mesmo quando falham. Budgets de worker-start do Orca são deadlines de transporte, não prova de budget monetário. Mantido comportamento atual, além de evitar classificador proibido. Testes: `usageCounters`, `usage`, `sessionAccounting`, `benchmarkAccounting`, `benchmarkEvaluation`, `budget`. |

## Implementado e reutilizado

1. Identidade completa e persistida de pedidos de ajudantes, com conflito explícito antes de reuso/fechamento. Título continua cosmético; task normaliza apenas bordas/CRLF, não resume conteúdo. Alterações de tarefa, modelo, esforço, dificuldade, critérios, dependências ou restrições não são tratadas como mesmo replay.
2. Continuidade da atribuição original ainda pendente e identificada em conversa nova, e retomada nativa sem repetir a tarefa. O texto original fica no mesmo estado privado que já mantém objetivos, especificações e histórico; não vai para telemetria.
3. Troca de líder instala instruções e memória uma vez; recuperação após compactação mantém o briefing independente completo.
4. Seleção exata de skills explícitas com recusa de ambiguidades/ausências; entrega deduplicada por ID e pacote íntegro. Corpo grande preservado, com id+hash para leitura integral. Lista `missing` não é mais mutada durante entrega.
5. Paginação de skills com selecionadas primeiro, cursor revisado pela ordem de IDs/hashes; conteúdo restante continua acessível. Texto servido continua diferente de cumprimento comprovado.
6. Classificação auxiliar só usa Claude se a missão permitir Claude; recibo explica uso das regras quando essa chamada é evitada. Quando habilitada e permitida, falha do classificador continua visível no recibo e no ledger auxiliar.

Código adaptado: somente `skillSelection.ts`, a partir de Orca MIT (Lovecast Inc.), com aliases namespaced e tipos/erros próprios do Orbit. A lógica de receipts inspirou a correção do código existente; SQLite, Electron, filas, preâmbulos e bibliotecas Orca não foram copiados. Nenhuma dependência adicionada; package-lock inalterado. A licença integral e atribuição estão em `THIRD_PARTY_NOTICES.md`.

## Comparação reproduzível e limites

[before.json](before.json) e [after.json](after.json) são observações do core real com PTY local e CLI substituta. A fixture tem 4.114 bytes de instruções obrigatórias e 40 skills pessoais sintéticas elegíveis. Não chama modelos nem tokenizer; `tokens` e `costUsd` são null. Não mede latência/qualidade da inferência nem cache nativo.

| Medida da fixture | PR55 | Esta entrega |
| --- | ---: | ---: |
| Cópias diretas das instruções no lançamento do novo líder | 2 | 1 |
| Prompt UTF-8 da troca de líder | 11.989 bytes | 7.851 bytes |
| Páginas de metadados até skill selecionada | 3 | 1 |
| Metadados UTF-8 recebidos até essa skill | 21.874 bytes | 7.295 bytes |
| Bytes de tarefa no resume sem mensagem | 0 | 0 |
| Atribuição original preservada em conversa nova | não | sim |
| Pedido alterado recusado sob mesmo activityId | não | sim |
| Comandos auxiliares Claude tentados em missão só Codex | 1 | 0 |
| Chamadas reais de inferência | 0 | 0 |

A redução de 4.138 bytes nessa troca de líder e de 14.579 bytes nessa busca de skill não é uma economia medida de tokens. O custo real depende do agente, tokenização, histórico e cache. A persistência da tarefa é aumento deliberado de contexto em uma conversa nova: evita começar sem atribuição, não busca diminuir conteúdo a qualquer custo.

Reprodução no checkout oficial, sem criar worktrees:

```sh
npm ci
node scripts/compare-task-continuity.mjs > /tmp/orbit-continuity-after.json
mkdir -p /tmp/orbit-continuity-baseline-7602e76
git archive 7602e767 packages/sidecar packages/protocol | tar -x -C /tmp/orbit-continuity-baseline-7602e76
ln -s "$PWD/node_modules" /tmp/orbit-continuity-baseline-7602e76/node_modules
node scripts/compare-task-continuity.mjs /tmp/orbit-continuity-baseline-7602e76 > /tmp/orbit-continuity-before.json
node --test packages/sidecar/test/taskContinuity.test.ts packages/sidecar/test/skillSelection.test.ts
npm run typecheck
npm test
node --test scripts/*.test.mjs
```

A symlink de node_modules é para resolver as mesmas dependências já instaladas; nenhum pacote do Orca é necessário. A comparação usa runtime do protocolo sem alteração funcional; as mudanças de protocolo são apenas campos TypeScript opcionais. Se o diretório temporário já existir, reutilize a extração e não recrie o symlink.

## Jornadas de interface

`serve-journey.mjs` e `verify-journey.mjs` reutilizam a bancada determinística do PR55 em diretório de dados/portas próprios (`.research/continuity-journey`, 5489/5490). Sidecar, WebSocket, journal, roteamento e PTYs são reais; respostas/inferência do provedor são substitutas. Prévia aberta no browser do Overclock exclusivamente por MCP.

- Chromium e WebKit: 42 verificações cada, sem erros de runtime. Evidências em `journey-*.json`/`.log`.
- Fluxos: missão sem objetivo, escrever ao líder, submit repetido com um único envio, recibo do destinatário/epoch, abrir ajudante com modelo e esforço explícitos, preservação de rascunhos/foco ao mudar ajudante/missão, terminal mantido, recibo sem identidade observada inventada, conversa e reload.
- 375, 768, 900, 1024 e 1440 px: sem overflow horizontal, enviar visível, terminal utilizável; screenshots de 375/900/1440 e recibos. Nenhum novo layout foi criado nesta entrega. Checklist oc-showcase aplicado ao fluxo existente; não se afirma auditoria completa de acessibilidade/light mode a partir dessas jornadas.
- Não foram enviadas tarefas de inferência ao usuário nem alteradas suas missões para produzir esses resultados. A confirmação do bundle/runtime instalado é feita separadamente após a publicação.

## Não coberto / próximos limites reais

- Não foi feita comparação cega de qualidade de respostas, medição pareada de tokens/custos reais ou certificação do melhor modelo por categoria. O harness existente exige evidência live comparável para promoção; esta fixture offline não serve para isso.
- Catálogos/efforts e preferências por conta continuam os do Orbit/CLI; não foi importado o catálogo grande de provedores do Orca. Modelos customizados e suporte efetivo variam por adapter/CLI.
- Orbit não ganhou chat estruturado, runtime remoto/federado, instalação/cloud de skills, journal de compaction ou SQLite do Orca. Transplantar esses sistemas para PTYs seria outra entrega.
- Continuidade de atribuição passa a valer para novos specs persistidos. Specs antigos que já apagaram a tarefa não podem recuperar texto que não existe mais no estado; a sessão nativa continua sendo a via segura. Tentativas antigas sem requestHash mantêm resultados e histórico, mas uma suposta repetição exige conferência/retomada ou retry com motivo explícito.
- Orbit controla seus tools de recursos; a visibilidade/obediência a skills nativas e o início efetivo de turnos de todos os provedores não são garantidos por PTY ACK. O bypass padrão existente não foi alterado; execuções explicitamente read-only continuam read-only.
- Não foram validados todos os 14 mil commits/37 mil arquivos do Orca, todos os providers, nem todos os cenários de crash. O mapa fixa exatamente as fronteiras lidas e testes executados no Orbit.

## Validação local desta revisão

- `npm ci`: exit 0, 0 vulnerabilidades reportadas, lockfile sem mudança.
- `npm run typecheck`: exit 0 (todos os workspaces).
- `ORBIT_BROWSER=<Chromium headless local> npm test`: exit 0, sidecar 324/324 e desktop 39/39.
- `node --test scripts/*.test.mjs`: exit 0, 6/6.
- Chromium/WebKit: 42/42 cada; zero pageerrors.
- `git diff --check`: exit 0.

O browser integrado da suíte local ficou preso no lançamento de Brave em uma repetição; somente os processos daquela execução de teste foram encerrados. A suíte completa passou usando `ORBIT_BROWSER` apontado explicitamente ao Chromium headless já instalado, incluindo o teste do browser. Isso não foi tratado como bug corrigido no Brave nem como teste dispensado. CI usa sua própria disponibilidade de browser.

Logs de validação local ficam neste diretório. Publicação e verificação da instalação/runtime são posteriores ao commit revisado; o recibo final aponta para o run/release e para o relatório privado local em `.research/orca-continuity-installation/`, para não introduzir dados do usuário no Git.

## Revisão final: fronteira de restauração

Na revisão posterior ao PR56, dois testes adicionais reproduziram um limite da nova restauração: uma conversa nova poderia reenviar atribuição já concluída/substituída, ou um líder poderia receber o objetivo antigo salvo. A correção restringe a restauração de ajudantes à tentativa original identificada por requestHash e ainda pendente. Atribuições concluídas ou posteriores feitas por agent_send não recuperam o texto original como tarefa corrente; a conversa nativa deve ser retomada para conservar seus deltas. Líderes em conversa nova recebem o briefing atual, com objetivo e estado presentes, sem duplicar as instruções instaladas no papel.

Os 11 testes de `taskContinuity.test.ts` passaram após a correção (antes, os dois novos casos falharam). Essa revisão não muda a fixture pareada de bytes/paginação, que trata atribuição original pendente e troca de líder. Não se afirma reconstrução integral de uma atribuição substituída a partir apenas do spec original.
