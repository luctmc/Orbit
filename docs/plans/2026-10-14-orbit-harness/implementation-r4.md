# R4 — maestro, admissão e revisão independente

Implementada e verificada no checkout em 15/10/2026. A retomada foi autorizada pelo usuário após a pausa. Alterações anteriores preservadas; nenhum commit, push, instalação ou release foi feito. O build de desenvolvimento foi gerado novamente. **R5 e R6 continuam pendentes; este relatório não certifica o Orbit para uso diário.**

## Comportamento implementado

O maestro registra uma decisão estruturada por tentativa: origem explícita/regra/classificador/fallback, escolha solicitada e efetiva, conta, revisão da política, catálogo quando disponível, motivos e limites conhecidos. O recibo de abertura expõe os IDs da atividade e tentativa. O registro também fica no manifesto de contexto da execução, antes de lançar o processo.

Escolhas explícitas de CLI/modelo/esforço prevalecem sobre defaults da tabela e do squad. Requisitos incompatíveis falham com motivo. `requireReadOnlySandbox` exige um adapter com sandbox nativo; na matriz atual isso seleciona Codex quando a escolha é automática e permitida. A abertura configura `sandbox=read-only`. Escolher explicitamente uma CLI incompatível não degrada silenciosamente a proteção. Uma edição da tabela durante classificação assíncrona impede o lançamento da decisão antiga.

A tabela expõe revisão para edição concorrente. Propostas guardam a revisão de origem; aceitar uma proposta antiga ou legada sem base exige nova proposta. Aplicação da tabela e aceite da proposta fazem parte da mesma transação durável, com rollback em falha de disco. Recusar proposta antiga continua possível.

## Escrita e encerramento

`scheduler.ts` normaliza raízes físicas, resolve aliases e trata subpastas de um checkout como a mesma cópia. Writers gerenciados com raízes sobrepostas são serializados; worktrees distintos permitem escritores paralelos, salvo pastas adicionais compartilhadas. Read-only é uma política separada. Terminais shell manuais estão fora dessa admissão. Não há parser de comandos nem fila automática de pedidos recusados.

Foi reproduzida a falha pendente da pausa: remover os metadados de um pane liberava sua lease antes do callback de término. O teste inicialmente falhou com `Missing expected exception`; passou após separar revogação de autoridade e liberação de escrita.

Agora fechar revoga o epoch, mas mantém a lease. `PaneManager` emite confirmação de término com o epoch original mesmo quando o terminal foi esquecido. Somente uma confirmação correspondente libera aquela execução. A retomada espera até cinco segundos pelo término; novas solicitações de retomada simultâneas para o mesmo pane são recusadas. Se houver timeout, o pane e suas configurações permanecem disponíveis para outra tentativa, e a execução antiga perde autoridade sobre os tools do Orbit. Fechar o agente durante essa espera cancela a retomada.

Leases persistem no snapshot e recebem o PID após spawn. Após recuperar um sidecar, a admissão só remove uma lease herdada quando a consulta ao PID retorna `ESRCH`; PID vivo/reutilizado, erro de permissão e PID desconhecido não comprovam término. Nenhum processo desconhecido é sinalizado. Se a gravação da liberação falhar depois de um término observado, esse recibo permanece em memória para repetir a liberação atomicamente na próxima admissão.

Encerramento normal persiste separadamente quais agentes deveriam voltar. O servidor aguarda os callbacks de saída e faz flush dos últimos metadados antes de outro Store abrir a pasta, evitando que o debounce antigo sobrescreva a recuperação. Retomada automática mantém identidade de sessão e obrigações anteriores.

Promover um writer em execução a maestro de missão agêntica/squad é recusado: alterar o papel não altera o sandbox existente. A troca por um líder novo continua disponível; helpers já read-only podem ser promovidos.

## Dependências e revisões

`dependsOn` aceita atividades existentes da missão que já tenham resultado aceito independentemente e source ainda correspondente na admissão. Cada dependência fixa atividade, revisão, tentativa e resultado. O lançamento revalida os vínculos após qualquer espera de classificação; ciclos são recusados. Um retry ou resultado substituto do pré-requisito invalida o vínculo anterior: a atividade dependente precisa de nova atribuição/revisão explícita.

O resultado `done` continua sendo uma declaração de entrega. Ele captura um fingerprint do source e recebe um parecer separado:

- `result_inspect`, com escopo `result`, observa source/contrato e gera uma inspeção vinculada ao revisor, epoch e atribuição atuais.
- `verification_submit` registra `accepted`, `changes_required` ou `unverified`, sem aceitar revisão do próprio executor. Aceite exige checks declarados com saída zero e evidência para todos os critérios. Resultado novo, contrato alterado, execução substituída ou source alterado impedem usar a inspeção antiga.
- Pareceres são duráveis e imutáveis por inspeção. Repetir a mesma submissão retorna o mesmo registro; mudar o parecer exige outra inspeção. Falha de disco não transforma a atividade em aceita.
- `verification_status` apresenta aceite histórico dos resultados atuais e validade dos vínculos. Não certifica a árvore integrada atual.

