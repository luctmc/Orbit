# Relatório de implementação — R0

14/10/2026. Primeira etapa aplicada no checkout após a autorização de implementação. O trabalho preserva as alterações anteriores e mantém Tauri, React, sidecar e CLIs existentes.

## Resultado

R0a e R0b foram implementadas. A revisão também encontrou e corrigiu dois casos nas fronteiras de encerramento. O registro de pendências é uma base para R1, não a implementação completa de atividades/tentativas/resultados versionados.

| Caso | Comportamento anterior | Comportamento aplicado |
|---|---|---|
| Retomada da mesma conversa | O report antigo de 1.100 tokens elevava a missão a 2.200 | Baseline restaurado; report repetido mantém 1.100, report novo acrescenta somente o delta |
| Último report Codex no exit | Snapshot antigo do processo sobrescrevia o contador final | Estado de saída persistido antes da leitura final; contador mais recente permanece disponível para resume |
| Progresso seguido de saída | Worker encerrado deixava de bloquear `mission_ready` | Obrigação continua registrada, mesmo sem processo vivo |
| Fechamento do terminal | Podia eliminar a obrigação do gate | Fechamento remove a apresentação/processo, preservando trabalho requerido |
| Relatório automático ou blocked | Podia permitir missão pronta | Permanece pendente até entrega done ou dispensa explícita |
| Dispensa forçada | `force` sem motivo | `force` exige `reason`; dono, motivo e momento ficam registrados, com informação no resumo e evento |
| Nova tentativa | Podia coexistir com tentativa ainda ativa; histórico de pendência não era separado | Retry de trabalho incompleto ativo é recusado; retry justificado de tentativa parada aponta a substituição e preserva o histórico |
| HTTP incompleto no shutdown | Encerramento podia esperar indefinidamente o corpo da requisição | Servidor para de aceitar conexões e encerra as conexões ativas durante shutdown |

## Contrato de pendência

[deliveryLedger.ts](../../../packages/sidecar/src/deliveryLedger.ts) define identidade independente do terminal, missão, dono, pane original, título, critérios, timestamps, status, dispensa e substituição. O armazenamento está em `state.json.deliveryObligations`.

Estados pendentes: `pending`, `progress`, `blocked`, `unverified`. Estados que liberam a obrigação: `done`, `waived`, `superseded` por tentativa substituta identificada. `done` ainda segue o contrato atual de evidência e critérios declarados pelo agente; validação independente vinculada ao diff permanece em R4.

- `progress` pode encerrar um turno sem virar conclusão.
- Nova atribuição após uma entrega concluída cria outro registro; a entrega antiga permanece histórica.
- Migração inicial recupera panes existentes e snapshots de delegações fechadas. Ela é idempotente e não reconstrói dados que versões anteriores já tenham descartado.
- Pendências aparecem em `mission_status.pendingDeliveries` e no briefing do líder, incluindo terminais fechados.
- Troca de líder reatribui obrigações pendentes, inclusive registros sem terminal vivo.
- Atribuições, resultados e substituições fazem flush antes da resposta correspondente. Isso melhora as fronteiras presentes; não implementa ainda a reserva durável anterior ao spawn nem outbox de wake/ACK por epoch de R1/R2.
- Missões já declaradas prontas por uma versão anterior não têm seu histórico reescrito automaticamente; o novo gate se aplica às novas declarações e atribuições.

## Arquivos de produção

- [core.ts](../../../packages/sidecar/src/core.ts): retomada, último report, gates, histórico de novas tentativas, briefing e reatribuição.
- [deliveryLedger.ts](../../../packages/sidecar/src/deliveryLedger.ts): domínio de obrigação separado do Pane.
- [store.ts](../../../packages/sidecar/src/store.ts): persistência, migração, histórico e dispensas.
- [mcp.ts](../../../packages/sidecar/src/mcp.ts): pendências no status e motivo obrigatório no force.
- [prompts.ts](../../../packages/sidecar/src/prompts.ts): contrato inicial do líder atualizado.
- [server.ts](../../../packages/sidecar/src/server.ts): encerramento de conexões HTTP ativas.

## Verificação

Regressões adicionadas:

- [sessionAccounting.test.ts](../../../packages/sidecar/test/sessionAccounting.test.ts): quatro cenários de uso/retomada. Os dois primeiros falharam antes da correção; o cenário de último report Codex também falhou antes da correção específica.
- [deliveryObligations.test.ts](../../../packages/sidecar/test/deliveryObligations.test.ts): oito cenários de pendência, persistência, migração, dispensa, retomada e substituição. Os cinco cenários iniciais reproduziram falhas antes da implementação.
- [shutdown.test.ts](../../../packages/sidecar/test/shutdown.test.ts): conexão autenticada com corpo incompleto; falhou antes e passou depois da correção.
- [delivery.test.ts](../../../packages/sidecar/test/delivery.test.ts): protocolo MCP real verifica pendência de progresso e recusa de force sem motivo.

Resultados finais, exit 0:

| Comando | Evidência |
|---|---|
| `npm test` | 110/110 sidecar + 2/2 desktop; 112 testes, zero falhas |
| `npm run typecheck` | Todos os workspaces sem erros |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS gerado |
| Node 24.21.0 empacotado executando os três novos arquivos de teste | 13/13, zero falhas |
| `node docs/plans/2026-10-14-orbit-harness/reproduce-current.mjs` | Uso permanece 1.100 e missão continua bloqueada após saída com progress |
| `git diff --check` | Sem erros de whitespace |

As execuções iniciais da suíte tiveram travamentos em integrações que passaram isoladamente. O caso HTTP incompleto foi reproduzido separadamente e corrigido; a execução completa final passou em aproximadamente nove segundos. Não se atribui todo travamento anterior à mesma causa nem se declara uma campanha de stress concluída.

O diagnóstico `reproduce-current.mjs` foi atualizado para verificar o comportamento corrigido. A reprodução histórica e seus resultados estão registrados nos relatórios de investigação e no `validation.json` da fase de planejamento.

Logs finais e hashes do código estão em [execution-r0](execution-r0/validation.json).

## Build e limites

Bundle local: `/Users/lucas/Documents/GitHub/Orbit/apps/desktop/src-tauri/target/debug/bundle/macos/Orbit.app`. O aplicativo instalado não foi substituído nem houve publicação. As mudanças continuam no checkout local, junto das alterações anteriores preservadas.

Esta rodada não executou modelos reais nem alterou configurações pessoais. Os testes usam homes vazios, processos sintéticos, sockets locais e, na suíte existente, navegador com perfil de teste. A validação anterior de leitura/MCP com Claude/Codex reais continua como evidência histórica, não como execução repetida desta rodada.

Corrigir o contador não reduz os tokens consumidos pelos modelos: elimina contabilização duplicada e interrupções incorretas por orçamento. Economia real depende das etapas de contexto, skills, decisão e avaliação.

## Continuação do roteiro

R1: separar atividade/tentativa/sessão/resultado com revisões, baseline por identidade de sessão e reserva durável. R2: adapters com capacidades, epochs e outbox com níveis de ACK. R3: contexto e skills sob demanda. R4: scheduler/maestro e validação vinculada à revisão. R5: benchmark com qualidade fixa. R6: interface e mascote ligados ao estado real.

O visual e o mascote permanecem como proposta/protótipo nesta entrega. Não se apresenta o plano inteiro como implementado.
