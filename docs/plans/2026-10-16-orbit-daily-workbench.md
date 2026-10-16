# Orbit: ambiente diário e bancada do líder

**Goal:** concluir os gates de execução nativa e melhorar a abertura, navegação e conversa do Orbit, com evidência de cada etapa.
**Architecture:** preservar o motor, a persistência e os adapters existentes. Separar prontidão do transporte de serviços de fundo; tornar decisões conservadoras e legíveis; compor a experiência em torno do líder e das entregas verificadas.
**Stack:** Node >=24.11, TypeScript, React 19, Tauri 2 e tokens visuais existentes; sem migração de framework.

## Global constraints

- Preservar alterações prévias, sessões e credenciais. Nenhum envio de código privado para benchmarks.
- Piloto nativo limitado a duas tarefas públicas/sintéticas; registrar gastos desconhecidos e falhas.
- Não ativar ranking sem identidade e cobertura qualificadas; não apresentar dois casos como prova estatística.
- Permissões explícitas, revisão independente e orçamento continuam restrições obrigatórias.
- Instalar somente após build e gates locais/nativos; interrupção de sessões vivas exige preservar estado.

## Mapa e execução

### 1. Inicialização
Arquivos: `packages/sidecar/src/server.ts`, `core.ts`, `skills.ts`, `packages/protocol/src/index.ts`, `apps/desktop/src/orbit/client.ts`, `App.tsx`; teste `packages/sidecar/test/startup.test.ts`.
- [x] Reproduzir retomada lenta mantendo uma Promise pendente e exigir porta/snapshot antes de resolvê-la.
- [x] Publicar estado de serviços em segundo plano, inclusive erro; impedir jobs novos após shutdown.
- [x] Retirar I/O síncrono da descoberta externa de skills.
- [x] Validar com `node --test packages/sidecar/test/startup.test.ts packages/sidecar/test/skills.test.ts`.

### 2. Roteamento e ciclo de vida
Arquivos: `packages/sidecar/src/maestro.ts`, `core.ts`, `verification.ts`, `store.ts`, adapters e testes correspondentes.
- [x] Reproduzir quota velha/desconhecida, reset de várias janelas, esforço elevado e fallback para API.
- [x] Corrigir na origem, sem converter ausência em saldo nem conveniência em autorização paga.
- [x] Verificar invariantes de sandbox, revisão e retries com regressões antes das correções.

### 3. Bancada e conversa
Arquivos: `apps/desktop/src/components/{HomeView,WorkspaceDialog,Conversation,MessageComposer,PaneView,chrome,Dialog}.tsx`, `App.tsx`, `styles.css`; parser em `orbit/messageFormat.ts` e testes.
- [x] Organizar início em retomar, criar e escolher projeto; fluxo de workspace com pasta principal e nome claros.
- [x] Dar identidade ao líder, hierarquia às respostas, formatação segura, estados vazios e acompanhamento de novas mensagens.
- [x] Preservar sugestões somente com Tab, anexos, ditado, teclado e fluxos existentes.
- [x] Validar typecheck, testes, UI real com teclado e larguras 375/768/1024/1440; motion reduzido.

### 4. Executor nativo e medição
Arquivos: `packages/sidecar/src/benchmarks/*`, adapters, `scripts/bench-routing.mjs`, corpus e relatórios em `docs/analysis/`.
- [x] Executor deve reservar antes de disparar, finalizar processos, proteger oracle e correlacionar identidade/consumo de todas as fases.
- [x] Rodar CLIs simuladas e só então piloto econômico em corpus público; falta de telemetria impede promoção, não apaga o resultado.
- [x] Medir contexto/prompts/ferramentas antes/depois; não alegar economia por bytes apenas.

### 5. Entrega local
- [x] Rodar suítes, typecheck, build do desktop/motor e smoke nativo isolado.
- [x] Gerar e instalar artefato preservando backup e perfil; verificar abertura no perfil normal.
- [x] Relatório final deve distinguir implementado, medido, instalado e pendências reais; sem promessa de confiabilidade universal.

## Direção de interface

Pessoa: desenvolvedor que alterna entre orientar o líder e conferir entregas. Verbo principal: continuar uma missão com contexto. Sensação: bancada calma e precisa.

Conceitos: órbita, trajetória, missão, tripulação, sinal, centro de comando. Materiais/paleta existentes: grafite, carvão, alumínio, branco de leitura e verde de sinal. Assinatura: trilha de missão que liga objetivo, líder e atividade, com o mesmo sinal orbital nos pontos de orientação.

Uma conversa central vence por largura e espaço; metadados ficam secundários. Evitar uma parede de controles: ações frequentes visíveis, manutenção agrupada. Evitar uma grade de métricas na abertura: destacar continuação e projetos. Evitar balões iguais: mensagens da pessoa compactas, resposta do líder com largura de leitura e blocos claros.

Tokens e fontes Geist existentes; unidade de 4 px, controles de 44 px quando possível, camadas por superfície/borda suave, foco visível. Transições de opacidade/transform de 180 ms, desligadas com reduced motion. Estado observado nunca ganha rótulo de sucesso sem evidência do motor.

## Evidência desta rodada

- Suíte do motor: 269/269; desktop: 25/25; typecheck passou. Logs em `docs/analysis/2026-10-16-daily-*`.
- Dois casos nativos Codex interrompidos no teto inicial de 40 mil tokens; as mesmas sessões foram retomadas uma vez e concluíram handoff e oracle local (2/2). O journal original continua com falhas; as retomadas não promovem política.
- UTF-8 do pack inicial do líder sem memória: 11.330 → 5.921 bytes; revisão: 3.980 → 2.666. Não é uma medição causal de economia de tokens.
- UI real com conteúdo sintético conferida em 375/768/1024/1440, envio/ACK, sugestão com Tab e Escape dos menus. Capturas de início, líder e workspace salvas. O seletor nativo e o perfil normal ainda dependem da etapa de instalação.
- `mission_ready(force=true)` agora é rejeitado: um agente não pode dispensar exigências com um motivo textual atribuído ao usuário. Execuções antigas também não finalizam missões.

### Limites de escopo ainda abertos

Este lote não conclui os 66 itens de `plano-orbit-10.md`. Permanecem: failover automático com falha tipada/cooldown e sem repetir efeitos; observação completa de modelo/esforço por resposta; matriz estatística nativa; redução/consolidação adicional da superfície MCP; auditoria de leases órfãs e cenários de caos; e teste real com duas contas autenticadas por provedor. O Claude reportou 93% semanal na leitura do app instalado e não recebeu nova tarefa de inferência nesta rodada.

Instalação e retomada concluídas em 16/10: Orbit 0.2.15, dois workspaces/duas missões preservados, sessões #7/#11 com IDs conferidos por hash. Evidência detalhada: [relatório de entrega local](../analysis/2026-10-16-daily-workbench.md).
