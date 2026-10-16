# Orbit: harness adaptativo baseado em evidência

**Goal:** compor a estratégia de cada atividade e escolher modelo/esforço por resultados comparáveis, preservando as restrições do usuário e mantendo fallback explícito quando faltam dados.
**Architecture:** o motor existente continua dono de atividade, tentativa, revisão, conta e lease. Um compilador puro monta módulos de execução por necessidades/risco; uma política local compara candidatos do catálogo e observações versionadas. A decisão é persistida junto da tentativa, aplicada ao lançamento e explicada ao líder e na UI. Nenhum LLM extra é necessário para pontuar candidatos.
**Stack:** TypeScript/Node >=24.11, adapters Claude/Codex existentes, MCP e React existentes; sem dependência nova de framework.

## Global constraints

- Referências e evidência upstream: [pesquisa GitHub](../analysis/2026-10-16-harness-github-research.md). Aproveitar os mecanismos de Deep Agents, Symphony e Harbor; não importar suas alegações de qualidade/economia.
- Não alterar solicitações explícitas de CLI, modelo, esforço, squad, orçamento, ferramentas, skills ou somente leitura.
- “Aprender” não autoriza relaxar permissão, revisão independente, origem/freshness da evidência nem serialização de writers.
- Nunca usar resultado simulado, ausência de consumo ou ausência de revisão como sucesso medido.
- Observações de outra versão de CLI, catálogo, política, estratégia ou estrato de tarefa não certificam o candidato atual.
- O modo frio compõe a estratégia e conserva o assento de fallback; não inventa ranking de modelos.
- Troca de estratégia em uma nova tentativa mantém atividade/aceite e exige término confirmado do writer anterior. Não alterar silenciosamente uma conversa viva.
- Modelos de custo desconhecido continuam com USD desconhecido. Tokens e latência não são uma cotação financeira.
- Mudanças aditivas de estado têm defaults conservadores e tolerância a estado antigo; revisões/falhas de persistência precisam ser transacionais.
- Benchmark real inicial mantém o escopo econômico anterior de duas tarefas. Usar corpus sintético/publicável; não enviar snapshot privado do Orbit como substituto de consentimento.
- Não substituir o app instalado antes de concluir os gates da rodada. A demora de inicialização observada continua um gate de prontidão separado.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/protocol/src/index.ts` | Contrato serializável de estratégia e recibo adaptativo; campos opcionais para compatibilidade. |
| `packages/sidecar/src/harness.ts` | Composição pura de módulos, identidade de candidato, qualificação estatística e seleção por evidência. |
| `packages/sidecar/src/harnessEvidence.ts` | Validação e projeção das observações duráveis; falhas e rejeições incluídas. |
| `packages/sidecar/src/store.ts` | Persistência atômica das observações/proveniência; idempotência e revisão rejeitada não anulável. |
| `packages/sidecar/src/core.ts` | Catálogo/contas como restrições, aplicação da decisão no spawn, contexto do agente e registro de resultados. |
| `packages/sidecar/src/prompts.ts` | Instrução curta para seguir a estratégia recebida e adaptar mediante evidência, sem inventar capacidade. |
| `packages/sidecar/src/maestro.ts` | Evitar rebaixamento por heurística fraca e nunca tratar quota velha como saldo renovado. |
| `packages/sidecar/src/benchmarks/harnessMatrix.ts` | Comparação estratificada de modelo × esforço × estratégia, sem misturar dados simulados/live nem ocultar falhas. |
| `scripts/bench-routing.mjs` | Runner/relatório offline por padrão; live explicitamente limitado ao corpus aprovado e aos limites disponíveis. |
| `apps/desktop/src/components/MissionProgress.tsx` | Explicação da estratégia, origem da decisão e insuficiência de amostra. |
| `packages/sidecar/test/harness.test.ts` | Testes puros de composição, restrições, cold start, estatística, custos desconhecidos e mudança de versão. |
| `packages/sidecar/test/harnessIntegration.test.ts` | Spawn/recibo/contexto/resultado persistido com CLIs simuladas; sem rede de modelos. |
| `packages/sidecar/test/harnessEvidence.test.ts` | Deduplicação, rejeição, falhas, reconstrução após reinício e rollback. |
| `packages/sidecar/test/benchmarkHarnessMatrix.test.ts` | Comparabilidade, cobertura e verificador separado. |
| `docs/plano-orbit-10.md` | Plano mestre com correções e vínculo da trilha H. |

## H1 — Contrato de estratégia e seleção pura

**Produces:** `composeHarness`, `selectHarnessCandidate`, `harnessCandidateKey`, `HARNESS_POLICY_VERSION`.

- [x] Escrever e executar testes vermelhos antes de criar o módulo.
- [x] Compor módulos obrigatórios de inspeção e evidência, adicionando reprodução por defeito/rejeição, implementação só para writer, revisão por risco e recuperação por tentativa repetida.
- [x] A composição nunca concede ferramenta, escrita, dispensa de revisão nem maior orçamento. Conservar o método customizado como restrição; explicar conflitos em vez de ignorá-lo.
- [x] Qualificar observações somente com identidade/versionamento, consumo medido, resultado independente e estrato compatíveis. Deduplicar a tentativa, incluindo falhas no denominador.
- [x] Exigir suporte amostral e limite inferior de qualidade, não só média; comparar consumo/latência entre candidatos qualificados, com desempate determinístico.
- [x] Dados ausentes, simulados, inválidos, repetidos, expirados ou de outro runtime não mudam o assento. Novos modelos/esforços entram sem ranking presumido.
- [x] Executar a suíte pura e typecheck; revisar limites numéricos e crescimento de estado.

Reprodução mínima antes da implementação:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeHarness, selectHarnessCandidate } from '../src/harness.ts'

test('a cold task receives a composed strategy without a fabricated winner', () => {
  const plan = composeHarness({ kind: 'bug', difficulty: 'normal', readOnly: false, retry: false })
  assert(plan.modules.includes('reproduce'))
  assert(plan.modules.includes('verify'))
  assert.equal(selectHarnessCandidate(plan, [], []).selected, null)
})
```

