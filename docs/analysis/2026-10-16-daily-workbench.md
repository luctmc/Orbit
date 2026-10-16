# Orbit 0.2.15 — bancada diária, execução nativa e limites observados

## Resultado instalado

Orbit 0.2.15 instalado em `/Applications/Orbit.app` e aberto no perfil normal. O app anterior está em `/Applications/.Orbit-backups/2026-10-16-daily-0.2.15/Orbit.app`. A instalação não copiou perfis de autenticação nem credenciais. Assinatura ad hoc local conferida com `codesign --verify --deep --strict`; não se trata de notarização/Developer ID.

O perfil preservou seus dois workspaces, duas missões e as sessões #7 Codex e #11 Claude. A comparação dos hashes dos IDs de sessão antes/depois confirmou a retomada das mesmas conversas. Não foi enviada mensagem a essas conversas durante a verificação desta rodada. O usuário pode continuar usando o app aberto.

Evidências: [instalação](2026-10-16-daily-install.json), [recuperação](2026-10-16-daily-recovery.json), [assinatura](2026-10-16-daily-codesign.log), [captura do app instalado](2026-10-16-daily-installed.png).

## Experiência de uso

- Início organizado em continuar trabalho, criar missão, buscar e escolher projeto; atividade e consumo recolhíveis.
- Conversa central com identificação distinta de pessoa/líder, hierarquia de títulos/listas/citações e blocos de código copiáveis. O renderer não executa HTML e aceita somente links HTTP(S) seguros; é um subconjunto de Markdown, sem tabelas ou imagens inline.
- Campo do líder com rótulo claro, crescimento do texto e confirmação após ACK do motor. Anexos e ditado preservados. Tab insere a sugestão e não envia; Enter envia.
- Menus agrupam ações de manutenção; ações frequentes continuam visíveis. Escape fecha o menu e retorna o foco ao botão. O terminal permanece disponível e carrega sob demanda.
- Novo workspace explica pasta principal e nome, apresenta falhas no formulário e só fecha após confirmação de gravação durável. Seletor de pastas nativo preservado; a escolha pelo seletor do macOS não foi exercitada nesta rodada.
- UI com componentes reais e conteúdo sintético conferida nas larguras 375, 768, 1024 e 1440; sem overflow horizontal da página. Capturas: [início](2026-10-16-daily-home.png), [líder](2026-10-16-daily-leader.png), [workspace](2026-10-16-daily-workspace.png). O projeto tem tema escuro; não foi criado modo claro. Motion reduzido é respeitado pelas regras CSS.

## Confiabilidade do motor

O transporte abre antes da descoberta opcional e da recuperação de sessões. A interface recebe estado individual de recuperação, catálogo, contas, CLIs e skills, inclusive erro. A descoberta de skills externas passou a usar I/O assíncrono limitado.

Quota ausente, velha, futura, expirada ou com falha não vira 0%. Evidência anterior de saturação continua bloqueando até leitura nova. O reset de várias janelas bloqueadas considera a última renovação. Assinaturas alternativas são procuradas antes de API paga; instalação/login são requisitos para seleção automática real. O caminho adaptativo exige duas janelas recentes e margem de 85%; o fallback legado ainda permite assinatura com quota desconhecida quando não há leitura confirmada, explicitando a ausência.

O terminal do motor responde às consultas de dispositivo da CLI, mesmo com a interface só na conversa. O terminal visual filtra suas próprias respostas de dispositivo para evitar duplicação. Um teste de PTY reproduziu o bloqueio antes da correção e passou depois.

Workspace é confirmado somente após persistência e falha de disco faz rollback da edição. Estado de versão desconhecida gera erro e preserva os bytes originais. A finalização exige execução atual: `mission_ready(force=true)` é rejeitado mesmo com texto dizendo que o usuário autorizou. Agentes não podem dispensar trabalho ou revisão obrigatória por esse caminho. Não foi criada nesta rodada uma interface humana para dispensas individuais.

## Piloto nativo: duas tarefas, sem promoção

Somente `op-build` e `bug-mean`, corpus público em pastas temporárias. Codex com `gpt-6-luna`, esforço `low`, executado pelo PTY/MCP/ledger reais do Orbit. Nenhum código privado foi enviado ao piloto. Confiança foi confirmada somente nas duas pastas explicitamente autorizadas.

1. Primeira passagem ficou no diálogo de confiança; falhas foram preservadas.
2. Após autorização, ambas iniciaram e chamaram ferramentas. O teto inicial de 40 mil tokens interrompeu as duas antes do handoff: 41.314 e 42.951 tokens reportados.
3. As mesmas sessões foram retomadas uma vez. Ambas entregaram `handoff_submit`; depois de encerrar os escritores, o oracle local independente confirmou artefato de build e correção de `mean`, preservando fixtures protegidas e escopo de escrita. **2/2 entregas com oracle aprovado.** O journal original mantém suas falhas.

