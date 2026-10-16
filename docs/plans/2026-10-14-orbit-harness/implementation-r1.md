# Relatório de implementação — R1

14/10/2026. Continuação autorizada da implementação no checkout local, preservando o trabalho anterior. R1 acrescenta o registro de atividade/tentativa/resultado e contabilização por sessão. Mantém Tauri, React, Node, MCP e PTYs existentes.

## Comportamento implementado

| Fronteira | Resultado |
|---|---|
| Antes de abrir um agente | Reserva de atividade, tentativa, número do terminal e obrigação de entrega persistida antes da classificação assíncrona e do processo |
| Configuração efetiva | CLI, modelo e conta registrados antes da construção do comando; snapshot da tentativa conserva os demais parâmetros |
| Abertura interrompida | Tentativa permanece consultável, sem execução automática repetida; a obrigação continua bloqueando missão pronta |
| Repetição intencional | `retryReason` cria tentativa separada; repetir a mesma justificativa reutiliza sua tentativa |
| Mudança de aceite/escopo | Revisão explícita com justificativa; cada tentativa conserva o hash e os critérios originais |
| Entrega | Resultado, obrigação, projeção do terminal, registro legado e evento são gravados no mesmo snapshot antes da resposta |
| Histórico | Resultados sobrevivem ao limite de 200 eventos e ao fechamento do terminal; reenvio idêntico conserva `resultId` e não repete o aviso |
| Contagem | Baseline por CLI/conta/sessão; relatórios menores não reduzem a referência nem voltam a gerar cobrança no próximo relatório |
| Transação de uso | Baseline, missão, dia, ledger e uso do terminal persistem juntos; falha de disco desfaz a mutação em memória |
| Migração | Estado legado é importado uma vez, sem cobrar novamente o uso já registrado |

Os contratos estão em [protocol](../../../packages/protocol/src/index.ts), com lógica de identidade em [activityLedger.ts](../../../packages/sidecar/src/activityLedger.ts) e contagem em [sessionAccounting.ts](../../../packages/sidecar/src/sessionAccounting.ts). O [Store](../../../packages/sidecar/src/store.ts) mantém uma transação por snapshot, sem adicionar banco ou framework.

O arquivo temporário recebe `fsync` antes do rename. Os testes cobrem morte do processo após o commit, não perda de energia do equipamento nem uma garantia de durabilidade física do filesystem.

## O que o líder pode consultar

- `activity_status`: atividades e tentativas, incluindo reservas paradas sem terminal. `activityId` consulta uma atividade específica. Snapshots completos dos terminais não são repetidos na resposta.
- `handoff_submit`: devolve `resultId` após persistir. Reenvio reconhecido devolve o mesmo identificador e informa que não enviou outro aviso.
- `handoff_list`: últimos 20 resultados por padrão; `resultId` busca um resultado, `after` busca os seguintes e `limit` limita a resposta. Consulta restrita à missão do agente.
- `mission_briefing`: usa os resultados persistidos, mesmo quando seus eventos já saíram do fluxo.
- `mission_status`: conserva as obrigações pendentes, incluindo uma reserva cuja abertura falhou.

Um resultado `done` é uma entrega declarada com evidência, registrada como `submitted`; a atividade fica `awaiting_validation`. A validação independente vinculada ao diff permanece em R4. Retorno automático fica `unverified` e não satisfaz a obrigação.

O identificador interno devolvido por `activity_status` também é aceito por `agent_spawn` na mesma missão, preservando a identidade quando outro líder retoma o trabalho.

## Verificação

Os cenários iniciais foram reproduzidos em vermelho antes das correções: relatórios fora de ordem, mesma sessão em dois terminais, troca de sessão no mesmo processo, reserva inexistente antes do comando, ausência de recibo persistente e mudança de aceite silenciosa. Também foram reproduzidos o caso de uma status line com identificação de sessão quando o hook inicial não chegou e a marcação incorreta de `deliveredAt` no commit de progresso antes da atualização do terminal.

[activityLedger.test.ts](../../../packages/sidecar/test/activityLedger.test.ts) cobre abertura, falha, erro de disco, histórico, critérios e dois testes com processo filho encerrado por `SIGKILL`: após reservar e após persistir resultado. A reabertura conserva os identificadores; a repetição não cria uma segunda tentativa ou resultado. [sessionAccounting.test.ts](../../../packages/sidecar/test/sessionAccounting.test.ts) cobre dez cenários de contagem, retomada e persistência. [mcp.test.ts](../../../packages/sidecar/test/mcp.test.ts) verifica a consulta real por HTTP/MCP, cursor, isolamento de missão e reenvio após a remoção dos eventos.

| Comando | Resultado, exit 0 |
|---|---|
| `npm test` | 125/125 sidecar + 2/2 desktop, zero falhas |
| `npm run typecheck` | Todos os workspaces sem erros |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS gerado |
| Node 24.21.0 empacotado: ledger, contagem, MCP e obrigações | 28/28 testes, zero falhas |
| `git diff --check` | Sem erros de whitespace |

Logs e hashes: [execution-r1/validation.json](execution-r1/validation.json). O build ainda informa o aviso existente de chunk JavaScript acima de 500 kB; divisão de bundle não foi objeto desta etapa.

Bundle local: `/Users/lucas/Documents/GitHub/Orbit/apps/desktop/src-tauri/target/debug/bundle/macos/Orbit.app`. O aplicativo instalado permanece separado deste build. Não houve commit, push, publicação, instalação global de skills ou chamadas a modelos para os testes desta etapa.

## Limites e próximo passo

R2 implementará adapters com capacidades verificadas, identidade de execução por epoch e fila durável de avisos com níveis de ACK. Hoje o resultado permanece consultável se o processo morrer antes do aviso, mas o aviso ainda não tem replay durável nem confirmação de consumo pelo CLI. Eventos atrasados de execuções anteriores ainda precisam das proteções de R2.

A identificação de sessão vem dos hooks/status Claude e do arquivo de sessão Codex. Sem identificador, a referência é provisória por terminal/abertura. Dois processos que reportem uso sem qualquer identidade não podem ser reconhecidos como a mesma conversa. Um contador menor com o mesmo identificador é tratado como relatório atrasado; reset real exige sinal explícito do adapter. Migração preserva os registros ainda existentes e não reconstrói tentativas ou dados que versões antigas já descartaram.

O histórico usa o snapshot JSON existente; avaliação de escala, latência e economia é parte de R5. A contagem correta elimina duplicação no painel e em limites de orçamento; não demonstra redução dos tokens efetivamente consumidos pelos modelos. Contexto/skills sob demanda continuam em R3. Interface e mascote ligados ao motor permanecem em R6.

O gate de uso diário ainda requer o cenário completo de código com Claude e Codex reais, troca de revisão, validação independente e recuperação após interrupção. Os testes desta etapa usaram processos sintéticos e homes de teste, sem repetir a validação anterior com os CLIs reais.