Comando: `apps/desktop/build/node/node --test packages/sidecar/test/harness.test.ts`. Deve falhar pela ausência do módulo antes da implementação e passar após ela. A implementação completa ficará no módulo e seus testes, sem pseudoimplementação em produção.

## H2 — Evidência durável e fronteira de confiança

**Consumes:** tipos de H1 e verificação/consumo observados no motor. **Produces:** observação idempotente por tentativa e relatório de cobertura.

- [x] Testar que a mesma tentativa/parecer não multiplica amostra, inclusive após reiniciar.
- [x] Um produtor não aceita seu resultado e `changes_required` não vira sucesso por um segundo parecer sobre o mesmo resultado. O gate também recusa históricos legados com aceite posterior à rejeição.
- [ ] Gravar decisão, versão de CLI, identidade solicitada/observada de modelo, esforço, estratégia, estrato, tempos, consumo e origem da qualidade.
- [ ] Não converter identidade solicitada em identidade servida. Quando o adapter não confirma modelo/esforço ou consumo por tentativa, registrar a lacuna e não promover o registro a benchmark comparável.
- [x] Persistir falha/sem revisão como não certificado; um campo autodeclarado no handoff não cria uma observação confiável.
- [x] Evidência projetada a partir do mesmo snapshot atômico de consumo, tentativa e revisão; testar falha de disco e rollback. Não manter uma segunda cópia de veredictos que possa divergir.

## H3 — Decisão efetivamente aplicada e explicada

**Consumes:** H1/H2, catálogo atual e restrições da missão. **Produces:** nova tentativa com `DecisionReceipt.harness` e instrução de estratégia.

