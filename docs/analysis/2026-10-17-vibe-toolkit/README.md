# Vibe Coding Toolkit como padrão transversal do Orbit

Fonte primária: [soumatheusgomes/vibe-coding-toolkit](https://github.com/soumatheusgomes/vibe-coding-toolkit/tree/de66fe371a49f5a4d3b521759e5c401f390b6424).
Revisão fixada: `de66fe371a49f5a4d3b521759e5c401f390b6424`, obtida por clone público em diretório temporário,
sem executar instaladores do upstream. O inventário de todos os arquivos versionados, tamanhos e SHA-256 está
em [upstream-manifest.json](upstream-manifest.json). Pesquisa iniciada em 17/10/2026; validação em 18/10/2026.
Baseline do Orbit: `fc858d4`, versão conhecida 0.2.26. Integração no mesmo checkout/branch
`fix/orbit-transport-recovery`, preservando os commits e arquivos de recovery do pane181.

## O que a fonte realmente contém

Não é um motor universal de execução. README, AGENTS/CLAUDE, guias, prompts e templates distribuem
receitas de preparação de máquina/projeto e acordos de trabalho. O código executável real fica nos
validadores Node, exemplos de hooks, regras ESLint e templates de uma aplicação Next. Não há pacote
runtime do toolkit a instalar no Orbit nem skills completas vendorizadas dos projetos citados.

Fontes decisivas no commit acima:

| Fonte | Constatação e aplicação |
| --- | --- |
| README.md; docs/00-overview.md; docs/01-installation.md | Processo proporcional, adoção modular, preservar stack e autenticação; instalação não é execução/comprovação. |
| AGENTS.md; CLAUDE.md | Instruções do próprio repositório toolkit; não são automaticamente instruções de todo projeto consumidor. CLAUDE usa ponte para AGENTS. |
| templates/AGENTS.md.template | Entender antes de editar, aceitação verificável, continuidade, simplificação, comunicação clara, contexto progressivo, segurança, revisão proporcional. Adaptado em texto independente do CLI. |
| docs/prompts/12-existing-project-setup.md | Diagnóstico → design/planejamento proporcional → implementar → verificar/revisar; rerun idempotente, preservar customizações, separar configurado de validado. Sua autorização de instalar/configurar vale para execução explícita daquela receita, não para toda conversa do Orbit. |
| templates/rules/parallel-subagent-driven-development.md; docs/tools/02-subagent-orchestration.md; prompt05 | Brief com arquivos/dependências/recursos/aceite; um escritor por arquivo, recursos isolados ou etapas seriais, recuperação somente após confirmar parada. Adaptado à orquestração/ledger existente do Orbit. |
| templates/task-handoff.md.template; prompt06; docs/tools/09-claude-memory-system.md | Handoff é contexto, não evidência atual. Memória curta com origem/verificação/invalidação; detalhes sob demanda. Reutiliza notas, briefing e referências existentes. |
| docs/07-harness-evaluation.md; prompt14; scripts/validate-harness.mjs e seu teste | Casos descartáveis de autorização, handoff obsoleto, revisão read-only, reaplicação, recursos, bloqueio parcial e retomada. O avaliador testa sete propriedades da fixture access.mjs, incluindo tenant/identidade e preservação de notas; não prova comportamento de todos os modelos. |
| templates/eslint/eslint-rules/{core-rules,utils,index}.cjs; verify.mjs; check-eslint.mjs | Regras reais de tamanho, console e fronteira de dados, com configurações e self-check dependentes de ESLint/ecossistema JS/Next. Inspecionadas, não incorporadas indiscriminadamente. |
| templates/next; docs/04-project-bootstrap.md; docs/06-project-defaults.md; prompt11 | Defaults de projeto novo dependem de Next/React, Drizzle/pg, Zod, Pino e Vitest. Não justificam migrar o Orbit ou projetos do usuário. Nenhum desses templates/dependências foi copiado. |
| .github/workflows/validate.yml; scripts/validate-docs.mjs; scripts/validate-next.mjs | CI upstream valida links/anchors/JSON e scaffold Next temporário em Node24, Ubuntu/Windows. Não é workflow de runtime de agentes; não foi instalado no Orbit. |
| LICENSE | MIT, copyright 2026 Matheus Gomes. Texto integral e atribuição preservados em THIRD_PARTY_NOTICES.md, já copiado pelo empacotador do sidecar. |

O catálogo e os índices de prompts/templates foram inventariados integralmente. Os prompts01–09 são
receitas específicas de saneamento/lint/revisão/plano/ondas/memória/refatoração; 10 prepara máquina,
11 projeto novo, 12 existente, 13 segurança, 14 avaliação de harness. Não se executam como ações
automáticas por simplesmente existir uma sessão. Detalhes de uma receita futura podem ser consultados
na fonte fixada com uma tarefa relevante, preservando o escopo autorizado.

## Decisão sobre cada família do catálogo

| Componente upstream | Decisão |
| --- | --- |
| Superpowers | Adaptar processo proporcional; não instalar plugin ou exigir novo ritual de aprovação em toda tarefa. |
| Ponytail | Adaptar menor mudança completa, leitura/callers antes da solução, reutilização; segurança/validação/acessibilidade permanecem. `stop ponytail` é opt-out instrucional. |
| Caveman | Adaptar concisão preservando significado, idioma, números/erros e detalhe solicitado; código/docs/commits normais. `stop caveman` é opt-out instrucional. Nenhum proxy. |
| RTK | Guia sob demanda: somente se já disponível, suportado e sem dupla reescrita; preservar saída original. Sem instalação/hook novo. |
| Graphify | Guia sob demanda com cobertura/frescor e exclusão de segredos/gerados; sem indexação ou extração semântica paga automática. |
| Context7 | Documentação atual por versão se disponível; fontes oficiais como alternativa. Sem conexão, credencial ou envio de código privado automático. |
| agent-browser / Chrome DevTools MCP | Usar capacidade existente e pertinente; nenhuma instalação, sessão pessoal ou serviço de produção ativado. |
| Memória nativa / Obsidian | Reutilizar memória/notas/briefing/context_read do Orbit. Sem criar vault, servidor ou exportar dados. |
| Codex workflow / hooks | Preservar mecanismo nativo e configuração por sessão existentes; não copiar configuração global de um CLI para outro nem instalar hooks do toolkit. |
| Vercel/find-skills / Anthropic artifact skills / skill creation / plugins extras | Descoberta e uso quando tarefa compatível, capacidade disponível e autorizada. Nenhuma cópia do código desses terceiros ou claim de instalação. |
| next-dev-loop / next-bundle-optimizer | Somente Next compatível e necessidade de diagnóstico/performance; não atualizar bundler/framework para preencher checklist. |
| PostgreSQL skills | Somente SQL/schema/migração pertinente, preservando provedor/ORM; nenhuma base/migração criada. |
| gh-fix-ci | Somente investigação GitHub autorizada; não concede permissão global de push/publicação. |
| differential-review / prompt13 | Adaptar revisão exata por risco, read-only, evidência/redação privada; não instalar agentes exclusivos de outro cliente ou presumir segurança absoluta. |
| shadcn | Apenas projeto que já adota/escolhe esse sistema; preservar tokens/componentes/acessibilidade. |
| Sentry MCP | Somente serviço escolhido e acesso existente autorizado; não configurar OAuth, SDK ou conta automaticamente. |
| Setup completo máquina/projeto, templates e installs | Ações explícitas futuras; não parte do bootstrap padrão de toda sessão. |

Não há novas dependências npm, rede no bootstrap, execução de scripts upstream, novos MCPs, serviços,
contas, mensagens externas, cobrança, framework ou provedor. Os projetos referenciados pelo toolkit
mantêm licenças próprias: como suas implementações não foram incorporadas, não se apresentam como
plugins distribuídos. Qualquer adoção futura exige sua análise específica de dependências/licença.

## Ativação e garantias técnicas

`packages/sidecar/src/toolkitPolicy.ts` contém uma adaptação portátil com versão explícita
`orbit-vibe-1:de66fe371a49f5a4d3b521759e5c401f390b6424`. `OrbitCore.spawn` aplica a todos os
agentes compatíveis, líderes e ajudantes, nos modos Livre/Squad/Agêntico, sem seleção manual de skill.
A política fica fora do filtro onlySkills: restringir skills não remove o acordo central.

O pacote padrão tem **2635 bytes UTF-8** contra **8010 bytes** de material total, com três guias
endereçados por conteúdo: implementation-quality, coordination-recovery e context-tools. Esses guias
ficam na biblioteca privada da missão, recuperáveis por `context_read`. Mesma versão produz os mesmos
hashes e arquivos: nada é baixado ou acrescentado ao prompt de cada turno. Isso mede bytes de texto,
não economia de tokens ou dinheiro. Os limites de autorização e contexto existentes permanecem.

| Caminho | Comportamento técnico |
| --- | --- |
| Nova conversa / reabertura fresca | Um contrato no role; detalhes por referência, sem repetir no task. |
| Claude | Role por `--append-system-prompt`, inclusive resume, conforme adapter existente; nenhum contrato adicional no task. Não se afirma que o provedor deduplica histórico internamente. |
| Codex / Gemini / Antigravity | Role no primeiro prompt conforme adapter; resume conhecido omite role e não adiciona task só por política. |
| Sessão antiga/desconhecida, sem recibo atual | Codex/Gemini/Antigravity recebem uma atualização versionada pelo task do resume, preservando mensagem explícita. Sem tarefa, o texto manda aguardar e não reexecutar setup/trabalho. **Isso pode iniciar um turno nativo e consumir inferência/contexto; custo desconhecido.** Não é resume de zero bytes. |
| Próximos resumes da mesma conversa | Recibo persistente evita nova migração. Resume normal sem mensagem mantém task vazio mesmo após reiniciar o sidecar. |
| Identidade de conversa | Recibo corresponde a versão+CLI+conta+sessão observada; sessão desconhecida nunca é wildcard. Primeira associação só no executionEpoch despachado. Mudança posterior não herda o recibo anterior. |
| Compaction/recovery | `mission_briefing` standalone contém núcleo e referências; briefing já embutido em novo launch não repete contrato. Recuperar briefing é ação explícita e pode recarregar o núcleo após perda de contexto. |
| Transferência | Novo líder recebe contrato uma vez junto ao estado atual; promoção de helper já coberto usa briefing atual pelo fluxo existente. |
| Shell / login | Shell não recebe contrato de LLM; autenticação não é tarefa. Não alegar suporte universal de inferência. |

`context.json` registra versão, rota role/session-upgrade/inherited, referências e
`compliance: not-observed`. Recibos ficam em `toolkit-dispatches/` no dataDir privado, fora dos
arquivos efêmeros de panes removidos no boot. São recibos de **despacho**, não ACK de consumo nem
prova de obediência. A troca de versão do texto exige incrementar a revisão da política.

Não há interceptação de todo teclado/PTY, duplicação por mensagem, mudança de modelo/conta ou
configuração global de CLI. O bypass padrão e o sandbox read-only existentes não foram alterados.
Chamadas auxiliares de tradução/classificação, com contratos próprios estritos de saída, não recebem
um papel geral de executor; esta camada cobre sessões de agentes que o Orbit cria/retoma, não cada
inferência arbitrária dentro de plugins, subprocessos ou ferramentas externas.

## Precedência, ambiguidades e limites

Sistema, usuário e instruções aplicáveis do projeto prevalecem sobre defaults. Preferências explícitas,
pausa, limites e opt-outs permanecem; nenhuma regra passa a autorizar mudanças externas. A receita12
contém aprovações por estágio e permissões específicas de instalação; foram resolvidas em favor do
pedido atual e do processo proporcional, sem nova confirmação para trabalho já autorizado. O toolkit
não exige Git hooks/worktrees por padrão; isso não remove as regras de Git já impostas pelo projeto.
O pedido atual de mesmo checkout coordenado prevaleceu sobre a recomendação genérica de worktrees.

Nomes comerciais/modelos hardcoded e stack Next não viraram padrão universal. O roteamento existente,
catálogo real, conta escolhida e restrições humanas continuam decidindo execução. O pedido de conta1
codex-cli foi recebido; nenhum arquivo de autenticação foi lido/alterado para implementar esta camada.
A identidade deste executor é codex-cli; não se inventa certificação de conta a partir disso.

Processo, opt-out em linguagem natural, revisão, mínimo contexto e não enviar dados externos são
**instruções para o modelo**, não bloqueadores de segurança novos. Garantias existentes do Orbit
(admissão de writers, orçamento, sandbox suportado, evidência/aceitação e ledger) continuam com seus
limites próprios. Não existe garantia técnica de que qualquer modelo arbitrário seguirá tudo.

## Evidência reproduzível e entrega integrada

Comandos direcionados deste conjunto:

```sh
node --test packages/sidecar/test/toolkitPolicy.test.ts packages/sidecar/test/toolkitJourneys.test.ts packages/sidecar/test/taskContinuity.test.ts packages/sidecar/test/promptBudget.test.ts
npm run typecheck -w @orbit/sidecar
```

Resultado: **24 testes, 24 passaram, exit0**; typecheck **exit0**. Testes novos cobrem estabilidade,
paginação por referência e isolamento por missão; recibos corruptos/versão antiga/conta/CLI/sessão/epoch;
três modos, helpers de quatro adapters e modelos distintos; sem tarefa, tarefa simples e complexa;
reopen/resume/shutdown/recovery/transferência; migração legada e ausência de repetição em resume normal.

Matriz executada localmente:

| CLI/modelo configurado | Evidência | Limite |
| --- | --- | --- |
| Codex gpt-6-luna / gpt-6.1-sol | Core + argumentos do comando; WebSocket/core/PTY real executa CLI determinístico local pelo buildCommand e confirma contrato uma vez; bypass preservado. | Não fez inferência nos modelos comerciais. |
| Claude claude-sonnet-5-5 | Core + adapter/argumentos, role no system append e zero policy task no resume. | CLI substituído por fixture local; consumo/obediência não observados. |
| Gemini flash | Core + adapter/argumentos, primeiro prompt/resume/migração e transferência. | Sessão reportada sinteticamente; descoberta nativa/inferência não certificadas. |
| Antigravity some-supported-model | Core + adapter/argumentos e resume/migração com identidade sintética. | ID é fixture, não modelo comercial validado; adapter não certifica descoberta automática de sessão/turnos. |

Nenhum teste chama provedores, contas pessoais ou APIs pagas. Passar essas jornadas prova transporte,
composição e política do Orbit, não observância universal. A revisão independente do pane181 aprovou
vinculação sessão/epoch/rotas e encontrou a associação nula indevida, corrigida com regressão. Também
ajustou teste preexistente que assumia que a primeira referência de briefing era sempre memória;
agora seleciona a seção real, preservando paginação e contrato de aceite.

Por acordo explícito, **pane181 é o único responsável final** por suíte integrada, jornadas de browser,
GitHub/PR/release/build e atualização da MESMA `/Applications/Orbit.app`, preservando dados/credenciais.
Este conjunto não executou build concorrente nem agent:finish. Logs finais, links PR/release e
hash/assinatura/runtime da instalação pertencem à entrega integrada181; este documento não os presume
concluídos nem afirma que o app instalado já contém um commit ainda não publicado.

Skills deste executor: inline [oc-showcase]. Não houve mudança de UI neste conjunto; regras visuais
não exigiram novo componente, screenshots ou assets.
