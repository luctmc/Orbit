# Registro da pausa — retomada em 15/10/2026

> **Retomada R6 autorizada e fatia visual/local validada.** Estado atual: [implementation-r6.md](implementation-r6.md). Timeout do teste reproduzido com fragmentação de PTY e corrigido; build debug final gerado. Cenário autônomo real e gate econômico continuam pendentes. Os registros de pausa abaixo e em [PAUSED-R6.md](PAUSED-R6.md) são históricos.

**Estado atual:** retomada autorizada com “pode retomar”; R4 implementada e verificada conforme [relatório](implementation-r4.md). A infraestrutura e o piloto econômico de duas tarefas da R5 estão registrados no [relatório R5](implementation-r5.md), incluindo correção da contabilidade Claude, falha original e recuperação de revisão. Economia de tokens não foi comprovada; o próximo experimento precisa exercitar contexto opcional num líder LLM. O checkpoint abaixo é histórico: suas pendências R4 foram tratadas. O gate econômico R5, a R6 e os gates de uso diário continuam pendentes. Nenhum lembrete foi criado.

## Checkpoint histórico ao pausar

R0–R3 concluídas conforme os relatórios. **R4 está parcialmente implementada e não deve ser tratada como validada ou pronta para uso diário.** Nenhum commit, instalação ou release foi feito.

## Ponto de retomada

Plano: `04-maestro-verification.md`. Mudanças R4 em protocol/core/store/mcp/maestro/routing/squads/activityLedger; módulos novos `scheduler.ts` e `verification.ts`; testes novos `orchestration.test.ts`, `verification.test.ts`, helpers `gitFixture.ts` e `reviewFixture.ts`. Preservar todas as mudanças anteriores do checkout.

Implementado parcialmente: recibos de decisão; requisito de sandbox; override de CLI/modelo/esforço; CAS de edição da tabela; dependências fixadas; bloqueio conservador de writers; fingerprint de source; inspeções e pareceres atribuídos ao revisor. Revisão de resultado e revisão final de integração agora têm escopos separados. Checks são declarações do revisor, não execução de comandos pelo MCP.

## Pendências importantes antes de validar R4

1. **Resolver liberação prematura da lease ao fechar um processo.** `PaneManager.forget()` chama kill e remove a execução antes do callback `onExit`; esse callback ignora execuções que já não são current. `Store.clearExecution()` atualmente remove a executionPolicy no fechamento. Uma nova execução pode ser admitida antes de a antiga ter realmente encerrado. É necessário manter a lease até confirmação de término, inclusive para execuções fechadas/substituídas, e adaptar retomadas sem liberar proteção por engano. Não foi implementada uma solução antes da pausa. Não matar processos de usuário arbitrários nem presumir término a partir de um signal enviado.
2. Conferir promoção de helper writer para líder: sandbox nativo de processo existente não é alterado apenas por trocar o papel. O bloqueio não pode ser relaxado indevidamente.
3. Acrescentar testes de dependências, troca de revisão/tentativa, decisão explícita em squad, requisito de sandbox, CAS, persistência e falha de disco. O teste de orquestração que menciona restart ainda não efetua restart real: completar ou corrigir a descrição.
4. Finalizar os contratos MCP e prompts. `ADMISSION_FIELDS` foi compartilhado com sub-helpers após um teste de qualidade revelar que o campo readOnly era descartado; essa última alteração ainda não foi retestada. Orientar revisão de resultado, depois revisão final com `result_inspect(scope=integration)`, sem dispensas automáticas.
5. A proposta de adicionar `baseRevision` a RoutingProposal e conferir propostas antigas **não foi aplicada**: o último patch falhou. A edição direta da tabela já possui revisão; a confirmação de propostas ainda precisa da proteção contra edição concorrente. O pedido de passar explicitCli na entrada UI `pane.spawn` também fazia parte do patch que falhou; conferir a fonte antes de aplicar.
6. Reavaliar fingerprints e critérios sem repetir revisões de todo histórico: pareceres de atividade são históricos e vinculados ao contrato; admissão de dependências exige source atual. A conclusão da missão exige revisão final do source integrado e do conjunto atual de contratos. Conferir todos esses caminhos com testes, incluindo alterações legítimas por atividades subsequentes.
7. Rodar suíte completa, Node 24 empacotado, types, build e diff check; gerar relatório R4 e índice de hashes. Ainda não há build final R4 validado.

## Evidência existente

`execution-r4/tests-first-run.log`: primeira suíte completa, 155 testes sidecar, 23 falhas (concorrência antiga sem isolamento, novo gate de revisão, expectativas antigas e uma regressão de esforço já ajustada). Não é prova de versão final.

Testes focados posteriores tiveram resultados parciais verdes. A última execução conjunta teve 25/26 passando; a falha era o campo de admissão ausente no schema dos sub-helpers, depois corrigido mas ainda não retestado. A última checagem de tipos passou antes dessa última edição. Não declarar R4 concluída com essas evidências.

O usuário também pediu um aviso para retomar. **Horário ainda não foi informado; não há lembrete agendado.**
