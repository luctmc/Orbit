# Finalização verificada em uma chamada

**Goal:** evitar uma rodada de modelo dedicada apenas a declarar conclusão após o aceite final, preservando todos os gates e a durabilidade.
**Architecture:** `verification_submit` recebe `readySummary?`, permitido somente ao líder em revisão de integração aceita. O core valida a mesma prontidão usada por `mission_ready`; Store grava parecer, conclusão e evento na mesma transação. Um recibo no parecer torna a repetição idempotente.
**Stack:** TypeScript, Zod, MCP, Store transacional existente, Node 24.

## Restrições

- Preservar o checkout e as evidências anteriores; nenhum commit, push, instalação ou publicação.
- Nenhuma remoção de skills, hooks, permissões, sandbox, inspeção, critérios, revisão ou integração atual.
- Sem `force` no caminho combinado; somente resultado aceito de integração e líder corrente.
- A opção é aditiva. Sem `readySummary`, o caminho atual continua igual.
- Build antes de testes no Node empacotado. Após checks locais, repetir apenas as mesmas duas tarefas econômicas com pins/limites atuais, sem retry automático após falha.
- Não atribuir toda variação de tokens a uma única chamada ou declarar economia universal.

## Evidência e hipótese

No líder Claude da última missão inversa, as respostas `msg_011Cg4YPCNwkhSbbw2VoaaVX` (verification_submit) e `msg_011Cg4YPViyNDcsRgmDxtmAm` (mission_ready) reportaram respectivamente 72.575 e 74.848 tokens de entrada. Uma resposta final posterior ainda reportou 75.545. A missão terminou com 1.540.375 tokens, ultrapassando o limite em 40.375. As chamadas de coordenação foram reduzidas, mas cada ida ao modelo continua carregando contexto grande.

Hipótese: aceitar o parecer final e declarar a missão pronta em uma operação explícita pode evitar a chamada separada de missão pronta. A economia precisa de nova medição; o motor não pode fabricar parecer, executar checks pelo modelo ou relaxar critérios para obtê-la.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/protocol/src/index.ts` | Recibo opcional de conclusão dentro do parecer persistido |
| `packages/sidecar/src/store.ts` | Commit conjunto de parecer, readyAt/summary e evento, repetição idempotente |
| `packages/sidecar/src/core.ts` | Gates compartilhados, opção somente no aceite final do líder e notificações após commit |
| `packages/sidecar/src/mcp.ts` | `readySummary?` aditivo no tool de parecer |
| `packages/sidecar/src/prompts.ts` | Explicar a opção sem remover o caminho separado |
| `packages/sidecar/test/finalization.test.ts` | Falha anterior, durabilidade, repetição, permissões, fonte/contrato/pedidos pendentes |
| `packages/sidecar/test/mcp.test.ts` | Opção pelo MCP autenticado, sem nova ferramenta |
| `scripts/verify-autonomous-harness.mjs` | Pedir finalização combinada no mesmo corpus/pins |
| `docs/plans/2026-10-15-orbit-finalization-report.md` | Resultado e limites com logs/manifests novos |

## Execução inline

1. Teste vermelho: após aceite individual, `verifyResult(lead, acceptedIntegration, readySummary)` deve persistir parecer com recibo e missão pronta juntos. Antes da mudança, o terceiro argumento é ignorado e a missão permanece sem readyAt.
2. Testar recusa de helper, escopo result, veredito não aceito, resumo vazio, parecer inválido, inspeção antiga, fonte/contrato alterado e trabalho pendente. Nenhuma recusa pode acrescentar conclusão ou parecer final.
3. Adicionar `VerificationRecord.completion?: {readyAt, summary, eventId}`. `Store.saveVerification` recebe resumo opcional, valida escopo/veredito, detecta repetição/conflito e grava tudo em sua transação existente. Falha de disco reverte todas as projeções; o recibo não é inventado na migração.
4. Extrair a consulta de prontidão usada pelo core, preservando `mission_ready` e sua semântica antiga de dispensa explícita. No combinado, candidato de integração só entra após validação de identidade, fonte, contrato, checks e critérios; recusar qualquer pendência e não aceitar force.
5. Notificar UI após commit. Usar eventId estável para a memória de projeto na opção combinada, evitando duplicação em replay. Evento ready já fica no mesmo snapshot; broadcast não é o recibo durável.
6. Testar commit no disco, rollback por `state.json.tmp` indisponível, replay com mesmo ID/readyAt/evento e conflito de resumo. Testar o tool MCP real. Rodar regressões, suíte completa, tipos e build.
7. Só depois executar as mesmas tarefas `bug-mean` e `bug-pagination`, esta com SIGKILL/retomada. Manter 1.500.000 tokens e US$ 0,15 Claude conhecido por missão, seis minutos por fase, `claude-haiku-5-5` e `gpt-6-luna`, low, sem modelo fallback. Reter falhas e contagem cumulativa de retomada. Não ampliar após resultado ruim.