Relatórios: [passagem inicial](2026-10-16-daily-native-pilot.json), [execução autorizada interrompida](2026-10-16-daily-native-pilot-authorized.json), [continuação](2026-10-16-daily-native-continuation.json).

Limites: controlador local e oracle executável, sem maestro LLM/revisor LLM nesta medição. Consumo cumulativo observado na retomada: 207.290 e 195.691 tokens, incluindo 176.896 e 149.632 de cache lido. A retomada invalida a atribuição certificada por tentativa; os valores não promovem benchmark. USD permanece desconhecido. O teto de tokens é observado por polling e pode ser ultrapassado durante um turno e antes da próxima leitura; não é uma reserva transacional no provedor. Não há comprovação de economia causal ou de modelo vencedor. Nenhuma política foi promovida. A correlação de modelo/esforço por resposta segue incompleta.

Não iniciamos nova tarefa de inferência no Claude: o app reportava 93% semanal, acima da margem do piloto. A sessão Claude existente foi retomada, mas isso não equivale a um novo benchmark funcional de edição/revisão.

## Desempenho e contexto

Motor empacotado com perfil vazio: handshake em 305 ms e primeiro snapshot em 323 ms, nesta máquina e nesta execução. Todos os cinco serviços concluíram; gravação de workspace durável e MCP sem autenticação retornando 401 foram conferidos. É uma medição isolada do motor, não do tempo total da janela ou da recuperação de projetos grandes. [Smoke empacotado](2026-10-16-daily-packaged-smoke.json).

Bundle JS inicial: 784,78 → 447,70 kB; terminal separado de 337,24 kB, carregado quando necessário. Gzip inicial: 217,79 → 132,41 kB. O mascote raster existente continua com aproximadamente 921 kB.

Pack do líder sem memória: 11.330 → 5.921 bytes UTF-8; helper de revisão: 3.980 → 2.666. Métodos de tarefa, instruções de squads e restrições de revisão permanecem. O prompt agora informa o attemptId disponível e não exige consultar quadro inexistente. O schema do spawn em lote não repete descrições longas de cada campo. Essas medidas **não são porcentagens de economia de tokens** e não incluem todo o contexto nativo/skills/tools da CLI. [Antes](2026-10-16-daily-context-before.json), [depois](2026-10-16-daily-context-after.json).

## Gates executados

| Gate | Resultado |
|---|---|
| Motor completo, Node 24 | 269/269, exit 0 |
| Desktop completo | 25/25, exit 0 |
| Typecheck dos workspaces | exit 0 |
| Build do frontend e motor | exit 0 |
| Build macOS 0.2.15 | exit 0 |
| Assinatura local do pacote | válida após reassinatura ad hoc |
| Smoke do motor empacotado | passou, zero tarefas de modelo |
| Piloto Codex retomado | 2/2 handoffs + oracles locais |
| Recuperação do perfil normal | 2/2 sessões preservadas |
| `git diff --check` | exit 0 |

Logs em `2026-10-16-daily-{sidecar-tests,desktop-tests,typecheck,app-build}.log`. Teste vermelho do bypass preservado em `2026-10-16-daily-agent-waiver-red.log`; regressões de conclusão/retomada: 17/17 em `2026-10-16-daily-readiness-tests.log`. Não houve commit, push ou publicação.

## O que continua aberto

Este lote não equivale à execução completa dos 66 itens do ORBIT 10 nem a uma certificação universal de uso diário.

- Failover durante uma tarefa com classificação confiável de quota, sobrecarga e autenticação, cooldown e garantia de não repetir efeitos.
- Teste com duas contas reais autenticadas por provedor; depende de contas fornecidas/logadas pelo usuário. O fluxo de adicionar conta existe, mas não substitui esse teste.
- Matriz maior com holdout e identidade completa por resposta. O piloto de dois casos não autoriza ativar aprendizado nem ampliar chamadas automaticamente.
- Consolidação adicional das ferramentas MCP; o líder ainda não atingiu a meta de 33/34 ferramentas.
- Auditoria/recuperação de leases órfãs, integração sob cenários de caos e demais itens de ciclo de vida do plano original.
- Revisão de fonte ainda é síncrona em alguns caminhos; arquivos grandes/submódulos não suportados falham de modo conservador. Sucesso no corpus pequeno não resolve esses casos.

A próxima entrega deve começar por falhas tipadas e recuperação sem duplicação, mantendo estas evidências e as falhas anteriores no histórico. Não apresentar “100% confiável”, “10/10” ou redução drástica de tokens como resultado desta rodada.
