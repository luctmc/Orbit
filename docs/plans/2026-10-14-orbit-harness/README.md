# Orbit: evolução do harness e da experiência

> Implementação: [R0](implementation-r0.md), [R1](implementation-r1.md), [R2](implementation-r2.md), [R3](implementation-r3.md), [R4](implementation-r4.md) e [R5 — medição e piloto](implementation-r5.md). R5 corrigiu a fonte dos tokens nativos do Claude e a cobertura de custos. Piloto real: 3/4 aceites originais e recuperação separada da revisão restante; **economia não comprovada**, pois o tratamento de contexto não foi exercitado. A [R6 visual/local](implementation-r6.md) também foi implementada e verificada. O gate econômico R5 e o cenário autônomo real bidirecional da R6 continuam pendentes. As restrições de “rodada de planejamento” abaixo são o registro histórico daquela etapa.

> Atualização de 15/10: [validação autônoma e reparos reais](implementation-autonomy.md). Fluxo Codex líder → Claude implementação → Codex revisão chegou ao aceite final, com excesso de tokens. No sentido inverso, a interrupção durável e o consumo do recibo foram recuperados com IDs/sessões preservados; a revisão passou, mas o orçamento interrompeu a missão antes do aceite final do líder. Corrigidos lançamento Codex e envio durante startup. **Ainda não é candidato certificado para uso diário, nem prova de economia.**

> Rodada seguinte de 15/10: [perfil de ferramentas e duas tarefas reais](implementation-focused-tools.md). Opção 1 agora é padrão para Claude/Codex e a herança completa fica disponível nos ajustes. O fluxo normal passou dentro de 1,5 milhão de tokens; o inverso retomou a entrega e chegou ao aceite final, mas excedeu o limite em 15.110 tokens e a auditoria perdeu a referência a um helper fechado. O supervisor foi corrigido e testado localmente, sem novo piloto pago. Economia drástica, auditoria nativa completa da recuperação e certificação para uso diário continuam pendentes.

> Continuação de 15/10: [coordenação econômica e auditoria](../2026-10-15-orbit-coordination-report.md). ACK opcional com resultado/critérios evita consultas repetidas; orientação de revisão evita a dependência do próprio aceite. 207 testes de motor/supervisor e 6 de desktop passaram. Repetidas as mesmas duas tarefas reais: normal aprovado com 1.033.874 tokens; inverso chegou ao aceite final e passou na auditoria nativa de identidade/replay, mas excedeu o orçamento com 1.540.375 tokens. Economia uniforme e certificação para uso diário continuam pendentes.

> Atualização seguinte: [conclusão conjunta e piloto bidirecional](../2026-10-15-orbit-finalization-report.md). `readySummary` permite commit atômico de aceite final/conclusão/evento. 213 testes de motor/supervisor e 6 de desktop passaram. Os dois casos nativos passaram nos gates completos dentro do limite: 1.173.956 tokens no normal, 1.490.994 no inverso com SIGKILL e replay auditado. Margem inversa de apenas 9.006 tokens; o total da rodada aumentou e economia geral não foi comprovada. O build local é candidato à avaliação supervisionada, não certificação de uso diário amplo.

**Goal:** tornar o Orbit um ambiente confiável para desenvolver com Claude e Codex juntos, reduzindo trabalho repetido e contexto desnecessário sem baixar a qualidade da entrega.

**Architecture:** preservar Tauri + React + sidecar Node + CLIs em PTYs. Extrair contratos de atividade, adaptadores, contabilização e entrega durável do core gradualmente. O modelo propõe plano e execução; o motor controla identidade, limites, dependências e aceite.

**Stack:** TypeScript, Node 24, MCP, node-pty, React, xterm e Tauri existentes. Nenhuma migração para framework de agentes, banco ou provedor novo é necessária para começar.

## Restrições globais

- Base: checkout local em 14/10/2026; preservar todas as alterações anteriores não commitadas.
- Idioma da interface: português. “Tradução” nesta solicitação significa adapter entre CLI e harness; nenhuma tradução linguística automática nova.
- Referência: Overclock instalado 1.4.13; bytecode não recuperado. Contratos de manuais não são garantias de runtime.
- Paleta existente: `#0d0d0d`, `#121212`, `#161616`, `#1b1b1b`, `#c5e04b`; Geist/Geist Mono.
- Não instalar skills globais, substituir aplicativo instalado, publicar release ou modificar missões do Overclock nesta rodada.
- Esta entrega é investigação, arquitetura, preparação de skills e protótipo. Os problemas reproduzidos ainda não foram corrigidos aqui.
- Meta de economia é hipótese de engenharia: medir antes de declarar resultado. Não remover aceite, permissões ou evidências para reduzir tokens.