O aceite individual conserva o significado histórico: uma atividade posterior pode legitimamente mudar a mesma cópia sem apagar a revisão anterior. Por isso há um segundo escopo, `result_inspect(scope=integration)`: observa o source final da missão e o conjunto atual de contratos/resultados. O revisor verifica o objetivo e se os critérios de todas as atividades continuam satisfeitos na integração. `mission_ready` exige entregas resolvidas, aceites individuais válidos e parecer final aceito para o fingerprint e contratos atuais. Alterações posteriores exigem nova revisão final. Uma dispensa explícita exige motivo auditável; não cria um parecer de aceite fictício.

Prompts e descrições MCP orientam esse fluxo, a confirmação de recebimento, a serialização e os vínculos de dependência. ACK de notificação, entrega e aceite permanecem fatos separados.

## Fingerprints e limites

`verification.ts` registra HEAD, identidades do index, conteúdo/mode dos arquivos de trabalho e arquivos não ignorados no Git, inclusive ausências. Fora do Git, registra a árvore com exclusões explícitas de dependências, artefatos gerados e dados internos do Orbit. Usa argumentos diretos de processo, sem shell, diff drivers, textconv ou filtros de conteúdo; fsmonitor é desabilitado nessas consultas. Limites: 20.000 entradas, 32 MiB por arquivo, 128 MiB totais e 15 segundos por consulta Git. Exceder limites ou encontrar entrada Git de diretório/submódulo não suportada recusa a observação.

O teste de worktree dentro da pasta de dados cobre a regressão em que uma exclusão ancestral poderia ocultar todos os arquivos do source. Exclusões agora só se aplicam dentro da raiz observada.

Os checks são **relatos atribuídos ao revisor**, não processos executados pelo MCP. O motor confere identidade, contrato, source, presença e coerência dos campos; não prova a veracidade semântica do relato. Não foi criado um tool de shell que pudesse contornar permissões do CLI.

O fingerprint não é um snapshot atômico e não cobre dependências externas, arquivos ignorados pelo Git ou ambientes de execução. Symlinks registram o destino textual, não o conteúdo externo. O término confirmado é o processo do PTY; descendentes deliberadamente desacoplados não têm supervisão universal. A política read-only de adapters sem sandbox nativo depende de hooks/instruções. Não é uma garantia geral de isolamento do filesystem.

Um crash na janela entre reserva e persistência do PID pode deixar uma lease com processo desconhecido. Ela permanece bloqueada por segurança e exige diagnóstico; não há nesta etapa um botão para limpar leases sem comprovação. PID reutilizado também pode manter um bloqueio conservador. Não transformar esses limites em promessa de recuperação automática universal.

Histórico anterior sem contrato R4 permanece legado. Não recebeu certificação retroativa. A UI de estados e invalidação visual do selo de pronto após mudanças externas ainda pertence à R6.

## Verificação

Todas as seguintes execuções terminaram com exit 0 sobre o source final desta etapa:

| Comando | Resultado | Evidência |
|---|---|---|
| `npm test` | 173/173 sidecar + 2/2 desktop | [tests.log](execution-r4/tests.log) |
| `apps/desktop/build/node/node --test packages/sidecar/test/*.test.ts` | 173/173, Node 24.21.0 empacotado | [node24-tests.log](execution-r4/node24-tests.log) |
| `npm run typecheck` | Sem erros | [typecheck.log](execution-r4/typecheck.log) |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS gerado | [build.log](execution-r4/build.log) |
| `git diff --check` | Sem erros | [diff-check.log](execution-r4/diff-check.log) |

Permanece o aviso preexistente do chunk JavaScript de 747,67 kB. O build foi gerado em `apps/desktop/src-tauri/target/debug/bundle/macos/Orbit.app`; o app instalado não foi substituído. [validation.json](execution-r4/validation.json) identifica fontes, testes, logs e artefatos por SHA-256, incluindo correspondência do sidecar empacotado ao build.

Cobertura adicional: fechamento antes de término, epoch antigo, timeout e retry, promoção insegura, leases herdadas incertas, falha de disco na liberação, aliases/subpastas/worktrees/pastas extras, ciclos, dependência sem aceite, substituição de pré-requisito, preservação de aceite histórico, revisão final atual, novo resultado sem alteração de bytes, persistência após restart, rollback de parecer/proposta, override de squad, sandbox efetivo e edição durante classificador assíncrono. Os fixtures de revisão têm checks explicitamente sintéticos: não são testes reais de projetos executados por modelos.

## Continuação

R5: corpus A/B e medição de custo/qualidade/latência, incluindo classificador, revisões e retries. Redução real de tokens e superioridade sobre Overclock ainda não foram comprovadas.

R6: integrar interface e mascote aos estados reais; executar o cenário de código versionado Claude implementando → Codex revisando, recuperação entre entrega e consumo e cenário inverso. Não houve chamadas a modelos reais nesta retomada. Esses gates continuam necessários antes de promover um candidato para uso diário.
