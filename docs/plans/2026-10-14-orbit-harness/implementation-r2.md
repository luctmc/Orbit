# Relatório de implementação — R2

Continuação autorizada em 14/10/2026. Adaptadores, identidade de execução e avisos recuperáveis implementados no checkout, preservando o trabalho anterior. Mantém Node, JSON, MCP e PTYs existentes.

## Comportamento

| Fronteira | Comportamento aplicado |
|---|---|
| Abertura/reabertura | Epoch novo persistido antes do processo; uma conversa retomada mantém o baseline por sessão de R1 |
| Requisição antiga | Identidade revalidada depois da leitura HTTP e antes das ferramentas; request capturado antes de substituir processo, papel ou atribuição é recusado, assim como requests terminados após a saída do processo |
| Classificação/interrupção assíncrona | Revalidação antes de abrir helper e depois da espera de interrupção, incluindo o destinatário |
| Retorno em conexão nova | `attemptId` opcional do `handoff_submit` recusa resultado associado a outra atribuição; `whoami.agent.attemptId` fornece o identificador |
| Persistência do resultado | Resultado e aviso gravados no mesmo snapshot; entrega para revisor também grava sua obrigação antes do ACK |
| Destino indisponível | Aviso permanece pendente; líder lógico é resolvido novamente no despacho, e revisor explícito aguarda seu processo reabrir |
| Reabertura/troca de líder | Avisos sem confirmação explícita podem ser reenviados ao novo epoch, preservando o identificador |
| Recebimento pelo terminal | Só avança após escrever o Enter; fila coalescida conserva um callback por aviso |
| Falha do PTY | Falha de paste/Enter não confirma recebimento nem escapa como erro de timer; processo é retirado para não acrescentar texto a um buffer incerto |
| Confirmação pelo agente | `delivery_ack` valida missão, destinatário e epoch atendido; ACK repetido é idempotente |
| Progresso atrasado | Não reabre tentativa já entregue; uma duplicata já conhecida conserva o recibo original |

## Níveis de recebimento

1. `persisted`: resultado e aviso estão gravados.
2. `pty_accepted`: os bytes e o Enter foram escritos ao PTY daquela execução. Não comprova que o CLI consumiu o conteúdo.
3. `agent_acknowledged`: o agente chamou `delivery_ack` com o identificador do aviso. Não equivale a aceite do código.

`delivery_status` consulta os recibos. A mensagem inclui `deliveryId` e `resultId`; os prompts orientam a ler, confirmar e reconhecer duplicatas. O reenvio de `handoff_submit` reutiliza o aviso existente. O motor não repete comandos de código para recuperar um aviso.

O transporte é **pelo menos uma vez**: morrer após escrever o Enter e antes de persistir o recibo pode repetir o aviso. A confirmação explícita encerra seu replay. Recibos já confirmados não geram novo aviso apenas porque outro processo abriu; o histórico continua consultável pelo novo líder. Não há promessa de execução externa exatamente uma vez.

## Adaptadores

- [Claude](../../../packages/sidecar/src/adapters/claude.ts): normaliza hooks e status, conserva entrada de ferramenta para os gates existentes e rejeita campos conhecidos de tipos incompatíveis.
- [Codex](../../../packages/sidecar/src/adapters/codex.ts): interpreta os formatos existentes de rollout; cursor por epoch ignora turnos antigos, repetidos ou sem timestamp utilizável. IDs distintos no mesmo timestamp continuam válidos; os últimos 256 IDs daquele timestamp são conservados.
- [Gemini](../../../packages/sidecar/src/adapters/gemini.ts): normaliza o dialeto e conserva a conversão da resposta de hooks.
- [Capacidades](../../../packages/sidecar/src/adapters/types.ts): catálogo informa versão detectada quando disponível e origem `adapter-fixture`. Leitura de imagem e filtragem de visibilidade de skills permanecem desconhecidas; ACK nativo de consumo do provider não é declarado como disponível.

