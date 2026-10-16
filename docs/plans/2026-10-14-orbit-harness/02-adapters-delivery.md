# R2 — adapters e avisos recuperáveis

**Goal:** preservar avisos de resultados após interrupção e recusar eventos de execuções substituídas.
**Architecture:** manter os parsers e PTYs existentes. Separar normalização por CLI, identidade de execução e outbox persistente; gravar resultado e aviso numa única transação. O transporte pode repetir um aviso com o mesmo id após uma queda; confirmação explícita pelo agente encerra o replay.
**Stack:** TypeScript, Node 24, JSON com fsync/rename, MCP e node-pty existentes.

## Restrições

- Preservar alterações anteriores; execução inline autorizada. Sem novos agentes, banco, chamadas a modelos, instalação ou publicação.
- `persisted`, `pty_accepted` e `agent_acknowledged` são níveis diferentes; nenhum significa validação do código.
- Epoch muda em cada abertura do processo, mesmo ao retomar a mesma conversa. O contador da conversa continua por sessão.
- Formatos desconhecidos ficam sem capacidade comprovada. Não inferir leitura de imagens ou ACK nativo do provider.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/protocol/src/index.ts` | Epoch e contrato público dos avisos |
| `packages/sidecar/src/adapters/{types,claude,codex,gemini}.ts` | Normalizar entradas dos CLIs e declarar limites das capacidades |
| `packages/sidecar/src/deliveryQueue.ts` | Destinatário lógico, níveis de ACK e seleção de replay |
| `packages/sidecar/src/store.ts` | Commit conjunto, migração e recibos duráveis |
| `packages/sidecar/src/core.ts` | Fence de execução e despacho para destinatário atual |
| `packages/sidecar/src/panes.ts` | ACK após escrever Enter, conservando a coalescência de mensagens |
| `packages/sidecar/src/{server,mcp,prompts}.ts` | Revalidar identidade após await, consultar e confirmar aviso |
| `packages/sidecar/test/{executionEpoch,deliveryQueue,adapters}.test.ts` | Regressões e interrupções nas fronteiras |

## Sequência e contrato

1. Escrever e executar regressões: caller antigo após restart, evento HTTP autenticado antes de aguardar corpo, resultado sem destinatário vivo e restart antes do Enter. Esperado inicial: falha.
2. Persistir epoch antes do processo. `assertCurrent(caller)` compara pane/epoch/missão/papel atual e impede mutações de requests capturados anteriormente. Revalidar depois de classificação e interrupção assíncronas.
3. `commitActivityResult` acrescenta um aviso ao mesmo snapshot do resultado. Aviso tem id estável, resultado, missão, destinatário lógico e histórico de entregas por epoch. Reenvio de resultado reutiliza o aviso.
4. `submitWithReceipt` mantém callback por mensagem; callback só ocorre após o Enter ser escrito. Fechar/substituir processo cancela callbacks pendentes.
5. Despachar ao líder atual ou pane explícito. Sem destino vivo, manter pendente. Mesmo epoch recebe no máximo um envio confirmado ao PTY; novo epoch pode receber novamente avisos sem ACK do agente. Não reenviar mutações de código.
6. `delivery_ack(deliveryId)` valida destinatário e epoch efetivamente atendido. `delivery_status` apresenta os níveis; não confundir sucesso do MCP com leitura do agente.
7. Adapters preservam gates de ferramentas/orçamento. Eventos Codex atrasados são filtrados por epoch e cursor de turno. Fixtures cobrem os formatos conhecidos, desconhecidos e Gemini.
8. Verificar cenários de falha de disco, morte após commit, migração repetida, troca de líder, identidade antiga e recuperação. Rodar suíte completa, typecheck, runtime empacotado e build debug. Registrar evidência em `execution-r2` e relatório R2.

As implementações completas e os testes executáveis ficam nos arquivos acima, com hashes no relatório final; o plano não duplica o código de produção. R3–R6 permanecem fora desta etapa.
