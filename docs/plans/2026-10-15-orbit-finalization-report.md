# Conclusão conjunta e piloto bidirecional — 15/10/2026

**Os dois fluxos nativos passaram nesta rodada, incluindo os gates funcionais, a conclusão conjunta e o orçamento.** A missão inversa passou também pela interrupção real, retomada, confirmação de identidade e replay sem duplicar contadores. A margem de orçamento inversa foi de apenas **9.006 tokens**; não é prova de consumo estável ou de economia geral.

Implementação no código e no build debug local, sem instalar sobre o aplicativo em uso. [Plano](2026-10-15-orbit-finalization.md) · [Observações nativas](2026-10-15-orbit-finalization-evidence/native-observations.json) · [Validação local](2026-10-15-orbit-finalization-evidence/validation.json).

## Mudança implementada

`verification_submit` aceita agora o campo opcional **`readySummary`**. Somente o líder pode usá-lo, no aceite de uma inspeção de integração. O core verifica identidade, execução/atribuição, resultado atual, fonte, contratos, checks, critérios e prontidão; o caminho combinado não admite dispensa por `force`.

O Store grava **parecer final, readyAt/readySummary e evento `mission.ready` no mesmo commit** da transação existente. O parecer guarda `completion: { readyAt, summary, eventId }`. Repetir a mesma operação devolve o mesmo recibo, sem novo evento ou novo timestamp de conclusão. Um resumo conflitante exige outra inspeção; uma falha de disco reverte todas essas projeções.

As notificações à interface ocorrem depois do commit. A entrada da memória do projeto usa o eventId estável: um replay pode reparar essa projeção se ela falhar, sem duplicar a conclusão. A memória não integra a transação primária; o teste de falha explicita essa separação e comprova a reparação.

Os gates de prontidão são compartilhados com `mission_ready`. O tool separado continua disponível e sua dispensa explícita conserva a semântica anterior. Sem `readySummary`, uma revisão comum continua com o comportamento antigo. Os prompts orientam a não repetir `mission_ready` quando já existe recibo de conclusão. O piloto exige que a opção seja realmente exercitada; uma conclusão pelo caminho antigo não recebe aprovação como tratamento desta rodada.

## Evidência que orientou a mudança

No líder Claude da rodada anterior, o aceite final e a chamada posterior de `mission_ready` ocuparam respostas diferentes, com **72.575** e **74.848 tokens de entrada** reportados. Uma resposta textual posterior ainda carregou **75.545**. [Metadados retidos](2026-10-15-orbit-finalization-evidence/baseline-final-turns.json).

Nesta rodada, o líder Claude pediu `readySummary` no aceite final e não chamou `mission_ready` separadamente. Depois ainda atualizou dois cartões e respondeu ao usuário: a opção não elimina toda coordenação posterior nem todo contexto nativo. [Respostas finais e ferramentas](2026-10-15-orbit-finalization-evidence/combined-final-turns.json).

Esses números são uso observado, não uma estimativa contrafactual de economia. A quantidade de comandos, mensagens e comportamento dos modelos variou entre execuções.

## Duas tarefas com CLIs reais

Pins preservados: Claude Code **2.1.296**, modelo `claude-haiku-5-5`; Codex CLI **0.162.1**, modelo `gpt-6-luna`; esforço baixo e perfil Orbit. Node empacotado **24.21.0**. Mesmos corpus, fixtures e critérios de aceite; máximo de 1.500.000 tokens e US$ 0,15 de custo Claude conhecido por missão, seis minutos por fase. Sem aumento de orçamento, fallback ou nova tentativa após o resultado. Fontes/versões estão nos manifests de cada caso; os dois têm a mesma revisão de código.

| Fluxo | Rodada anterior | Nesta rodada | Resultado |
|---|---:|---:|---|
| Codex líder → Claude implementação → Codex revisão (`bug-mean`) | 1.033.874 tokens | **1.173.956** | Aprovado, conclusão conjunta, 3 aberturas |
| Claude líder → Codex implementação → Claude revisão (`bug-pagination`), com SIGKILL/retomada | 1.540.375 tokens | **1.490.994** | Aprovado, conclusão conjunta, identidade/replay aprovados, 5 aberturas |

Ambos registraram duas atividades e duas entregas aceitas, revisão independente pela CLI oposta, recibos confirmados, integração atual e missão pronta. O supervisor abriu apenas missão/líder, observou e executou o oracle; não produziu handoffs, vereditos ou conclusão pelos agentes. Após encerrar os processos, os checks externos confirmaram fixtures intactos e alteração somente no arquivo permitido.