Os parsers anteriores continuam como base. Esta extração não altera o protocolo dos providers nem instala ferramentas em suas contas. Evento desconhecido não é inventado como transição conhecida. Um timestamp ausente não autoriza concluir um turno Codex retomado.

## Persistência e migração

[deliveryQueue.ts](../../../packages/sidecar/src/deliveryQueue.ts) define destinatário e replay; [store.ts](../../../packages/sidecar/src/store.ts) mantém `notifications`, `executionEpochs` e cursores de turno no snapshot. Resultado/aviso/obrigação usam o commit conjunto de R1. Recibos de envio e confirmação fazem flush antes de retornar sucesso.

R1 não possuía confirmação de leitura. A migração importa uma vez o último resultado notificável de cada tentativa como `persisted`, sem inventar consumo histórico. Isso pode reapresentar resultados antigos após a atualização. O resultado original permanece identificável, e a atividade não é reexecutada por essa migração. Exclusão de missão remove seus avisos; fechamento de processo invalida seu epoch e cursor.

## Verificação

As regressões foram executadas em vermelho antes das correções: resultado e uso de processo antigo, ausência de outbox, resultado antigo sobre nova atribuição no mesmo processo, reenvio com tentativa antiga em conexão nova, obrigação do revisor fora do commit e erro não tratado no Enter adiado. O teste de integração existente também revelou que o resumo dos critérios precisava continuar presente no aviso; o resumo foi preservado na fila durável.

Os testes exercitam HTTP com corpo parcial autenticado antes de restart nos três endpoints, MCP real com ACK autorizado/negado, recuperação após shutdown, morte do processo filho por `SIGKILL` logo após commit, erro de disco, revisor parado, troca de líder, migração repetida, formatos desconhecidos e coalescência de avisos. As evidências finais estão em [execution-r2/validation.json](execution-r2/validation.json).

| Comando | Resultado final, exit 0 |
|---|---|
| `npm test` | 144/144 sidecar + 2/2 desktop; 146 testes, zero falhas |
| `npm run typecheck` | Todos os workspaces sem erros |
| Node 24.21.0 empacotado: adapters, epochs, fila, PTY, MCP e contagem | 32/32 testes, zero falhas |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS local gerado |
| `git diff --check` | Sem erros de whitespace |

Bundle: `/Users/lucas/Documents/GitHub/Orbit/apps/desktop/src-tauri/target/debug/bundle/macos/Orbit.app`. O build conserva o aviso existente de chunk JavaScript acima de 500 kB; isso não foi alterado nesta etapa.

## Limites

- Fixtures e processos sintéticos não substituem uma rodada completa de código nos CLIs reais. Compatibilidade universal por versão não foi demonstrada.
- Epoch e identidade capturada protegem requests antigos. Um provider que envie um novo request sem identidade de turno não permite provar a qual tarefa anterior seu conteúdo pertence. `attemptId` é recomendado e validado quando informado; permanece opcional para compatibilidade. Não se infere essa identidade de texto ou silêncio do terminal.
- O cursor cobre os turnos Codex reconhecidos; não é um log canônico de todos os eventos possíveis dos providers. Hooks de autorização continuam avaliando os gates atuais em cada chamada.
- A fila desta etapa recupera **avisos de resultados**. Mensagens arbitrárias de `agent_send`, nudges e comandos de código não foram convertidos em uma fila durável de mutações.
- Não houve benchmark de economia ou latência. Replay e ACK têm custo; contexto/skills sob demanda continuam em R3 e comparação de qualidade/custo em R5.
- O build é local. O app instalado não foi substituído, e não houve commit, push, publicação ou chamadas a modelos nos testes desta etapa.

Próxima etapa: R3, contexto e skills sob demanda. A validação independente do resultado no diff permanece em R4; interface e mascote ligados ao estado real, em R6. O gate de uso diário continua pendente do cenário completo com os CLIs reais e recuperação entre entrega e consumo.
