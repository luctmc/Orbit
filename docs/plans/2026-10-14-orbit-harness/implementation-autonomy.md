# Validação autônoma real — 15/10/2026

**Dois defeitos reais do harness foram corrigidos. O fluxo Codex líder → Claude implementação → Codex revisão chegou ao aceite final. A recuperação de uma entrega interrompida foi observada com confirmação do agente e identidades preservadas. O gate bidirecional dentro do orçamento continua pendente.** Não houve instalação, publicação, commit ou push.

## Mudanças verificadas

**Permissões do worker Codex.** A primeira missão inversa encerrou o worker antes de criar sua conversa: o CLI rejeitou `--add-dir` com permissões efetivas de somente leitura. O core reconhecia a atividade como gravável, mas só explicitava sandbox para leitura. Agora o comando usa `workspace-write` para atividades graváveis e `read-only` para líder agêntico/revisor. As raízes extras continuam ausentes no comando read-only. Não há `danger-full-access`, bypass de aprovação ou edição da configuração global. O teste cobre lançamento, comando, política registrada e reinício. [Regressão vermelha](execution-autonomy/validation/codex-permissions-red.log); implementação em `command.ts` e `core.ts`.

**Envio durante startup.** Depois do SIGKILL, o resultado estava salvo, mas o aviso foi colado antes de o Claude retomado estar pronto: ficou no compositor, com recibo `pty_accepted`, sem ACK. O outbox agora conserva o aviso enquanto o destino inicia ou pede permissão. Para um CLI nativo, exige atividade de terminal, estado diferente de startup/permissão e 1,2 s sem saída antes de tentar enviar. Shells mantêm o caminho existente. A confirmação explícita do agente permanece obrigatória e separada do aceite do código. [Vermelho](execution-autonomy/validation/delivery-startup-red.log), [verde e regressões de outbox](execution-autonomy/validation/delivery-startup-green.log).

Esse intervalo é uma **heurística de transporte**, não um sinal universal dos providers. Saída contínua pode adiar um aviso; sucesso do write não comprova leitura pelo modelo. A evidência nativa desta rodada cobre as versões e o cenário descritos abaixo.

**Supervisor de validação.** `verify-autonomous-harness.mjs` abre somente missão e líder. Os agentes reais criam cartões, delegam, entregam, verificam e declaram conclusão pelos tools do Orbit. O supervisor não chama `spawnHelper`, `handoff`, `verifyResult` ou `missionReady` para produzir aprovação. Confere o corpus protegido por fora e conserva falhas, manifests, snapshots de fonte, sessões e consumo. Sem `--live`, apenas mostra ajuda. Uma retomada diagnosticada exige diretório novo de evidência e preserva limite acumulado de aberturas e uso da missão anterior.

O runner também aguarda o diálogo de confiança da pasta temporária ficar estável. O envio imediato da primeira tentativa foi ineficaz; a mesma sequência funcionou em reprodução local após esperar o diálogo. Isso é consistente com uma corrida de inicialização do listener, sem afirmar uma causa interna comprovada do CLI. A confirmação se limita à pasta criada pelo piloto, sem aceitar permissões genéricas.

## Execuções e resultado

Runtime: Node empacotado **24.21.0**, Claude Code **2.1.296**, Codex CLI **0.162.1**. Pins: `claude-haiku-5-5` e `gpt-6-luna`, esforço baixo, sem fallback de modelo. Duas tarefas pequenas em repositórios temporários: `bug-mean` e `bug-pagination`. Limite por missão: 1.500.000 tokens e US$ 0,15 de custo conhecido Claude, seis minutos por fase, quatro aberturas normais ou sete acumuladas com recuperação.

| Observação | Resultado | Tokens observados | USD Claude conhecido |
|---|---|---:|---:|
| `forward-1` | Líder delegou; worker ficou no diálogo de trust; tentativa encerrada e preservada | 206.236 | não informado |
| `forward-2` | Duas atividades e duas entregas aceitas, revisão cruzada, integração atual e missão pronta; excesso de orçamento | 1.560.340 | 0,013544 |
| `reverse-1` | Worker Codex encerrou por incompatibilidade de permissões; sem resultado | 607.275 | 0,014789 |
| `reverse-2` + `reverse-recovery-1` | SIGKILL real, retomada após reparo, ACK e revisão cruzada da implementação; orçamento interrompeu antes do aceite final do líder | 1.671.514 | 0,030580 |

Total desta rodada, **incluindo falhas**: **4.045.365 tokens observados** e **US$ 0,058913 de subtotal conhecido Claude**. Custo completo permanece `null`: Codex não informou USD e relatórios ausentes não são convertidos em zero. Valores monetários são estimativas dos CLIs, não uma fatura. Retomada e execução original inversa compartilham contabilidade cumulativa: seus totais não são somados duas vezes. [Agregado verificável](execution-autonomy/observations.json).

No fluxo normal, o Claude reproduziu `NaN !== 0`, corrigiu somente `src/stats.mjs` e executou o check protegido. O Codex revisou o resultado exato e executou o check independentemente em sandbox read-only. O líder identificou os checks como relatos dos helpers, auditou a revisão e registrou integração atual sem alegar ter executado comandos que não rodou. Uma auditoria após o encerramento repetiu o oracle e conferiu o fingerprint: [post-run-audit.json](execution-autonomy/forward-2/post-run-audit.json).