## Decisões principais

1. **Atividade é a unidade de trabalho.** Pane é uma execução/visualização; fechar terminal não conclui atividade.
2. **Uma identidade atravessa todo o caminho.** `activityId`, revisão, tentativa, conversa, política e entrega permanecem identificáveis no adapter e na retomada.
3. **Resultado entregue não significa resultado validado.** Guardar quem verificou, revisão do código, comandos e resultados. `auto` é observação, não aprovação.
4. **Recebimento local não significa consumo pelo agente.** Diferenciar persistido, aceito pelo PTY, observado pelo CLI e confirmado pela atividade.
5. **Preparar skills no disco; carregar contexto por necessidade.** Índice curto, pacote original com hash, papel mínimo e referências sob demanda.
6. **Poucos agentes quando bastarem.** Paralelismo depende de independência, escopo de escrita, custo de startup e orçamento.
7. **A interface explica o que o motor sabe.** Motivo do modelo, tarefa pendente, autorização, bloqueio, entrega e validação têm estados próprios.
8. **Mascote informa, sem estimular gasto.** Estado deriva do motor; nenhum XP por token consumido e nenhuma chamada de modelo para animar o personagem.

## Arquivos e responsabilidades propostas

Os caminhos abaixo são relativos à raiz do checkout. São o mapa por responsabilidade; nomes dos contratos definidos na próxima seção.

| Arquivo | Responsabilidade | Etapa |
|---|---|---|
| `packages/sidecar/src/core.ts` | Integrar correções e delegar gradualmente a módulos menores | R0–R4 |
| `packages/sidecar/test/sessionAccounting.test.ts` | Regressões de resume e contagem; conteúdo completo no plano 01 | R0a |
| `packages/sidecar/test/delivery.test.ts` | Progresso, saída, fechamento e obrigação persistente | R0b |
| `packages/protocol/src/index.ts` | Atividade/tentativa/resultado/evento/recibo versionados | R1 |
| `packages/sidecar/src/activityLedger.ts` | Máquina de estados e tentativas; migração do ledger atual | R1 |
| `packages/sidecar/src/sessionAccounting.ts` | Baseline por CLI/conta/sessão, proveniência e commit conjunto | R1 |
| `packages/sidecar/src/adapters/types.ts` | Contrato de capacidades e eventos canônicos | R2 |
| `packages/sidecar/src/adapters/claude.ts` | Hooks/status/protocolo Claude, sem mudar o CLI | R2 |
| `packages/sidecar/src/adapters/codex.ts` | Sessão/turno/uso Codex e detecção de formato compatível | R2 |
| `packages/sidecar/src/adapters/gemini.ts` | Conversão determinística dos eventos Gemini existentes | R2 |
| `packages/sidecar/src/deliveryQueue.ts` | Outbox, destinatário lógico, retry e níveis de ACK | R2 |
| `packages/sidecar/src/contextPack.ts` | Contexto por seção e referências; orçamento explícito | R3 |
| `packages/sidecar/src/skills.ts` | Descoberta por origem e hash; capacidades declaradas | R3 |
| `packages/sidecar/src/mcp.ts` | Resultados e mudanças por cursor, resumo e detalhe | R3 |
| `packages/sidecar/resources/skills/orbit-*/SKILL.md` | Pacotes próprios distribuídos pelo build, sem instalação global | R3 |
| `scripts/build-sidecar.mjs` | Incluir pacotes e manifests como recursos versionados | R3 |
| `packages/sidecar/src/maestro.ts` | Resolver configuração efetiva por risco/capacidade | R4 |
| `packages/sidecar/src/routing.ts` | Revisão de política e edição com conflito explícito | R4 |
| `packages/sidecar/src/verification.ts` | Checks e aceite vinculados à revisão do resultado | R4 |
| `scripts/bench-harness.mjs` | Rodar corpus, salvar métricas e comparação de qualidade/custo | R5 |
| `apps/desktop/src/components/MissionView.tsx` | Conversa principal + mapa de atividades | R6 |
| `apps/desktop/src/components/Conversation.tsx` | Resultados/evidências e estados de entrega | R6 |
| `apps/desktop/src/components/OrbitCompanion.tsx` | Mascote acessível derivado de estado | R6 |
| `apps/desktop/src/components/chrome.tsx` | Hierarquia e saúde global compactas | R6 |
| `apps/desktop/src/styles.css` | Tokens semânticos, densidade, foco e motion | R6 |

Cada etapa terá testes no mesmo subsistema. R0a possui plano detalhado de execução; R0b–R6 são decisões e gates de projeto, a detalhar em fatias pequenas após a validação da anterior. Não transformar esta lista inteira numa única tarefa de implementação.