Na missão inversa, o processo foi encerrado por SIGKILL depois do commit durável do resultado e antes do dispatch. A retomada preservou o resultado `eaeb9c08-f124-4f30-9e45-c1fd1a5ccbfe`, sua tentativa e o recibo. As conversas mantiveram os IDs; as execuções receberam epochs novos. Os dois reports antigos acrescentaram zero tokens/custo no replay e os totais ficaram inalterados. A implementação não foi repetida. [Registro normal](2026-10-15-orbit-finalization-evidence/forward-1/initial.json), [registro inverso](2026-10-15-orbit-finalization-evidence/reverse-1/recovered.json).

**A economia geral não foi comprovada.** O inverso caiu 49.381 tokens; o normal aumentou 140.082. O total da rodada foi **2.664.950 tokens**, acima dos 2.574.249 anteriores. O subtotal Claude conhecido foi **US$ 0,035431**; custo completo permanece `null`, pois Codex não informa USD. A contagem inversa é cumulativa e não foi somada duas vezes. Valores monetários dos CLIs não são uma fatura.

O caso inverso terminou apenas 9.006 tokens abaixo do teto. Uma única amostra não demonstra confiabilidade econômica; reports assíncronos ainda podem refletir trabalho já em voo. Não elevar o orçamento para transformar reprovação em aprovação.

## Qualidade e limites observados

O texto livre do resumo inverso contém uma frase contraditória: diz código 0 antes/depois, mas no mesmo trecho reconhece a falha anterior. A evidência externa é **exit 1 antes e exit 0 depois**, conforme manifest inicial e oracle final. O registro do agente foi preservado; este relatório usa as observações estruturadas e os checks externos, sem promover o texto livre a prova. A qualidade dos resumos ainda exige atenção.

Os resultados cobrem duas correções pequenas, não o uso diário inteiro, um repositório grande ou estabilidade em muitas execuções. A aprovação desta rodada fecha o cenário limitado descrito; não certifica todas as interrupções, providers, versões ou comportamentos de um modelo.

## Verificação local

| Comando | Resultado | Evidência |
|---|---|---|
| `apps/desktop/build/node/node --test --test-timeout=20000 'packages/sidecar/test/**/*.test.ts' scripts/lib/autonomy-observations.test.mjs` | 213/213 (209 motor + 4 supervisor), exit 0 | [Log](2026-10-15-orbit-finalization-evidence/tests.log) |
| Testes desktop | 6/6, exit 0 | [Log](2026-10-15-orbit-finalization-evidence/desktop-tests.log) |
| MCP final, incluindo mensagens WebSocket da conclusão | 3/3, exit 0; mesmos casos já contados na suíte | [Log](2026-10-15-orbit-finalization-evidence/mcp-final.log) |
| `npm run typecheck` | Sem erros, exit 0 | [Log](2026-10-15-orbit-finalization-evidence/typecheck.log) |
| Build Tauri debug | Bundle macOS **167,64 MiB**, exit 0 | [Log](2026-10-15-orbit-finalization-evidence/build.log) |
| `git diff --check` | Sem erros, exit 0 | [Log](2026-10-15-orbit-finalization-evidence/diff-check.log) |

O teste vermelho inicial falhou por ausência de conclusão conjunta e recusa dos novos casos; logs foram conservados. Testes verdes cobrem commit no disco, replay, resumo conflitante, fonte/contrato/execução alterados, pendência, ator/escopo/veredito incorretos, evidência incompleta, rollback do snapshot e reparação de memória. O MCP autenticado confirma também a recepção de `mission.updated` e do evento pronto pelo cliente WebSocket.

O build terminou antes da suíte que usa seu Node, e o sidecar no `.app` corresponde por hash ao artefato construído. O aviso conhecido de chunk JS acima de 500 kB permanece. Não houve instalação, commit, push ou publicação; as evidências anteriores permanecem intactas.

Os hashes atuais das fontes conferem com ambos os manifests nativos. Os [PIDs próprios retidos foram conferidos como encerrados](2026-10-15-orbit-finalization-evidence/process-cleanup.json), sem varrer ou encerrar processos pessoais.

## Próxima barreira de prontidão

O cenário bidirecional limitado passou pela primeira vez nesta sequência de validações com orçamento, conclusão conjunta e recuperação auditada. O build é candidato a avaliação supervisionada. Para confiar nele como ambiente principal de uso amplo, ainda faltam margem econômica consistente, estabilidade em tarefas consecutivas de um repositório real maior e melhor fidelidade dos resumos apresentados ao usuário.