O primeiro runner marcou esse caso como `passed` pelos gates funcionais antes de incorporar corretamente o estado final do orçamento. **Esse rótulo amplo é superado pela auditoria anexada: funcional aprovado, piloto limitado reprovado.** O relatório original não foi reescrito. O runner final verifica source e orçamento após o encerramento dos processos.

## Interrupção e recuperação observadas

O processo filho recebeu SIGKILL imediatamente depois de retornar o commit conjunto de resultado/outbox, antes do dispatch. O pai confirmou que os PIDs antigos tinham encerrado antes de abrir o mesmo dataDir. Não limpou leases nem fabricou um resultado. A primeira retomada revelou o envio prematuro descrito acima e foi preservada como falha.

Após o teste vermelho/verde do reparo, a mesma missão foi retomada em novas evidências, conservando as sete aberturas acumuladas. O líder leu e confirmou o recibo, abriu revisão Claude e recebeu uma entrega de revisão. O ledger final contém duas atividades, duas tentativas e dois resultados `done`; a implementação não foi repetida. A implementação foi aceita pelo revisor da CLI oposta. O orçamento impediu a auditoria final do líder sobre a revisão e a integração: **não há missão inversa pronta**.

- Resultado original preservado: `5c98abd4-d1d9-4f81-8d05-ec54200410a3`.
- Tentativa original preservada: `a5103b1a-6d70-4348-abda-4d3e9ad6e880`.
- Mesmo recibo confirmado pelo líder: `0fa3c121-3311-46d1-967f-9671eaeee328`.
- Conversas Claude e Codex conservaram seus IDs; os epochs mudaram entre processos.
- Reaplicar os reports observados no checkpoint adicionou zero tokens e não alterou o subtotal conhecido. O USD Codex continuou desconhecido.

[Checkpoint antes do dispatch](execution-autonomy/reverse-2/checkpoint.json), [retomada que falhou](execution-autonomy/reverse-2/recovered.json), [resultado após o reparo](execution-autonomy/reverse-recovery-1/recovered.json). Isso prova essa recuperação após diagnóstico e reparo; não transforma a primeira tentativa em sucesso nem certifica todas as interrupções possíveis.

## Orçamento e eficiência: pendências concretas

O total final passou do limite em **60.340 tokens (4,02%)** no fluxo normal e **171.514 (11,43%)** na missão inversa. Os reports são assíncronos e incluem trabalho já em voo quando o limite é observado. A interrupção ocorreu sem elevar o orçamento. O limite atual não é uma reserva preventiva nem um teto físico exato de consumo do provider.

Ambos os líderes carregaram contextos nativos grandes e fizeram várias chamadas de coordenação para correções de uma linha. Por exemplo, o revisor Claude recebeu 6.053 bytes iniciais do Orbit e consumiu 469.290 tokens observados ao longo de suas chamadas; são unidades distintas, sem converter bytes em tokens. Não é possível atribuir todo o restante a uma única causa com esta amostra. O próximo experimento deve separar catálogo/contexto nativo, schemas MCP, instruções e consultas repetidas, com perfis comparáveis e sem retirar gates.

**Não houve A/B de economia nesta rodada.** Redução drástica de tokens, desempenho em repositórios grandes e cenário inverso completo dentro do limite continuam necessários antes de promover um candidato para uso diário. Claude read-only continua dependendo de hooks/política; não equivale ao sandbox nativo Codex.

## Verificação local final

| Comando | Resultado | Evidência |
|---|---|---|
| `apps/desktop/build/node/node --test --test-timeout=15000 packages/sidecar/test/*.test.ts` | 196/196, exit 0 | [Node 24](execution-autonomy/validation/node24-tests.log) |
| `node --test --test-timeout=15000 packages/sidecar/test/*.test.ts` | 196/196, Node 26.10.0, exit 0 | [Node 26](execution-autonomy/validation/node26-tests.log) |
| `npm run test -w @orbit/desktop` | 6/6, exit 0 | [Interface](execution-autonomy/validation/desktop-tests.log) |
| `npm run typecheck` | Sem erros, exit 0 | [Tipos](execution-autonomy/validation/typecheck.log) |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS, exit 0 | [Build](execution-autonomy/validation/build.log) |
| `git diff --check` | Sem erros, exit 0 | [Diff](execution-autonomy/validation/diff-check.log) |

A primeira suíte teve timeout no teste de templates, também observado em uma execução isolada; cópias instrumentadas e as duas suítes finais passaram. A causa daquela ocorrência não foi comprovada nem se atribui sua correção aos dois reparos do harness. O [log inicial](execution-autonomy/validation/tests-initial.log) conserva a falha; o processo do teste que ficou aberto foi encerrado, e a suíte final usou timeout por arquivo sem ampliar as esperas funcionais. A primeira suíte após o barrier também revelou uma fixture que não emitia `SessionStart`; ela agora simula abertura/estabilidade do CLI explicitamente, em vez de esperar recibo durante startup.

O bundle debug foi atualizado localmente (167,62 MiB), com o aviso anterior de chunk JS acima de 500 kB. Fontes/recursos/artefatos têm hashes no [índice de validação](execution-autonomy/validation/validation.json). Supervisores, CLIs e diagnósticos desta rodada foram encerrados. O app instalado, missões pessoais e o servidor antigo do protótipo não foram alterados.
