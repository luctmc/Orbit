# Coordenação e auditoria de retomada — 15/10/2026

**Implementados o contexto de entrega em uma chamada e a auditoria testável após fechamento de helpers.** A suíte final passou: 203 testes do motor mais 4 do supervisor (207/207), 6 do desktop, tipagem e build macOS. Depois dos checks locais sem modelos, foram repetidas somente as mesmas duas tarefas econômicas. O fluxo normal passou; a recuperação nativa confirmou sessões e replay sem duplicação, mas o inverso excedeu o orçamento. O aplicativo instalado não foi substituído; as mudanças estão no código e no bundle debug local.

[Plano executado](2026-10-15-orbit-coordination.md) · [Verificação local](2026-10-15-orbit-coordination-evidence/validation.json) · [Conferência final local/nativa](2026-10-15-orbit-coordination-evidence/final-validation.json).

## Mudanças

**ACK com contexto opcional.** `delivery_ack(deliveryId, includeResult=true)` confirma o mesmo recibo durável e retorna o resultado, sua tentativa, os critérios originais e o estado atual da atividade. Esses dados permitem evitar consultas separadas de `handoff_list`, `activity_status` e `delivery_status` quando serviriam apenas para reler a mesma entrega. O caminho sem o campo opcional continua compatível.

O contexto informa se a entrega é a atual e marca explicitamente `sourceFreshness: not_checked`. Uma entrega substituída permanece histórica e conserva os critérios da sua própria tentativa, sem receber critérios de um contrato posterior. Resumo, evidência e detalhes são limitados a 2.000, 4.000 e 2.000 caracteres; cortes são sinalizados com a chamada para buscar detalhe. Critérios não são cortados. A resposta compacta não repete o texto completo do aviso ou snapshots de terminal.

O ACK continua autorizado somente ao destinatário e à execução válidos. Ele não cria inspeção, não varre o repositório, não aceita código e não permite declarar a missão pronta. Os testes verificam essas distinções e a leitura após fechamento do produtor.

**Orientação para revisão.** O prompt do líder e a descrição de `dependsOn` agora explicam que a revisão de um resultado ainda não aceito deve receber seu `resultId` no briefing, sem exigir como dependência o aceite que ela própria precisa produzir. Dependências legítimas continuam obrigatórias e o motor conserva a recusa anterior. Não existe remoção automática de dependências ou revisão automática.

O líder também é orientado a reutilizar o contexto do ACK, buscar detalhe somente quando necessário e preencher `command`, `exitCode`, `summary` e os critérios de revisão com evidência real e campos não vazios. A orientação nova vale para agentes novos; conversas retomadas podem conservar instruções anteriores.

**Auditoria do supervisor.** O runner utiliza agora `auditRecovery`, extraído para `scripts/lib/autonomy-observations.mjs`. A função compara identidades e epochs observados, reaplica reports somente para identidades válidas e exige delta zero e consumo da missão inalterado. Um pane fechado pode ser resolvido pelo snapshot efetivamente observado nesta execução. O checkpoint nunca é usado para inventar uma observação ausente. Falhas de auditoria passam a ter motivo explícito no registro final.

## Resultado local reproduzido

| Cenário MCP de uma entrega | Consultas | Bytes das respostas |
|---|---:|---:|
| ACK + resultado + atividade + estado de recibo separados | 4 | 2.979 |
| ACK com contexto | 1 | 1.512 |

A medição foi feita no transporte MCP local, na fixture de uma única entrega, usando as respostas serializadas. É uma redução dos pedidos necessários para esses mesmos dados; não substitui consultas de histórico ou outras atividades. **Bytes não são tokens. Não foi medido ganho de consumo, latência ou qualidade de um modelo real nesta rodada.** [Log com a medição](2026-10-15-orbit-coordination-evidence/protocol-green.log).

O teste de retomada usa Store, persistência, reabertura e fechamento de PTYs reais com agentes simulados. Registra duas sessões e seus contadores, salva uma entrega, encerra o motor, reabre os agentes, observa as novas execuções e fecha o helper antes da auditoria. A identidade do helper continua disponível e os dois reports antigos acrescentam zero tokens/custo. A entrega mantém seu ID. Casos de sessão ausente, sessão diferente, epoch antigo e epoch desconhecido reprovam sem injetar reports de uso.

Esse teste amplia a verificação do supervisor além dos objetos isolados anteriores. Ele usa agentes simulados; a rodada nativa a seguir é uma evidência distinta. O piloto inverso anterior continua reprovado por excesso de 15.110 tokens e sua auditoria original não foi reescrita.

## Repetição nativa das duas tarefas

Mesmos modelos (`claude-haiku-5-5` e `gpt-6-luna`), esforço baixo, perfil Orbit e corpus protegido. Limites conservados: 1.500.000 tokens/US$ 0,15 Claude conhecido por missão e seis minutos por fase. Não houve aumento após falha nem repetição automática. Os manifests das duas novas execuções registram a mesma revisão de fonte, pins e versões dos CLIs.

| Fluxo | Tokens anteriores | Tokens nesta rodada | Resultado |
|---|---:|---:|---|
| Codex líder → Claude implementação → Codex revisão | 1.439.381 | 1.033.874 | Funcional e orçamento aprovados |
| Claude líder → Codex implementação → Claude revisão, com interrupção | 1.515.110 | 1.540.375 | Funcional, identidade e replay aprovados; orçamento reprovado em 40.375 tokens |