## Contratos que orientam a evolução

Domínio alvo completo do roteiro. R1/R2 integraram registros de atividade, tentativa e resultado, epochs, normalizadores e avisos duráveis. O formato abaixo orienta a arquitetura completa; política versionada, contexto e validação independente continuam nas etapas seguintes:

```ts
export type ActivityState = 'planned' | 'ready' | 'running' | 'blocked'
  | 'awaiting_validation' | 'done' | 'cancelled';
export interface Activity {
  id: string;
  missionId: string;
  objectiveRevision: number;
  revision: number;
  title: string;
  dependsOn: string[];
  acceptance: string[];
  readScope: string[];
  writeScope: string[];
  state: ActivityState;
  activeAttemptId: string | null;
  disposition: { kind: 'waived' | 'cancelled'; reason: string; by: string } | null;
}
export interface Attempt {
  id: string;
  activityId: string;
  activityRevision: number;
  paneId: number | null;
  executionEpoch: string;
  cli: string;
  accountId: string;
  sessionId: string | null;
  policyRevision: string;
  contextDigest: string;
  skillDigests: string[];
  state: 'reserved' | 'starting' | 'running' | 'stopped' | 'delivered';
}
export interface AgentCapabilities {
  cli: string;
  detectedVersion: string | null;
  source: 'cli' | 'adapter-fixture' | 'unknown';
  supports: {
    sessionResume: boolean;
    turnEvents: boolean;
    usageEvents: boolean;
    readOnlySandbox: boolean;
    skillVisibilityFilter: boolean;
    imageRead: boolean | null;
  };
}
export interface AgentEvent {
  id: string;
  attemptId: string;
  executionEpoch: string;
  source: 'hook' | 'rollout' | 'pty' | 'mcp';
  sourceId: string | null;
  at: number;
  kind: 'session.started' | 'turn.started' | 'turn.ended' | 'approval.required'
    | 'usage.reported' | 'process.exited' | 'result.submitted';
  payload: Record<string, unknown>;
}
export interface DecisionReceipt {
  activityId: string;
  attemptId: string;
  policyRevision: string;
  catalogRevision: string | null;
  source: 'explicit' | 'rule' | 'classifier' | 'fallback';
  requested: { cli: string | null; model: string | null; effort: string | null };
  effective: { cli: string; model: string | null; effort: string | null; accountId: string };
  reasons: string[];
  capabilityLimits: string[];
}
export interface ResultRecord {
  id: string;
  activityId: string;
  attemptId: string;
  activityRevision: number;
  summary: string;
  artifactRefs: Array<{ path: string; sha256: string | null }>;
  checkRefs: string[];
  sourceRevision: string | null;
  state: 'submitted' | 'accepted' | 'changes_required' | 'unverified';
}
```

JSON externo deve ser validado no handler; interfaces TypeScript não fazem validação em runtime. Capacidade desconhecida permanece desconhecida. Ferramenta ausente do catálogo não perde sua autorização no handler.

## Ordem de entrega e gates

| Ordem | Fatia que funciona sozinha | Gate que permite avançar |
|---|---|---|
| R0a | Contagem na retomada | Mesmo report não aumenta missão/dia/custo; report novo conta somente delta; conversa nova conta uso novo |
| R0b | Obrigação de resultado | Progresso não fecha atividade; saída/fechamento não liberam `ready`; cancelamento/dispensa explícitos e auditáveis |
| R1 | Ledger por atividade/tentativa e uso por sessão | Migração idempotente, resultados fora do limite de 200 eventos, histórico preservado, crash em fronteiras não perde reserva/resultado confirmado |
| R2 | Adaptadores e entrega durável | Eventos duplicados/atrasados não mudam tentativa atual; desconexão não repete mutação incerta; replay para líder novo; ACK identifica seu nível |
| R3 | Contexto e skills | Contrato/segurança preservados sob corte, consulta por cursor, carregamento por hash, descoberta de projeto/plugins sem executar conteúdo |
| R4 | Maestro/scheduler/validação | Dependências respeitadas, writers isolados ou serializados, override explícito vence, fallback explicável, aceite corresponde ao diff verificado |
| R5 | Avaliação A/B | Qualidade mantida, custos conhecidos/ausentes separados, métricas repetíveis incluindo revisões e retries |
| R6 | Interface e mascote | Estados reais ligados ao domínio, teclado/contraste/motion/responsividade; release candidato passa cenário de código com os dois CLIs |

R6 pode ser explorada visualmente enquanto R0–R5 avançam. Instalar o visual não substitui os gates de confiabilidade.

### Semântica de entrega

