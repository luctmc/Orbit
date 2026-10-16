# Coordenação econômica e auditoria de retomada

**Goal:** reduzir consultas repetidas após uma entrega e validar a auditoria quando o líder fecha os helpers.
**Architecture:** estender `delivery_ack` com leitura opcional e limitada do resultado/atividade, mantendo autorização e recibo existentes. Explicitar a diferença entre dependência de implementação e alvo de revisão. Exercitar a auditoria com Store e PTYs reais, usando agentes simulados e nenhum modelo.
**Stack:** TypeScript/Node 24, MCP, ledger e fixtures existentes.

## Restrições

- Preservar alterações anteriores, fontes e relatórios imutáveis dos pilotos.
- Implementação e regressões sem chamadas a modelos. Após os checks locais, repetir somente as mesmas duas tarefas do piloto econômico autorizado, com os mesmos pins/limites; sem ampliar corpus, repetir automaticamente após falha ou aumentar orçamento. Sem instalação, publicação ou mudança de configuração global.
- Recibo não aceita código. Inspeção, revisão independente e integração atual continuam obrigatórias.
- `dependsOn` continua exigindo resultado aceito; nunca apagar uma dependência silenciosamente.
- O caminho antigo de `delivery_ack` continua compatível.
- Executar build antes dos testes no Node empacotado, porque o build recria esse executável.

## Diagnóstico

As duas últimas missões tentaram usar `dependsOn` ao abrir a revisão do próprio resultado ainda não aceito. O core recusou corretamente (`acceptedResult`); a orientação não explica esse ciclo. No transcript inverso houve duas confirmações de recibo, duas consultas `handoff_list`, uma `activity_status` e uma leitura inicial de briefing. O ACK devolve o aviso, mas não os critérios e a identidade atual do resultado que o líder procura nas demais consultas.

O supervisor anterior perdia panes fechados antes da auditoria final. A retenção local já foi adicionada, mas só foi testada com objetos isolados. Falta exercitar seu consumo pela auditoria e pelo Store após reabertura e fechamento reais de PTYs simulados.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/sidecar/src/core.ts` | ACK com contexto opcional; consultas sem aceitar ou reinspecionar código |
| `packages/sidecar/src/mcp.ts` | Campo opcional `includeResult` e explicação de `dependsOn` |
| `packages/sidecar/src/prompts.ts` | Orientar ACK completo e revisão sem dependência circular |
| `packages/sidecar/test/deliveryContext.test.ts` | Autorização, identidade histórica/atual, limites, ausência de aceite implícito |
| `packages/sidecar/test/mcp.test.ts` | Exercitar o campo no transporte MCP real |
| `scripts/lib/autonomy-observations.mjs` | Auditoria de identidade/replay reutilizável, sem inferência pelo checkpoint |
| `scripts/lib/autonomy-observations.test.mjs` | Casos negativos e integração com Store/PTYs simulados |
| `scripts/verify-autonomous-harness.mjs` | Consumir a auditoria testada e a orientação atualizada |
| `docs/plans/2026-10-15-orbit-coordination-report.md` | Evidências, redução de consultas reproduzida e limites de prontidão |

## Execução inline autorizada

1. Escrever teste: `acknowledgeDelivery(lead,id,true)` deve devolver o mesmo recibo e contexto limitado com resultado, tentativa, critérios e estado da atividade; o caminho atual falha por não conter contexto. Rodar `apps/desktop/build/node/node --test packages/sidecar/test/deliveryContext.test.ts` e preservar a falha.
2. Implementar contexto opcional: resumo até 2.000 caracteres, evidência até 4.000 e detalhes até 2.000, sinalizando cortes e consulta de detalhe. Critérios completos, sem snapshots de terminal, tokens privados ou source scan. Resultado antigo é identificado como histórico, sem receber critérios novos como se fossem seus. Não alterar atividade, revisão ou aceite.
3. Cobrir destinatário/epoch incorreto, repetição após fechamento e resultado substituído. MCP com `includeResult: true` deve fornecer o mesmo resultado; omitir o campo deve manter resposta anterior.
4. Orientar o líder a usar o contexto do ACK em vez de consultar estado já fornecido e explicar: uma revisão recebe o resultId no briefing e não usa `dependsOn` para exigir seu próprio aceite. Dependências reais continuam no gate atual. Verificação exige todos os campos de evidência não vazios; não adicionar dados fabricados ou submissão automática.
5. Extrair a auditoria atual sem relaxar identidades ou comparar contra o checkpoint como fallback. Testar retenção após fechamento e replay zero com Store real, sem modelos. Identidade ausente/diferente ou epoch antigo deve continuar reprovando.
6. Rodar regressões relevantes e suíte completa, tipagem e build. Registrar bytes do cenário de consulta como bytes, sem converter em tokens. Só depois repetir as mesmas tarefas `bug-mean` e `bug-pagination`, a segunda com interrupção durável, em diretórios novos; manter 1.500.000 tokens/US$ 0,15 Claude por missão, `claude-haiku-5-5`/`gpt-6-luna` e esforço baixo. Não transformar testes simulados ou uma amostra nativa pequena em certificação de uso diário.

Sem commit/push nesta fatia; a árvore contém trabalho anterior não commitado.