As duas missões chegaram à integração atual e à declaração final do líder, com dois resultados independentes aceitos, recibos confirmados, oracle externo verde e escopo de escrita preservado após encerramento. O supervisor não delegou, fabricou entregas/vereditos ou declarou conclusão pelos agentes.

Na missão inversa, o SIGKILL ocorreu após commit durável e antes do dispatch. O resultado `439bc2c6-cb0c-46f7-860b-ddebf66e494c` e seu recibo foram preservados; a implementação não foi repetida. As duas conversas conservaram IDs e receberam epochs novos. Reaplicar os dois reports antigos acrescentou zero tokens/custo e manteve os totais da missão inalterados. **A auditoria nativa atual passou.** Nesta repetição, os helpers permaneceram na lista final de panes; o fallback após remoção é coberto pelo teste Store/PTY descrito acima, sem afirmar que essa condição específica voltou a ocorrer no piloto nativo.

O líder Codex registrou dois pedidos de ACK com `includeResult=true`, dois spawns e nenhuma referência a `handoff_list`, `activity_status` ou `delivery_status` nas fontes de chamadas `exec` retidas. Essas contagens são referências estáticas na fonte registrada, não instrumentação independente das execuções do servidor. O líder Claude também deixou de chamar esses três leitores no transcript retido. Ambos abriram a revisão sem o erro de dependência circular observado antes. [Referências Codex](2026-10-15-orbit-coordination-evidence/forward-codex-call-references.json), [transcripts Claude resumidos](2026-10-15-orbit-coordination-evidence/native-reverse.json).

**A economia não foi uniforme:** o fluxo normal consumiu menos; o inverso consumiu mais, apesar de menos consultas de coordenação. A fase recuperada inversa levou 331.228 ms. Comportamento, quantidade de checks e latência variam; a amostra não isola cada causa ou comprova redução geral. O limite é observado por reports assíncronos e não impede todo consumo já em voo.

Total nativo desta rodada: **2.574.249 tokens observados**, incluindo a recuperação uma única vez, e **US$ 0,035951 de subtotal Claude conhecido**. Custo completo permanece `null`, pois Codex não informa USD; valores dos CLIs não são uma fatura. [Agregado e hashes](2026-10-15-orbit-coordination-evidence/native-observations.json), [normal](2026-10-15-orbit-coordination-evidence/forward-1/summary.json), [inverso](2026-10-15-orbit-coordination-evidence/reverse-1/recovered.json).

## Medição de leitura do repositório

Três fingerprints sem alterações, no Node 26.10.0:

| Raiz | Arquivos | Tempos observados |
|---|---:|---|
| Checkout local do Orbit | 1.002 | 205,4 / 52,4 / 54,0 ms |
| Fixture com 30 módulos | 3.000 | 78,4 / 73,0 / 73,0 ms |

A fixture também detectou mudança de conteúdo com mesmo tamanho e mtime restaurado. Nenhum cache foi acrescentado e nenhum gate foi removido. São leituras locais, influenciadas pelo cache do sistema; não medem uma sessão de desenvolvimento completa, um monorepo grande, uso de memória ou responsividade do desktop. O digest identifica as fontes no instante anterior à gravação do relatório de medição. [Dados e limites](2026-10-15-orbit-coordination-evidence/source-timing.json).

## Verificação final

| Comando | Resultado |
|---|---|
| `apps/desktop/build/node/node --test --test-timeout=20000 'packages/sidecar/test/**/*.test.ts' scripts/lib/autonomy-observations.test.mjs` | 207/207, exit 0 |
| `apps/desktop/build/node/node --test 'apps/desktop/src/orbit/*.test.ts'` | 6/6, exit 0 |
| `npm run typecheck` | Sem erros, exit 0 |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS 167,63 MiB, exit 0 |
| `git diff --check` | Sem erros, exit 0 |

O build terminou antes da suíte no Node empacotado. O aviso conhecido de chunk JS acima de 500 kB permanece. Os logs incluem a regressão vermelha do ACK sem contexto, o teste da API de auditoria antes da extração e as verificações verdes. O bundle contém a versão nova do sidecar e seu hash corresponde ao artefato de build.

## Prontidão para uso diário

Esta rodada fecha a implementação, a validação local e a repetição das duas tarefas com CLIs reais. **Ainda não certifica o Orbit como ambiente principal sem supervisão.** Falta manter ambos os fluxos dentro do orçamento de forma consistente e completar tarefas consecutivas de desenvolvimento em um repositório real maior. A economia geral e a estabilidade de latência continuam sem comprovação.

Foram repetidas apenas as duas tarefas do piloto econômico, depois dos checks locais. Não houve mudança de modelo, aumento de orçamento, instalação, commit, push ou publicação. As evidências dos pilotos anteriores permanecem preservadas. Uma futura rodada deve manter limites e oracles, usar diretórios novos e relatar falhas e custos ausentes.

Os PIDs próprios dos pilotos foram conferidos como encerrados, e os hashes do código permaneceram iguais aos verificados na suíte e no build. Nenhum servidor pessoal foi encerrado.
