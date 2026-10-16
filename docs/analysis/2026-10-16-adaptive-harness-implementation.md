# Orbit — implementação inicial do harness adaptativo

Data: 16/10/2026. [Plano de execução](../plans/2026-10-16-orbit-adaptive-harness.md) · [pesquisa GitHub e CI](2026-10-16-harness-github-research.md).

## Resultado desta rodada

O motor agora compõe e entrega uma estratégia de execução por atividade e registra a justificativa junto da tentativa. A composição usa necessidades observáveis: tarefa, risco, somente leitura, repetição e restrições. O prompt do líder explica a diferença entre uma escolha por benchmark e a regra conservadora. A UI mostra as etapas e a insuficiência de dados.

O seletor de modelo/esforço está implementado e ligado ao lançamento, com testes de aplicação efetiva, mas **a promoção de uma política aprendida ainda não está ativada no uso normal**. O histórico corrente é passivo; não vira holdout. Faltam observação nativa completa da identidade/consumo, runner confiável de benchmark e promoção/rollback duráveis. Nenhum teste simulado foi inserido no estado real para aparentar aprendizado.

## Mudanças verificáveis

- `packages/sidecar/src/harness.ts`: composição de inspeção, reprodução, implementação, revisão, verificação, entrega e recuperação. A política é código explícito e versionado; não é aprendizado irrestrito de novos algoritmos de coordenação.
- A seleção recebe pares de modelo/esforço do catálogo, exige 30 tentativas, dez tarefas, dois projetos, evidência live de holdout, versões e mesmos casos comparáveis. Usa o limite inferior Wilson a 95% antes de ordenar tokens/latência. Dados inválidos ou contraditórios fazem a comparação falhar de forma conservadora. Alto risco exige limite inferior de qualidade de 95%; os demais estratos usam 85%. Isso é uma política inicial, não prova de confiabilidade universal.
- `harnessEligibility.ts`: admissão adaptativa exige assinatura autenticada, catálogo nativo, CLI instalada, ambas as quotas atuais do provedor abaixo de 85%, sem erro de refresh, e compatibilidade com missão/sandbox. Escolhas explícitas continuam preservadas. Estes filtros não substituem as correções R ainda pendentes no fallback legado.
- `harnessEvidence.ts` e `Store`: consumo e revisão fazem parte do mesmo snapshot transacional; a projeção não duplica a amostra nem diverge em falha de disco. Valores desconhecidos continuam desconhecidos. Modelos informados pelo transcript Claude são retidos; a identidade de modelo/esforço não é presumida a partir da solicitação. A projeção usa mapas para não fazer busca quadrática por atividade.
- `core.ts`: aplica uma escolha qualificada uma vez, sem tier/balanceamento posterior desfazê-la; persiste estratégia e assento solicitado efetivo, injeta as instruções no agente e registra origem `benchmark` separada de `rule`. O teste desse caminho usa evidência injetada somente na fixture, com processo simulado.
- V1: um resultado rejeitado exige nova entrega. Outro aceite não apaga a rejeição; a leitura de históricos legados contraditórios também fica inválida. Testes vermelhos reproduziram as duas falhas antes da correção.
- `benchmarks/harnessMatrix.ts` e `scripts/bench-routing.mjs`: avaliação de matriz fechada com checksum de corpus/fonte/oracle, versão da CLI/modelo/esforço, calibração e holdout disjuntos, repetições completas e retenção de falhas. O comando apenas lê/avalia o relatório; não executa modelos nem importa um JSON externo para o ranking do Orbit.
- `MissionProgress.tsx`: detalhes nativos acessíveis com etapas em português, motivo da decisão e separação entre entrega e aceite independente.

## Evidência e limites

- Suíte completa do motor: **243/243**, exit 0 (18 testes novos sobre a base de 225); [log](2026-10-16-adaptive-harness-tests.log).
- Suíte desktop: 22/22, exit 0, [log](2026-10-16-adaptive-harness-desktop-tests.log).
- Typecheck de todos os workspaces: exit 0, [log](2026-10-16-adaptive-harness-typecheck.log).
- Build Vite e empacotamento do sidecar: exit 0, [log](2026-10-16-adaptive-harness-build.log). Permanece o aviso de chunk JavaScript acima de 500 kB; não foi tratado como falha nem resolvido nesta rodada.
- Cinco verificações locais sobre os módulos upstream do Deep Agents passaram, sem rede/modelo. Os CIs consultados são evidência upstream; não certificam o Orbit.
- [Piloto offline](2026-10-16-adaptive-harness-offline/summary.json): duas tarefas (`op-build`, `bug-mean`), dois tratamentos de contexto, quatro execuções aceitas, sem issues. CLIs simuladas e coordenador determinístico; nenhum resultado mede qualidade de modelo ou autonomia de um maestro LLM. O tratamento de contexto não foi exercitado com memória longa neste piloto: nenhuma economia pode ser atribuída a ele. A matriz completa continua incompleta.
- Bloco de estratégia medido em seis combinações: 588–681 bytes UTF-8. Contexto opcional limitado a 1000/2000/4000 bytes conforme a necessidade; contratos obrigatórios preservados. A pontuação local não faz chamadas adicionais de modelo. O classificador anterior pode continuar fazendo sua chamada própria; não foi eliminado nesta rodada. Economia de tokens real: **não estabelecida**.
- Prévia da UI renderizada pelo componente de produção com dados de duas atividades sintéticas; expansão com mouse e Enter conferida. A atividade somente leitura mostrou Inspecionar → Revisar → Verificar → Entregar, sem Implementar. [Captura](2026-10-16-adaptive-harness-ui.png). Não é smoke do app instalado nem validação de todos os tamanhos de tela.

## Piloto nativo adiado por capacidade

Consulta somente de quota/versão, sem tarefa de modelo: Claude Code 2.1.296 informou **93% semanal usado**, renovação 18/10 às 20:59 em São Paulo; a janela de cinco horas não foi parseada nessa resposta. Codex CLI 0.162.1 informou **42% usado em cinco horas e 68% semanal**. A ausência da janela curta não foi convertida em 0% de uso. Com Claude acima da margem de admissão, não executei o piloto comparativo nativo nesta rodada.

## Estado de entrega

Código e documentos foram atualizados no workspace. O app em `/Applications/Orbit.app` foi preservado. Nenhum commit, push, publicação, migração de credenciais ou instalação de framework foi realizado.

A próxima etapa funcional é o produtor de benchmark nativo com identidade observada e gate durável de promoção/rollback. Os gates de inicialização, sandbox/verificação e roteamento V/R do ORBIT 10 continuam necessários antes de declarar o Orbit pronto para uso cotidiano com confiança sustentada. Não há alegação de 100% de confiança.
