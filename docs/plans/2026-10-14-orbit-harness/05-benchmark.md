# R5 — avaliação reproduzível do harness

**Goal:** medir qualidade, bytes, tokens observados, custo conhecido e tempos sem omitir classificador, revisão, falhas e retries.
**Architecture:** preservar PTYs e contratos R0–R4. Acrescentar registro durável das chamadas do classificador, medição opcional do ciclo do harness e um runner local de corpus com critérios independentes executáveis. Separar simulação/offline de execuções reais e manter os mesmos gates nas duas configurações.
**Stack:** TypeScript/Node existentes, node:test, subprocessos e Git locais; sem dependência ou serviço novo.

## Restrições

- Preservar todas as alterações locais; não commitar, publicar ou instalar.
- Custo não reportado é `null`; subtotal conhecido deve mostrar cobertura parcial.
- Não converter bytes em tokens; não comparar CLIs/modelos diferentes como ganho da configuração.
- Corpus versionado de 12 tarefas, quatro por categoria: operação, bug, mudança com múltiplos arquivos. Matriz completa: três repetições por configuração, mesma revisão/critério/modelos.
- Execuções offline não provam comportamento de modelos. Piloto real tem amostra/limites explícitos; não certifica a meta de 25% ou superioridade universal.
- Manter sandbox, revisão independente, contratos e dependências nas duas configurações; nenhuma comparação desliga proteções.
- Nenhum modelo para idle, rótulos, leitura de estado ou mascote.

## Mapa

| Arquivo | Responsabilidade |
|---|---|
| `packages/protocol/src/index.ts` | Custo nullable e indicação de cobertura do ledger |
| `packages/sidecar/src/store.ts` | Persistir chamadas auxiliares, custo conhecido/ausente e exportação de evidências |
| `packages/sidecar/src/decider.ts` | Observar resultado de uma invocação, inclusive erro/ausência de uso |
| `packages/sidecar/src/measurements.ts` | Contadores opcionais de execução, contexto, uso, mensagens e tempos |
| `packages/sidecar/src/core.ts` | Conectar medição e contabilizar classificador antes do próximo lançamento |
| `apps/desktop/src/components/UsagePanel.tsx` | Exibir/exportar custo desconhecido e parcial corretamente |
| `scripts/bench-harness.mjs` | Executar matriz, persistir manifestos/resultados e produzir comparação |
| `packages/sidecar/src/benchmarks/corpus.ts` | Tarefas, fixtures e critérios executáveis independentes |
| `packages/sidecar/src/benchmarks/evaluation.ts` | Agregar pares compatíveis, cobertura e gates de qualidade |
| `packages/sidecar/test/benchmark*.test.ts` | Regressões de contagem e testes dos critérios/relatórios |

### Extensão localizada após a calibração real

A calibração reproduziu uma fonte incorreta de consumo Claude: os contadores da janela atual não eram cumulativos. O diagnóstico e os testes precederam o reparo. Foram acrescentados `packages/sidecar/src/adapters/claudeUsage.ts` e `packages/sidecar/test/claudeUsageSource.test.ts`, com integração em `usage.ts`, `core.ts`, `adapters/types.ts` e `hooks/statusline.mjs`. `server.ts` passa as opções de medição. A cobertura financeira da interface ficou em `apps/desktop/src/orbit/costCoverage.ts` e seu teste.

`scripts/recover-benchmark-review.mjs` registra uma tentativa limitada de revisão sobre a missão temporária que falhou, preservando o resultado original. O avaliador também recusa atribuição de economia quando as configurações não exercitam tratamento distinto de contexto. Implementação, evidências e limites: [relatório R5](implementation-r5.md).

## Execução inline já autorizada

1. Reproduzir custo ausente transformado em zero via `fixture()` de `r2Fixture.ts`, `statusReport` sem custo e `store.ledger(dayKey(...).slice(0,7))`; exigir `costUsd === null`. Reproduzir chamada do classificador com uso no JSON e exigir sua presença no total/registro da missão. Executar regressões antes dos reparos.
2. Implementar custo nullable com cobertura conservadora e migração que não chama zeros antigos de custo comprovado. Registrar invocação auxiliar antes da chamada; concluir/contabilizar uma única vez pelo ID, inclusive se classificação falhar. Testar persistência, idempotência, orçamento e falha de disco.
3. Medição opcional: `HarnessMeasurements` recebe eventos por epoch; exporta bytes UTF-8 separadamente de contadores reportados. Distinguir primeira saída do PTY de primeira resposta do agente. Não registrar conteúdo de mensagens ou segredos e não causar gravação em disco a cada chunk do terminal.
4. Corpus: critérios locais executáveis sobre cópia temporária; demonstrar que cada bug/mudança falha no estado inicial e passa com solução de referência. Operações têm fixtures válidas e comportamento esperado independente da saída textual do agente. Registrar hashes de corpus, source e modelos/configuração.
5. Runner: duas configurações com contrato idêntico, ordem alternada, repetições numeradas, resultados incompletos/falhas preservados. Avaliador recusa pares incompatíveis, duplicados, faltantes e ganhos sem cobertura de uso/qualidade; incluir workers, revisões, retries e classificador no total por trabalho aceito.
6. Executar corpus offline e testes de falha/relatórios; executar piloto real conforme escopo escolhido/disponibilidade. Rodar suíte completa, Node 24, types e build; relatório com limites e índice de hashes. A matriz real completa permanece um gate explícito enquanto não executada.

O código completo e testes ficam nos arquivos acima; os resultados e hashes no relatório identificam a implementação efetivamente verificada. Não há confirmação pendente para executar a parte local.
