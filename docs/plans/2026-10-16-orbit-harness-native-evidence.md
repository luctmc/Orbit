# Harness: observação nativa e promoção durável

**Goal:** registrar a configuração efetiva observada nas CLIs e permitir promoção/reversão de benchmarks produzidos pelo coordenador confiável, sem transformar JSON externo ou histórico comum em evidência certificada.
**Architecture:** leitores de transcript/rollout preservam identidade, origem e lacunas. Um journal transacional no Store reserva cada célula antes de executá-la e conclui a matriz somente com todos os resultados. A política ativa fica vinculada ao conteúdo do runtime; seleção continua subordinada ao catálogo, conta e restrições atuais.
**Stack:** TypeScript/Node 24, Store e corpus existentes; sem pacote adicional.

## Restrições

- Configuração reportada pelo turno não prova a identidade interna do backend. Preservar explicitamente essa distinção. Esforço ausente no Claude continua desconhecido.
- Nenhum campo enviado pelo agente em handoff cria telemetria nem promove política. Não expor importação/promoção por MCP.
- Sem chamadas nativas nesta rodada enquanto o Claude estiver acima da margem de admissão; usar o runner offline e manter live separado.
- Não modificar app instalado, credenciais ou trabalhos existentes. Não publicar nem fazer commit desta árvore compartilhada.
- Reserva pendente, falha, ausência de consumo, identidade incompatível e oracle ausente não podem desaparecer do denominador.
- Promoção exige matriz completa, holdout, cobertura, qualidade e runtime atual. Estado vazio/antigo é fallback; rollback é persistido e auditável.

## Mapa

| Arquivo | Responsabilidade |
|---|---|
| `packages/sidecar/src/adapters/codexUsage.ts` | Leitura incremental do rollout próprio: contexto por turno, consumo, identidade configurada e lacunas. |
| `packages/sidecar/src/core.ts` | Alimentar telemetria por arquivo resolvido e usar somente política ativa do runtime. |
| `packages/sidecar/src/harnessEvidence.ts` | Preservar origem/nível de identidade e consumo da tentativa sem inferir identidade servida. |
| `packages/sidecar/src/store.ts` | Journal atômico de células, telemetria e promoção/rollback. |
| `packages/sidecar/src/benchmarks/harnessPolicy.ts` | Transições puras e gates de promoção. |
| `packages/sidecar/src/harnessRuntime.ts` | Hash integral dos arquivos do runtime e Node; desconhecido bloqueia promoção. |
| `packages/sidecar/src/benchmarks/harnessRunner.ts` | Coordenador de células e recuperação sem repetir chamada ambígua. |
| `packages/sidecar/src/benchmarks/harnessOffline.ts` | Produtor funcional com duas tarefas sintéticas e oracle local. |
| `packages/sidecar/test/codexUsageSource.test.ts` | Mudança de modelo/esforço, retomada, truncamento, duplicação e arquivo parcial. |
| `packages/sidecar/test/harnessPolicy.test.ts` | Células incompletas, replay, conflitos, runtime diferente, reinício e rollback. |
| `packages/sidecar/test/harnessEvidence.test.ts` | Consumo recuperável, identidade parcial e replay atômico. |
| `docs/analysis/2026-10-16-harness-native-evidence.md` | Evidência da rodada e limitações exatas. |

## Execução e gates

1. Teste vermelho do leitor Codex: contexto `model/effort`, `token_count`, arquivo incompleto e troca de contexto. Implementar leitor incremental limitado e conferir as fixtures contra o protocolo oficial; nunca usar só a cauda para certificar toda a sessão.
2. Teste vermelho do Store: contador de custo sem tokens antes de snapshot completo não deve envenenar o consumo para sempre; nova época/ambiguidade continuam sem certificação. Preservar modelos Claude também no caminho do status hook.
3. Teste vermelho do journal: reservar célula, salvar resultado idempotente, rejeitar conflito e matriz incompleta. Promoção por identidade/qualidade/runtime deve falhar de forma conservadora; simulação não promove.
4. Persistir journal e transições na transação existente. Reabrir Store, repetir operação, simular falha de disco e conferir política anterior intacta.
5. Ligar a leitura da política ativa ao spawn sem permitir JSON arbitrário, exigir revisão atual do runtime e invalidar naturalmente após mudança de versão/catálogo.
6. Rodar suites específicas, suíte completa e typecheck; empacotar sidecar. Registrar limites, inclusive os campos que o provedor ainda não confirma. App instalado permanece fora deste lote.


## Resultado do lote

Leitor Codex e status Claude integrados ao motor; consumo por tentativa recuperável; journal, promoção e rollback transacionais; runtime integral vinculado à política e runner offline executável implementados. Cobertura e limitações: [relatório](../analysis/2026-10-16-harness-native-evidence.md).

Configuração por turno Codex e esforço vivo do Claude são observados. A correlação completa por resposta/identidade servida ainda é um gate nativo, por isso não há ativação aprendida no perfil real. Não declarar essa parte concluída nem usar a simulação como certificado de modelo.