- [x] Candidatos vêm do catálogo atual, incluindo esforços suportados, não de uma lista fixa de nomes recomendados.
- [x] Filtrar CLI instalada/autenticada, assinatura com limite atual, missão, sandbox requerido e escolhas explícitas antes de pontuar.
- [x] Nenhum candidato habilita API paga por conveniência, altera `onlySkills` ou substitui escolha explícita.
- [x] Aplicar o par selecionado uma vez, sem o balanceamento/tier posterior desfazê-lo silenciosamente. O recibo sempre representa o lançamento efetivo.
- [x] Injetar somente os módulos necessários e referências curtas às evidências; preservar instruções e contratos obrigatórios.
- [x] Em cold start ou dados incompatíveis, informar fallback e sua causa. O histórico ganha observações passivas, sem promoção automática a holdout. A ingestão de benchmark confiável ainda depende do gate H4; os testes de escolha medida injetam dados exclusivamente na fixture.
- [x] Expor estratégia e cobertura junto do recibo já visível em Progresso; medir tamanho para evitar novo crescimento de prompt.

## H4 — Matriz de benchmark e gates de promoção

**Consumes:** configuração versionada e corpus com oracle independente. **Produces:** relatório comparável; nenhum resultado offline autoriza ranking live.

- [ ] Fixar task/corpus/source checksum, política, estratégia, CLI/versão, modelo solicitado/observado e esforço.
- [x] Separar conjuntos de calibração e holdout; rejeitar matriz que use o mesmo caso ou checksum dos dois lados ou omita configurações/falhas.
- [ ] Registrar tokens de entrada/saída/cache, latência, custo conhecido/desconhecido, revisão, retrabalho e tentativas. Falha de infraestrutura é uma classe própria e não pode sumir do gasto.
- [ ] Comparar qualificação, consumo e tempo de configurações equivalentes; duas tarefas são piloto funcional, não amostra suficiente para declarar superioridade.
- [ ] Executar fluxo completo local com CLIs falsas; só depois piloto nativo econômico em corpus publicável, se os limites das contas permitirem.
- [ ] Salvar resultado como observado, não “aprovado” quando faltar identidade, oracle ou cobertura. Publicar relatório com limites da inferência.

## H5 — Recuperação adaptativa segura

Nova tentativa é uma transição durável, não um retry de prompt sem controle. Rejeição, timeout, falta de ferramenta e quota têm sinais distintos. Cada proposta indica a evidência e quais componentes da estratégia mudariam; nunca eleva permissão ou ultrapassa teto. A abertura substituta exige término confirmado, lease liberado, idempotência, número máximo de tentativas e preservação do contrato. Implementar depois dos gates de ciclo de vida V e da separação de cooldown/quota R2.

## Gates para uso cotidiano

1. Typecheck e todas as suítes locais passam, incluindo testes vermelhos antes de cada correção.
2. Composição/seleção/resultado/recibo atravessam o motor real com CLIs simuladas e sobrevivem a reinício.
3. Nenhum dado simulado ou incompleto muda automaticamente um lançamento real.
4. Política não torna uma conta saturada mais disponível quando refresh falha.
5. Código revisado corresponde ao conteúdo entregue; hashes parciais não autorizam aceite completo.
6. A UI conecta ao motor sem esperar retomadas ou varreduras lentas, com erro/progresso e recuperação visíveis.
7. Piloto nativo tem oracle independente, orçamento e identidade observada; o app instalado passa smoke no perfil normal.
8. Antes de declarar economia ou ganho de qualidade, completar matriz comparável e amostra adequada. Antes de promover política, executar holdout e preservar rollback.

## Estado de execução

- Pesquisa de fontes, código e CI: concluída; cinco verificações upstream locais passaram.
- Revisão das propostas inseguras do plano mestre: aplicada ao documento, ainda sem alegação de correção em produção.
- H1–H4: execução autorizada nesta conversa; registrar aqui evidência conforme os gates forem concluídos.
- H5 e os gates V/R continuam necessários; não declarar o Orbit certificado por concluir apenas a camada de seleção.


