# Harness — telemetria nativa e política durável

Implementação em 16/10/2026. Continuação do [plano adaptativo](../plans/2026-10-16-orbit-adaptive-harness.md) e do [lote de evidência nativa](../plans/2026-10-16-orbit-harness-native-evidence.md).

## Implementado

- **Codex:** leitor incremental do rollout completo da sessão resolvida pelo motor. Verifica identidade da sessão, contadores, arquivo parcial, truncamento/substituição, troca de modelo/esforço e subagentes nativos. Guarda os modelos e esforços observados e distingue `execution-context` de identidade servida. A cauda continua servindo para eventos de turno, mas não certifica consumo completo quando o leitor não o consegue.
- **Claude:** conserva o modelo observado no transcript também no caminho do status hook. Registra `effort.level` informado pelo status vivo, mantém o conjunto de esforços observados e impede que uma sessão com esforços diferentes seja atribuída a um só candidato. Campo ausente continua desconhecido; o esforço pedido no lançamento não substitui o observado.
- **Consumo por tentativa:** acumulação transacional do delta já contabilizado, sem repetição de cobrança. Um snapshot completo pode recuperar o primeiro status que só tinha custo. Épocas diferentes e observação incompatível invalidam a certificação. Entradas/saídas/cache conhecidos são preservados separadamente, sem inventar USD por tentativa.
- **Journal de benchmark:** reserva durável antes de cada execução, resultados idempotentes, conflito de replay recusado e células incompletas visíveis. API interna no Store; não existe rota de importação/promoção no MCP ou no protocolo da UI.
- **Promoção:** matriz completa e live, oracle presente, identidade/consumo confirmados, calibração e holdout separados, restrições do compilador preservadas, cobertura e qualidade estatística suficientes. O manifesto não pode rebaixar o piso de qualidade ou remover a revisão obrigatória.
- **Runtime:** hash integral do código do motor/protocolo/hooks/recursos e Node em desenvolvimento; no bundle, hash do artefato compilado e hooks/recursos. Arquivo ausente, tipo inesperado ou mudança durante leitura desabilitam a promoção. O código é conferido novamente antes de operações de benchmark e de usar uma política ativa; alteração exige reinício/nova evidência compatível.
- **Reversão:** ativação e rollback são transacionais e auditados. Uma promoção malsucedida mantém a política anterior. Rollback pode restaurar a política anterior qualificada, sem reativar uma matriz retirada. Mudança no resultado promovido invalida seu digest.
- **Coordenador executável:** reserva antes do callback de execução, conserva falha de infraestrutura com consumo desconhecido e não reenvia uma célula herdada sem conclusão após reinício. A duração dessa interrupção usa tempo de parede desde a reserva, incluindo a parada. Não é latência do modelo.
- **Piloto offline:** `node scripts/bench-routing.mjs --offline-pilot` executa duas tarefas públicas sintéticas com oracle local, persiste o journal, reabre o Store e confirma que nenhuma observação simulada foi promovida. `--report arquivo.json` continua apenas avaliando o relatório, sem importação no estado real.

## Fronteira de identidade

A [documentação oficial da status line Claude](https://code.claude.com/docs/en/statusline) informa que `effort.level` reflete o valor vivo, inclusive mudanças por `/effort`. Isso permite registrá-lo; não prova que o valor atual foi usado em todas as respostas anteriores. O motor mantém essa lacuna explícita.

O [protocolo oficial Codex](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs), em `TurnContextItem`, expõe `model` e `effort`. O schema gerado localmente pelo Codex 0.162.1 também avisa que o esforço persistido de uma thread não é telemetria por turno. O leitor usa o contexto por turno e o classifica como configuração observada da CLI, sem inventar confirmação da identidade interna do provedor.

Consequentemente, a política exige `level=response` com modelo e esforço completos para promoção. As observações atuais de contexto Codex ou esforço vivo isolado do Claude não passam sozinhas por esse gate. A infraestrutura de promoção está implementada e testada; **nenhuma política aprendida foi ativada no perfil real nesta rodada**.

## Validação

- Testes específicos cobrem mudança de identidade, parcial/truncado, replay, consumo recuperável, integração dos leitores no core, ausência de oracle, tentativa de afrouxar invariantes, reinício, falha de disco e reversão.
- Suíte completa do motor: **260/260**, exit 0; [log](2026-10-16-harness-native-evidence-tests.log).
- Typecheck dos workspaces: exit 0; [log](2026-10-16-harness-native-evidence-typecheck.log).
- Desktop: **22/22**, exit 0; [log](2026-10-16-harness-native-evidence-desktop.log).
- Empacotamento do sidecar: exit 0; [log](2026-10-16-harness-native-evidence-build.log).
- Piloto com journal: **2/2** tarefas sintéticas passaram, zero chamadas de modelo e zero observações promovidas; [resultado](2026-10-16-harness-native-evidence-pilot.json).

## Pendências e escopo

O executor nativo ainda precisa correlacionar cada resposta com modelo/esforço observado e agregar o gasto de worker, reviewer e chamadas auxiliares; os adapters não transformam configuração solicitada em identidade servida. A nova interface do coordenador recebe um executor confiável em código, não um JSON externo. Isso é uma fronteira da aplicação, não uma defesa criptográfica contra código Node arbitrário executado pelo mesmo usuário do Mac.

Continuam pendentes o piloto nativo de duas tarefas quando houver capacidade e identidade suficiente, a calibração/holdout com cobertura estatística e os gates de inicialização/sandbox/recuperação do ORBIT 10. A última leitura do Claude, na rodada anterior deste mesmo dia, foi 93% semanal usado; não executei novas tarefas de modelo nesta rodada.

App instalado, credenciais e sessões reais preservados. O código foi implementado no workspace; nenhuma instalação ou publicação foi feita. Não há alegação de economia de tokens nem de confiabilidade universal.
