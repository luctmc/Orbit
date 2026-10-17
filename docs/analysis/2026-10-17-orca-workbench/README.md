# Orbit: continuidade e recibos, com adaptação criteriosa do Orca

Baseline: `origin/main` f5d9075 (PR54), após PR53. App encontrado: 0.2.23.
Checkout histórico Orbit preservado; checkout limpo Orbit-default-bypass reutilizado na
branch feature/orbit-orca-workbench. Nenhuma nova pasta irmã. Pesquisa em `.research/orca`, ignorada.

## Análise e recorte de reutilização

Orca fixado em [100b6b1efe1508d6a2c70945417e4fd8e4a26d23](https://github.com/stablyai/orca/tree/100b6b1efe1508d6a2c70945417e4fd8e4a26d23).
Licença raiz MIT, copyright (c) 2026 Lovecast Inc. Não confundir marca comercial com licença de código.

Módulos lidos integralmente antes da adaptação da seleção:

- `src/renderer/src/store/terminals/workspace-terminal-active-tabs.ts`: seleção por proprietário,
  validação de IDs e migração de sessão antiga. **Código adaptado** em `missionSelection.ts`:
  missões substituem worktrees, IDs numéricos estáveis existentes do Orbit substituem tabs;
  validação mais restrita exige que o pane pertença à missão; falta/corrupção usa líder.
- Suas duas dependências de tipo `src/shared/terminal-tab-types.ts` e
  `src/shared/workspace-session-state-types.ts`: identidade durável, processo/incarnation e
  preferências da tela são domínios distintos. Nenhuma dessas dependências foi importada.
- Consumidores `workspace-terminal-hydration.ts`, `workspace-layout-frame-slices.ts`, teste
  `restored-relay-session-identity.test.ts`: restaurar uma seleção não deve criar processos;
  ausência de ligação não prova encerramento. Testes Orbit próprios cobrem a adaptação.

Outras áreas examinadas (orientam desenho, sem transplante de seus módulos):

- `workspace-layout-cache.ts` e teste: frames do runtime são autoridade; snapshots iguais retêm
  identidade. Orbit já mantém panes keyed e transporte separado de React. Preservado, sem
  introduzir o subsistema distribuído do Orca. Não foi copiado o cache nem seu stableJson.
- `stable-pane-id.ts`, `terminal-pty-identities.ts`, `terminal-tab-location.ts`: pane durável não
  equivale a processo. Orbit já tem pane.id e executionEpoch; mantidos os IDs existentes.
- `hooks/composer-state/draft-target-sync.ts` e teste: rascunho persiste com o alvo, não com a tela.
  Orbit já tem DurableMap por pane; mantido e exercitado em navegação/recarga.
- `agent-launch-model-preferences.ts`, `agent-session-option-launch.ts`,
  `agent-session-option-catalog.ts`: só afirmar opções efetivamente aplicáveis, e distinguir
  valores pedidos dos valores aplicados. A solução usa DecisionReceipt e adapters Orbit;
  nenhuma cópia do catálogo Orca nem de suas dependências de provider.
- `cli/handlers/orchestration/message-send-handler.ts` e
  `orchestration-send-receipt-warnings.test.ts`: aceito/enfileirado não é conclusão da tarefa.
  Orbit já tem journal durável e ACK do PTY; agora o ACK ganha epoch/horário e é visível.
  O mecanismo de relay/dispatch do Orca não foi importado.
- Teste `agent-paste-draft-submit-retry.test.ts`: transações de paste/Enter têm concorrência
  própria. Não copiado: Orbit já serializa paste/Enter no sidecar; repetição de Enter do Orca
  não deve ser introduzida indiscriminadamente. Guarda síncrona no compositor e coalescência
  no cliente cobrem o risco específico de duplo evento na mesma atualização React.

Documentação consultada: [panes e splits](https://www.onorca.dev/docs/model/tabs-panes-splits),
[restauração](https://www.onorca.dev/docs/model/session-restore),
[Codex](https://www.onorca.dev/docs/agents/codex),
[orquestração](https://www.onorca.dev/docs/cli/orchestration),
[terminal](https://www.onorca.dev/docs/terminal).

Licenças transitivas do código adaptado: nenhum import de runtime; upstream só importa tipos
locais MIT. A adaptação usa apenas tipos `@orbit/protocol` existentes. Não houve alteração de
package-lock ou adição de dependência. Electron, daemon Orca, Zustand, assets e marca não
foram incorporados. Licença completa e fonte em THIRD_PARTY_NOTICES.md, também empacotada
como recurso Tauri. Dependências próprias do Orbit continuam sob suas licenças existentes.

## Intenção visual e implementação

Pessoa: operador que retorna de outra missão, precisa identificar quem pede atenção e conversar
com o líder sem perder contexto. Verbo principal: encaminhar uma mensagem ao destinatário certo.
Sensação: bancada técnica, densa e previsível.

Conceitos: missão, tripulação, liderança, despacho, recibo, execução, telemetria.
Cores físicas: grafite do console, preto do terminal, branco de etiquetas, verde de confirmação,
âmbar de atenção. Todas mapeadas aos tokens existentes; Geist/Geist Mono preservados.
Assinatura: trilha missão → agente → execução → recibo, com IDs que permanecem os mesmos.
Rejeições: cards grandes de métricas → terminal prioritário; repetir agentes fora da missão →
árvore de navegação aninhada; “enviado” genérico → aceite do terminal com ID/epoch/horário.

Hierarquia: missão no cabeçalho, agentes dentro da missão selecionada na navegação,
atenção expressa por texto e fundo sutil, sem depender só da cor. Detalhes de roteamento ficam
no menu do pane para não aumentar a altura de cada terminal.
Profundidade: superfícies/bordas existentes, sem sombras/gradientes novos.
Tipografia: mesmos tokens, metadados pequenos e corpo de digitação 16 px em janelas pequenas.
Espaçamento: unidade 4 px e densidade 8–16 px; recibo compacto perto do texto enviado.

Mudanças concretas:

1. Seleção por missão restaurada/validada, incluindo navegação e notificações. O snapshot inicial
   torna-se um estado explícito: abrir WebSocket com inventário ainda vazio não apaga seleção.
2. Colunas por missão, com migração da preferência global anterior; divisores existentes mantidos.
   Modo terminal/conversa por pane persiste. Panes/terminais não recebem keys de layout.
3. Seletor de destinatário acessível também em janela pequena e modo Foco. Compositor inativo em missão oculta interrompe ditado; preserva o rascunho. Ajudante tem
   ação explícita “Conversar com líder”, com rascunhos separados.
4. Recibo de envio guarda requestId, paneId, executionEpoch e acceptedAt do journal; consultas
   ao mesmo pedido retornam o mesmo aceite. UI diz que o terminal confirmou, sem inventar
   leitura/resposta do agente. Recibo persiste no renderer e fica separado do próximo rascunho.
5. Contrato por pane expõe solicitado, resolvido, aplicado e observado. Configuração vem de
   DecisionReceipt e AgentLaunch, observações vêm dos readers existentes, com origem
   contexto de execução ou resposta. Contexto CLI não certifica roteamento interno do provedor.
   Uma observação nova não mistura modelo novo com effort antigo. Epoch novo começa sem
   observações antigas. Execuções históricas são rotuladas sem recibo, sem fabricar dados.
6. Dois eventos de envio no mesmo turno React compartilham uma operação na rede e uma
   entrega no sidecar. Rascunho só limpa após confirmação. Bypass PR54 permanece intacto.

## Evidências

Ver arquivos journey-*.json (Chromium e WebKit), workbench-*.png e audit-*.png.
A jornada usa sidecar, WebSocket, journal e PTYs reais; a CLI é um test double determinístico,
sem API de inferência. Não confundir este ensaio com um turno real Claude/Codex.
Prévia aberta via MCP Overclock em http://127.0.0.1:5389 (pane-170).

A primeira tentativa encontrou erro no seletor do teste (AgentChooser usa role radio).
A seguinte revelou que a fixture Livre tentava dois writers na mesma cópia: a proteção Orbit
recusou corretamente. A fixture passou a missões Agênticas, com líderes read-only.
A jornada então revelou uma regressão real na seleção durante startup; corrigida com snapshotReady.

Testes e instalação finais são registrados nesta pasta após execução.

Limites: não há referência atual autorizada da tela Overclock para comparação pixel a pixel;
nenhuma alegação de identidade visual exata. Sem migração para Electron, daemon persistente ou
árvore de splits arbitrários. O app mantém seu ciclo Tauri/sidecar existente ao encerrar/reabrir.
O tema do produto é escuro; não há tema claro implementado a declarar validado.

skills: inline [oc-showcase].

Validação final de implementação: 313 testes sidecar, 39 desktop, 6 scripts e typecheck
aprovados. Jornada Chromium 42/42 e WebKit 42/42, com envio desktop e 375 px,
troca de destinatário em Foco, continuidade de nós xterm/um attach por pane,
rascunhos por destinatário e missão, recarga com seleção e modo conversa restaurados.
A auditoria adicional bloqueia entrega se o processo muda enquanto a tradução prepara o texto.

## Instalação e execução nativa

Build local **0.2.24**, fonte de implementação `ca0f78bd43f0a1a4c95c3ba31d1bb771bf1c4624`,
concluído por `npm run release -- 0.2.24` (sem --publish). Convenção existente preservada:
cinco arquivos de versão ajustados só durante o build e restaurados byte a byte depois.
O recurso de avisos MIT foi mantido na configuração Tauri. Não houve novo código de app
após esse build; apenas evidências/scripts de verificação foram adicionados.

`/Applications/Orbit.app` atualizado diretamente, assinatura ad hoc verificada com
`codesign --verify --deep --strict --all-architectures`. Os **64 arquivos** instalados são
idênticos ao bundle local (installed-manifest.json). Executável em execução mapeia o inode
instalado, e seu filho é o sidecar empacotado. Ver installed.json para hashes SHA256 completos.
Os **1.118 arquivos privados** sob ~/.orbit mantiveram os hashes durante a troca do bundle;
nenhum diretório de dados foi apagado ou recriado. Logins Claude e Codex continuam válidos.
A primeira leitura após `open` ocorreu antes de o filho iniciar; a seguinte comprovou o runtime.

`native-live.json`: **9 verificações nativas**, sem erros, no sidecar instalado e Codex real.
Líder sem objetivo; solicitado/aplicado GPT-6 Luna low; recibo PTY com epoch e horário;
repetir o requestId devolve o mesmo recibo; resposta **do agente** contém ORBIT_QA_RECIBO_OK
(não foi contada a mensagem da pessoa); reader observou modelo gpt-6-luna e effort low como
**execution-context**, sem afirmar roteamento interno do provedor. Ajudante tem PID e epoch
próprios e informou sessionId real antes de encerrar o ensaio. Missão QA arquivada, entrada
QA de workspace removida; conversas da CLI preservadas. Nenhuma missão do usuário foi alterada.

Limite encontrado: na fixture programática dentro de Documents, o login shell ficou parado
em `/usr/libexec/path_helper`, bloqueado em open/fts_open, antes de chegar ao Codex. O journal
confirmou criação e permitiu reconciliar a operação sem duplicá-la. Em diretório isolado sob
/private/tmp, o fluxo real passou. Isso sugere controle de acesso do macOS à pasta protegida;
a causa TCC não foi certificada nem contornada alterando permissões/configurações do usuário.
Portanto a jornada real não certifica a seleção de pasta Documents por diálogo nativo.

UI verificada visualmente em Chromium/WebKit; pixels da janela WKWebView nativa não foram
capturados nesta execução. Nenhuma captura ou interação de tela do Overclock foi usada.
CI GitHub da implementação passou (typecheck, 313+39 testes, frontend/sidecar build e cargo check).
A assinatura local é ad hoc; não há alegação de notarização Apple.