Persistir resultado antes de responder sucesso ao MCP. O recibo devolve `resultId`. Enfileirar aviso destinado ao papel/atividade, associado ao epoch do destinatário. Níveis: `persisted`, `pty_accepted`, `agent_acknowledged`; nenhum deles significa `validated` automaticamente. Um CLI sem ACK explícito fica em `pty_accepted`, com resultado consultável por cursor. At-least-once no transporte mais consumo idempotente não equivale a exatamente uma execução de comandos externos.

Reservas e resultados precisam de flush durável antes do ACK correspondente. A troca atômica de snapshot já existente não deve ser confundida com durabilidade de uma escrita ainda no debounce. A implementação deve escolher um único commit para resultado/outbox e para baseline/totais, com testes de interrupção; não introduzir um banco novo sem necessidade comprovada.

### Continuação e replanejamento

Novo pedido compatível → nova revisão do plano, reutilizando responsável/contexto válido. Mudança de escopo/aceite → revisão de atividade; resultado antigo continua histórico e não satisfaz silenciosamente o contrato novo. Falha ambiental → diagnosticar/repetir tentativa na mesma atividade; não subir automaticamente para modelo caro. Falha de raciocínio com evidência → permitir escalada limitada e registrar motivo. Cancelar tentativa invalida sua fila por epoch; eventos antigos ficam auditados sem reativá-la.

### Skills preparadas

Rascunhos nesta pasta: piloto, pesquisa, implementação, revisão e verificação. São próprios do Orbit, curtos e independentes de nomes `oc-*`. Distribuir em overlay de sessão quando suportado, ou disponibilizar como recursos locais com leitura explícita. Não afirmar que o provider oculta o catálogo se não houver capacidade verificada. Conservar metadados `id/version/sha256/source/role/compatibility` e marcar “disponível”, “selecionada”, “carregada” e “cumprida” separadamente.

### Metas de desempenho propostas

Estabelecer baseline após R0. Corpus: 12 tarefas versionadas (quatro operações, quatro bugs, quatro mudanças com múltiplos arquivos), três repetições por configuração e modelos fixados. Separar CLIs e modelos; usar mesma revisão e aceite. Amostra inicial indica tendência, não superioridade universal.

- Ambição inicial: reduzir em **40% a mediana de contexto acrescentado pelo Orbit** e **25% dos tokens por tarefa aceita**, onde mensuráveis. São metas, não ganhos observados.
- Gate de qualidade: nenhum critério obrigatório perdido; nenhuma regressão de autorização, perda de entrega ou fechamento prematuro; comparar sucesso por categoria e dispersão.
- Registrar input/output/cache quando reportados, origem e confiança; custo ausente é `null`, não zero. Incluir chamadas do decisor e retries.
- Medir startup, primeira resposta, tempo até aceite, número de workers, reaberturas, wakeups e retrabalho.
- Sem modelo durante idle, para labels da UI, para lookup de estado ou animação do mascote.
- Não converter bytes/4 em “tokens reais”. Bytes são métrica separada; tokens exigem tokenizer compatível ou report do provider.

## Direção visual e mascote

[Brief de design](../../design/orbit-v2/README.md) e [protótipo interativo](../../design/orbit-v2/prototype.html). Preservar a paleta, aproximar densidade e organização de workbench observadas no Overclock, e tornar conversa, estados e evidências mais claros. Layout adaptável: foco no líder, trilho de atividades e detalhes sob demanda. O terminal continua a um atalho de distância.

O mascote **Orbit** é um núcleo grafite com anel verde-lima e satélites; conceito v1 gerado nesta etapa, sem copiar personagem/asset do Overclock. Cinco estados previstos: pronto, trabalhando, esperando você, bloqueado e entregue. Texto acessível acompanha o estado. Redução de movimento e desligamento disponíveis; nenhum som automático.

## Critério de candidato para uso diário

Em repositório de teste versionado: pedir correção → líder planeja → Claude implementa → Codex revisa → checks executados → correção retorna se necessário → resultado aceito no diff atual. Interromper Orbit entre entrega e aviso, reabrir e comprovar que resultado, tentativa, aceite, conta e uso permanecem coerentes. Repetir cenário invertendo os CLIs. Só então promover um build candidato para uso diário; a leitura/MCP real já validada não cobre esse caminho inteiro.

## Evidência e entrega desta rodada

[Investigação localizada](../../analysis/overclock-harness-deep-dive.md), [plano detalhado da primeira fatia](01-session-accounting.md) e `reproduce-current.mjs`. O diagnóstico confirma os bugs atuais; não é um teste verde de correção. Nenhuma promessa de redução percentual foi apresentada como resultado.

A execução pode seguir inline, uma fatia por vez, com revisão entre entregas; este documento não agenda trabalho futuro nem altera configurações. Não há confirmação pendente exigida para o planejamento.
