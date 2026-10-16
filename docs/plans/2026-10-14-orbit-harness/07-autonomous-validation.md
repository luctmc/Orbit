# R6 — validação autônoma com CLIs reais

**Goal:** observar líder real planejando/delegando, implementação e revisão cruzadas e recuperação de entrega interrompida, com critérios executáveis independentes.
**Architecture:** supervisor local abre somente a missão e o líder; os agentes usam os tools reais do Orbit para todo o restante. Processo filho executa o servidor; interrupção controlada ocorre depois do commit durável do primeiro resultado, antes de despachar o aviso. O pai conserva o checkpoint e só recupera depois de confirmar término dos processos herdados. Nenhum gate de aceite é dispensado pelo supervisor.
**Stack:** Node 24 empacotado, sidecar/PTYS/MCP existentes, corpus e contabilidade R5.

## Escopo e limites

- Autorizado por “bom pode seguir entao” após a descrição do fluxo autônomo real.
- Duas missões pequenas em cópias temporárias versionadas: líder Codex/worker Claude/revisor Codex; depois líder Claude/worker Codex/revisor Claude.
- Pins: Claude `claude-haiku-5-5` e Codex `gpt-6-luna`, esforço baixo. Máximo quatro aberturas nativas por missão sem recuperação e sete contando reaberturas do teste de recuperação. Sem fallback para modelos mais caros.
- 1.500.000 tokens e US$ 0,15 de custo conhecido Claude por missão; USD Codex desconhecido. Timeout de seis minutos por fase, sem retry de modelo automático.
- Não instalar, publicar, alterar o projeto Orbit por meio dos agentes, modificar missões pessoais ou aceitar prompts genéricos de autorização. Trust somente para a pasta temporária criada pelo runner.
- Critérios imutáveis e escopo de escrita conferidos pelo supervisor. O supervisor não chama spawnHelper, handoff, verifyResult ou missionReady para fabricar sucesso no modo real.
- Claude read-only usa hooks/política existentes; não equivale ao sandbox nativo Codex. Preservar essa diferença no relatório.
- Piloto não é A/B de economia nem certificação geral de confiabilidade.

## Mapa

| Arquivo | Responsabilidade |
|---|---|
| `scripts/verify-autonomous-harness.mjs` | Supervisor/filho, pasta temporária, pins, limites, observação e interrupção/reabertura |
| `packages/sidecar/src/benchmarks/autonomy.ts` | Critérios de sucesso do ledger/revisões/ACKs e orçamento, sem dependência de textos de saída |
| `packages/sidecar/test/autonomy.test.ts` | Rejeitar conclusão sem delegação, revisão própria, dispensa, falha do oracle e recuperação duplicada |
| `docs/plans/2026-10-14-orbit-harness/execution-autonomy/` | Manifestos, logs, checkpoints e resultados preservados, incluindo falhas |
| `docs/plans/2026-10-14-orbit-harness/implementation-autonomy.md` | Conclusões, consumo observado e limites |

## Sequência

1. Escrever critérios puros e testes que rejeitam os casos sem evidência. Exigir worker/revisor em CLIs opostas, entrega identificada, pareceres independentes, integração atual, ACKs e ausência de dispensas.
2. Implementar supervisor opt-in `--live`; sem esse flag apenas mostra instruções. Source/corpus/runner com hash, resultados por execução sem sobrescrever tentativas anteriores. Salvar dados operacionais sem bearer tokens.
3. Criar primeira missão com líder real e objetivo delimitado. O líder define cartões, atribui worker, recebe aviso, delega revisão, aceita o trabalho de revisão e conclui a integração/objetivo. O supervisor observa, executa oracle final e registra resultado verdadeiro.
4. Na missão inversa, injetar SIGKILL no processo filho imediatamente depois do commit durável do resultado e antes do dispatch. Conservar IDs e uso no checkpoint, esperar processos antigos terminarem, reabrir no mesmo dataDir e deixar o harness recuperar o aviso e o líder continuar. Comparar atividade/tentativa/resultado/sessão e watermark; repetir um report observado não pode cobrar novamente.
5. Em falha: preservar registros, ler o erro e identificar sua fronteira antes de mudar código/prompts ou repetir chamadas. Testes locais antes de qualquer reparo. Sem force, edição de parecer antigo ou substituição silenciosa por controlador determinístico.
6. Relatar limites reais e executar verificações pertinentes; alterações de produção exigem suíte, types e build atualizados. Não chamar o gate completo de aprovado caso apenas a primeira direção funcione.

## Ajustes após evidência real

- Primeira tentativa de trust foi enviada durante a inicialização do listener. Runner agora espera diálogo completo/estável da pasta temporária e faz no máximo um novo envio dessa mesma confirmação; não autoriza permissões genéricas.
- Worker Codex encerrou sem sessão por receber `--add-dir` sem política gravável explícita. Reparar `AgentLaunch.sandbox`, montagem do comando e escolha no core; teste de regressão antes do reparo.
- Após crash o outbox despachou durante startup: texto ficou no compositor, recibo somente `pty_accepted`. Reparar prontidão de transporte antes do dispatch, preservando ACK explícito e incerteza. Teste deve recusar envio em startup/permissão e liberar após atividade/terminal estáveis.
- Após diagnosticar esse segundo problema, permitir retomada **da mesma missão e sessões**, em nova pasta de evidência com referência ao manifest anterior, sem repetir implementação, limpar leases, zerar uso ou ampliar as sete aberturas acumuladas. Conservar as falhas anteriores.
- Encerrar quando orçamento for atingido; registrar os reports finais mesmo que revelem overshoot. Não elevar limite para obter um verde. O runner passa a conferir orçamento e source novamente após encerrar os processos.
