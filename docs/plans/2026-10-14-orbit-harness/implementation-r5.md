# R5 — medição, contabilidade e piloto econômico

Implementada no checkout em 15/10/2026. A infraestrutura de avaliação e o piloto estão verificados; **o gate de economia de tokens continua pendente**. O usuário escolheu duas tarefas reais antes de ampliar. Foram executadas duas tarefas em duas configurações, com uma recuperação de revisão registrada separadamente. Nenhum commit, push, instalação ou release foi feito.

## Correções que o piloto tornou necessárias

O adapter do Claude confundia os campos `context_window.total_input_tokens/total_output_tokens` com consumo acumulado. Esses campos descrevem a janela de contexto da resposta mais recente, incluindo cache no input; não são um contador de todas as chamadas. A distinção está na [documentação oficial do statusline](https://code.claude.com/docs/en/statusline#available-data), consultada nesta rodada. Os testes anteriores com snapshots cumulativos validavam o watermark do Orbit, mas não provavam essa semântica do CLI real.

`adapters/claudeUsage.ts` agora lê incrementalmente o transcript da sessão resolvida pela conta registrada. Soma respostas completas por ID do provider, elimina frames repetidos e inclui input, output, leitura e criação de cache. Um caminho arbitrário recebido no payload não determina qual arquivo será lido. Os campos antigos continuam úteis para o percentual de contexto, sem gerar cobrança de tokens. O statusline chama essa medida de “tokens no contexto”. A coleta ocorre no status, no polling e no término observado do processo.

Cobertura incompleta permanece explícita nas medições: respostas sem contadores, frames pendentes, histórico inválido e uso de subagentes nativos impedem certificar o total completo. O leitor limita tamanho do arquivo a 64 MiB, respostas a 50.000, linha parcial a 2 MiB e cache a 16 sessões. Não certifica arquivo substituído ou truncado. O contador cobre o loop principal observado; não promete contabilizar automaticamente toda árvore de agentes interna do Claude.

Também foram corrigidas duas omissões:

- **Custo ausente era convertido em zero.** O ledger usa `null` e guarda a cobertura do subtotal conhecido. A interface mostra “Não informado” ou “parcial”; CSV deixa valor desconhecido em branco. Zeros legados ambíguos são migrados conservadoramente. USD informado pelo CLI é estimativa, não fatura.
- **O classificador não entrava no orçamento.** Cada invocação tem reserva durável antes da chamada e conclusão idempotente com uso, duração, modelo e resultado, inclusive JSON inválido ou erro. O consumo é contabilizado antes de lançar o próximo helper. Uma reserva interrompida sem observação não vira consumo zero comprovado.

As regressões foram reproduzidas antes das correções: custo `0` em vez de `null`, classificação sem os 17 tokens do fixture e contexto corrente cobrado como consumo. Os fixtures antigos de contabilidade agora fornecem explicitamente um snapshot normalizado; testes novos cobrem a fonte real do Claude separadamente. Os relatórios R0–R4 permanecem históricos, e esta correção substitui sua premissa sobre os contadores nativos do Claude.

## Infraestrutura de avaliação

O corpus contém 12 tarefas versionadas: quatro operações, quatro bugs e quatro mudanças com múltiplos arquivos. Cada tarefa tem fixture, escopo permitido e critérios executáveis protegidos. Todos os bugs e mudanças falham no estado inicial e passam com a solução de referência. Alterar o próprio critério ou escrever fora do escopo recusa o aceite.

`scripts/bench-harness.mjs` abre missões temporárias pelo core/servidor reais do Orbit e preserva manifestos, hashes, falhas e resultados. A configuração `eager` retira limites por seção opcional, mantendo o orçamento global e os mesmos contratos de segurança/revisão; `budgeted` usa o empacotamento normal. As execuções são pareadas por tarefa, revisão, runtime, modelos, limites e repetição. Falhas permanecem no numerador de tokens por trabalho aceito.

`HarnessMeasurements` é opcional e mantém contadores em memória, sem conteúdo de mensagens, chamadas extras de modelo ou gravação por chunk do PTY. Separa bytes iniciais, bytes de consultas, skills servidas, mensagens, wakeups efetivamente enviados ao PTY, startup e uso com origem/cobertura. Os artefatos de diagnóstico do benchmark podem conter texto das tarefas sintéticas. Primeira saída do PTY não é primeira resposta semântica; `firstResponseMs` permanece `null`.

O runner usa um **coordenador determinístico**, com Claude implementando e Codex revisando. Portanto, não avalia planejamento autônomo de um maestro LLM. Classificador não foi invocado nesses casos de CLI explícita; sua contabilidade foi coberta por regressões locais.

## Resultados preservados

### Corpus offline

[72 execuções offline](execution-r5/offline-final-reviewed-analysis.json): 12 tarefas × 3 repetições × 2 configurações, 36 pares, todos aceitos pelos critérios independentes. Esse modo usa executor de referência e PTYs simulados: valida o percurso do harness e o corpus, não qualidade de modelos ou economia real. Tokens e custos permanecem desconhecidos.

### Piloto com CLIs reais

Runtime: Node 24.21.0, Claude Code 2.1.296, Codex CLI 0.162.1. Modelos solicitados: `claude-haiku-5-5`, esforço baixo, e revisor `gpt-6-luna`, esforço baixo e sandbox nativo read-only. São nomes fixados na solicitação, sem garantia adicional de identidade do backend. Limites por missão: 750.000 tokens e US$ 0,10 de custo conhecido. Cada fase tem timeout limitado; o orçamento não estima preço ausente do Codex.

| Caso | Configuração | Aceite original | Tokens nativos observados |
|---|---|---|---:|
| Build local | eager | Aceito | 454.023 |
| Build local | budgeted | Aceito | 535.892 |
| Média de array vazio | budgeted | Aceito | 536.437 |
| Média de array vazio | eager | Não verificado pelo revisor | 550.315 |

O [piloto original](execution-r5/live-pilot-final/summary.json) continua com **3/4 aceites**. Total: **2.076.667 tokens**, incluindo a execução não aceita. Por configuração: eager 1.004.338 tokens e um aceite; budgeted 1.072.329 tokens e dois aceites. Subtotais conhecidos estimados do Claude: US$ 0,018249 e US$ 0,019008; total conhecido US$ 0,037257. O custo do Codex não foi informado, então o custo financeiro total é `null`.

**Não há redução atribuível à otimização.** As duas configurações entregaram 16.870 bytes iniciais cada, com redução mediana de 0%. Neste corpus, o histórico opcional preparado para diferenciar o contexto era do líder; o líder shell não recebe esse prompt. Workers receberam apenas contexto obrigatório. Logo, o tratamento de contexto não foi exercitado. Variações do modelo e diferenças de aceite não demonstram economia.

O avaliador foi endurecido após essa constatação: sem diferença observada na relação entre contexto fonte e contexto injetado, `treatmentObserved=false` e a redução atribuível fica `null`. A [reanálise do piloto](execution-r5/live-pilot-final-reviewed-analysis.json) conserva essa conclusão. A versão anterior do avaliador está em [provenance/evaluation-at-pilot.ts](execution-r5/provenance/evaluation-at-pilot.ts); substituí-la no cálculo reproduz exatamente o hash original do source. Os JSONs originais não foram reescritos.

### Falha de revisão e recuperação limitada

O código do quarto caso passou no critério independente. O revisor, porém, registrou saída 1 e alegou que o sandbox impediu o teste. O [recibo nativo](execution-r5/original-review-execution-receipt.json) mostra **exit code 0** para o comando combinado. O Git imprimiu erros/avisos de cache do `xcrun` no stderr, e o agente os interpretou como falha. O teste era silencioso quando aprovado.

O Orbit conservou o parecer `unverified` e impediu concluir a missão. Como pareceres são imutáveis por inspeção, a recuperação criou nova tentativa da mesma atividade de revisão e nova inspeção. O feedback orientou a consultar o exit code real e executar o check isoladamente com Node absoluto e shell sem login. O revisor aceitou; o controlador executou novamente o critério protegido e registrou revisão do resultado do revisor e da integração. Não houve alteração de source, relaxamento do sandbox, `force` ou dispensa.

A [recuperação](execution-r5/review-recovery.json) terminou aceita e com `readyAt`, consumindo **193.439 tokens adicionais**. O caso inteiro, incluindo a falha, consumiu **743.754 tokens**. Somando piloto e recuperação: **2.270.106 tokens observados**, além das calibrações anteriores. O custo adicional do Codex é desconhecido. Isso comprova uma recuperação limitada; não constitui outra observação A/B e não transforma o piloto original em 4/4.

Os checks registrados no MCP continuam sendo relatos atribuídos ao revisor. O harness confere identidade, revisão e coerência, mas não verifica semanticamente um relato de shell. O critério executado pelo controlador independente foi necessário para distinguir falha real de diagnóstico incorreto.

### Calibrações anteriores

[live-pilot/](execution-r5/live-pilot/manifest.json) conserva uma tentativa com timeout e outra interrompida pelo limite inicial de 100.000 tokens. Usavam a contabilidade antiga do Claude; seus tokens não são comparáveis nem somáveis como total nativo completo. Seus custos conhecidos estimados do Claude foram US$ 0,009296 e US$ 0,008626, respectivamente. Incluindo essas calibrações, o subtotal conhecido do Claude nesta investigação é **US$ 0,055179**; isso não inclui preço desconhecido do Codex e não representa cobrança efetiva. Nenhuma calibração foi promovida a resultado aceito.

## Validação final

| Comando | Resultado | Evidência |
|---|---|---|
| `npm test` | 190/190 sidecar + 3/3 desktop, exit 0 | [tests.log](execution-r5/tests.log) |
| `apps/desktop/build/node/node --test packages/sidecar/test/*.test.ts` | 190/190 no Node 24.21.0, exit 0 | [node24-tests.log](execution-r5/node24-tests.log) |
| `npm run typecheck` | Sem erros, exit 0 | [typecheck.log](execution-r5/typecheck.log) |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS gerado, exit 0 | [build.log](execution-r5/build.log) |
| `git diff --check` | Sem erros, exit 0 | [diff-check.log](execution-r5/diff-check.log) |

O bundle de desenvolvimento tem 166,80 MiB. Permanece o aviso do chunk JavaScript acima de 500 kB, agora 747,99 kB. O app instalado não foi substituído. [validation.json](execution-r5/validation.json) identifica fontes, testes, recursos, logs e artefatos por SHA-256 e confere o sidecar e as skills empacotados.

Cobertura adicional: custo parcial e zero informado, persistência/idempotência do classificador, orçamento antes do helper, chamadas sem observação, cobertura incompleta, deduplicação/releitura do transcript, sessão própria, oracle adulterado, escopo de escrita, pares incompatíveis, falhas no numerador e ausência de tratamento de contexto.

## Limites e continuação

A matriz real completa de 72 execuções não foi realizada. Não há significância estatística, ganho de latência ou superioridade sobre Overclock comprovados. Tempos incluem oracle e sofreram concorrência com validações locais; não sustentam comparação de desempenho. Os componentes de input do JSON headless preservam a semântica bruta do provider, enquanto input de sessão normalizado inclui cache; somente os totais são diretamente agregáveis entre essas origens.

O próximo experimento precisa exercitar contexto opcional num líder LLM real, medir a diferença efetivamente entregue e só então repetir uma amostra limitada. Não ampliar chamadas pagas com o desenho atual. A correção da medição vem antes de prometer redução.

R6 continua pendente: interface e mascote ligados aos estados reais, cenário autônomo completo com Claude/Codex, interrupção entre entrega e consumo e execução com os papéis invertidos. Este piloto dirigido não substitui esses gates para uso diário.