### Lote implementado em 16/10/2026

- H1: compilador puro + seleção conservadora por cobertura, Wilson 95%, coortes versionadas, holdout e casos correspondentes. Piso de 30 tentativas, dez tarefas e dois projetos por configuração; alto risco exige limite inferior de 95%. Esses limiares são a política inicial explícita, não uma garantia universal.
- H2 parcial: histórico e consumo por tentativa duráveis, delta idempotente na transação existente, modelos Claude observados retidos e USD desconhecido preservado. Projeção inclui rejeição/falha/ausência de revisão e sobrevive a reinício/rollback. A identidade servida de modelo **e esforço** ainda não é confirmada ponta a ponta pelos adapters; por isso os registros correntes não certificam ranking.
- H3: estratégia entregue ao agente, recibo persistido e UI com etapas/motivo. Escolha qualificada não é desfeita por tier/balanceamento; isso foi verificado com dados injetados apenas em teste. Admissão adaptativa exige catálogo nativo, CLI instalada, login observado e ambas as quotas de assinatura atuais abaixo de 85%; API paga não entra como conveniência.
- H4 parcial: avaliador e CLI `node scripts/bench-routing.mjs --report arquivo.json`. Valida matriz fechada/checksums/partições/repetições, inclui gastos de falhas e mantém dados offline fora da promoção. **Não executa modelos nem importa relatórios arbitrários para o estado do Orbit.** Ainda falta o produtor/runner nativo confiável e o gate durável de promoção/rollback vinculado à revisão atual do runtime.
- Prompt do líder atualizado para distinguir benchmark qualificado de regra conservadora e seguir o contrato de revisão. Bloco adicional de estratégia: 588–681 bytes nos seis casos de sondagem; seleção local faz zero chamadas de modelo. Isso não é medição de economia de tokens.
- V1: proteção aplicada em `Store.saveVerification` e `OrbitCore.acceptedResult`; testes vermelhos reproduziram tanto novo aceite após rejeição quanto histórico legado contraditório.

### Próximos gates obrigatórios

1. Confirmar identidade de modelo/esforço e consumo por tentativa nos adapters nativos, incluindo retomada, troca de modelo e subagentes nativos. Dados incompletos continuam sem qualificação.
2. Ligar o runner nativo versionado ao produtor confiável de benchmarks, com oracle protegido e registros duráveis de promoção/rollback. Histórico cotidiano não vira holdout por renomeação.
3. Executar o piloto econômico de duas tarefas e registrar resultado real. Na checagem desta rodada, Claude estava com **93% semanal usado**, acima da margem de 85%, e a janela curta não foi parseada; Codex informou 42% usado na janela curta e 68% semanal. Nenhuma tarefa de modelo foi enviada nesta rodada.
4. Resolver os gates V/R restantes e a inicialização lenta antes de substituir o app instalado ou declarar prontidão cotidiana. O app em `/Applications` não foi atualizado nesta rodada.

Validação e limites detalhados: [relatório de implementação](../analysis/2026-10-16-adaptive-harness-implementation.md).


### Continuação: evidência nativa e política durável

[Segundo lote implementado](2026-10-16-orbit-harness-native-evidence.md): Codex com contexto do turno e consumo incremental integral; Claude com esforço vivo/alterações preservados; journal de células e coordenador offline; promoção/rollback transacionais ligados ao Store e à seleção do spawn; hash integral do runtime e invariantes de manifesto.

H2/H4 avançaram, mas identidade servida e correlação de esforço por resposta permanecem sem certificação nativa completa. Nenhuma observação simulada promoveu política e nenhuma matriz aprendida foi ativada no perfil real. O executor nativo e os gates de uso cotidiano continuam pendentes. [Evidências e limites](../analysis/2026-10-16-harness-native-evidence.md).
