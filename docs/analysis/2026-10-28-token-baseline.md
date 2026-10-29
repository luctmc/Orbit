# Baseline local de contexto fixo — 28/10/2026

## Reprodução e método

Na raiz desta worktree:

```sh
npm ci
node packages/sidecar/test/tokenBaseline.ts
node --test packages/sidecar/test/tokenBaseline.test.ts packages/sidecar/test/command.test.ts
node --test apps/desktop/src/components/MessageComposer.browser.test.mjs
```

A fixture cria uma missão agêntica, um líder Claude e um helper Claude sem filhos, com perfil Orbit, sem memória, instruções extras, quadro ou tarefas. Usa o core, arquivos de lançamento, PTYs sintéticos e servidor MCP autenticado reais. `listTools` mede o catálogo efetivamente exposto a cada papel; não conta ocorrências no código nem usa uma lista histórica. Nenhuma CLI de provedor, conta real ou modelo é executado. As configurações ficam em diretório temporário, removido ao final.

Bytes são UTF-8. **Tokens estimados = bytes/4**, sem arredondamento: não são tokens medidos pelo tokenizer nem consumo faturado. O catálogo é serializado com `JSON.stringify(tools)`; schemas usam `JSON.stringify(tools.map(t => ({name:t.name,inputSchema:t.inputSchema})))`. Não há envelope de protocolo nem tools nativas/externas nessa soma. Paths absolutos nos hooks e nas instruções podem mudar os bytes entre máquinas/worktrees.

## Componentes

| Componente | Líder: bytes | Líder: tokens estimados | Helper: bytes | Helper: tokens estimados |
|---|---:|---:|---:|---:|
| Contrato de role | 5932 | 1483.00 | 2070 | 517.50 |
| Toolkit entregue (inclui referências) | 2635 | 658.75 | 2635 | 658.75 |
| Demais seções do role e separadores | 1636 | 409.00 | 1636 | 409.00 |
| Role completo preparado | 10203 | 2550.75 | 6341 | 1585.25 |
| Schemas de entrada MCP + nomes | 16489 | 4122.25 | 8989 | 2247.25 |
| Catálogo MCP completo (inclui schemas) | 26318 | 6579.50 | 15365 | 3841.25 |
| Configuração local dos hooks (JSON compacto) | 1390 | 347.50 | 1390 | 347.50 |
| Toolkit integral disponível sob demanda | 8010 | 2002.50 | 8010 | 2002.50 |

O líder recebe **40 tools**, o helper **28**. O helper não possui filhos nem permissão de spawn; helpers com filhos e missões com múltiplas pastas podem expor catálogos diferentes. O catálogo completo já inclui os schemas de entrada: essas duas linhas **não devem ser somadas**. O role completo já inclui contrato, toolkit e demais seções: essas linhas também não devem ser somadas novamente. O toolkit integral é fonte recuperável, não texto reenviado integralmente no lançamento.

Hooks são configuração local executada pela CLI. Seu tamanho dividido por quatro serve somente como comparação de volume; **não há evidência de que esse JSON entre no prompt**. Não somamos hooks aos tokens de contexto. Saídas futuras de hooks e de tools são variáveis, fora deste custo fixo.

## Veredito sobre D12

**CONFIRMADO quanto ao volume estático de schemas versus role nesta fixture.** Só os schemas de entrada + nomes superam o role completo: 16489 > 10203 bytes para o líder; 8989 > 6341 para o helper. O catálogo completo chega a 2.58× e 2.42× o role completo, respectivamente. Isso sustenta priorizar redução do catálogo numa etapa posterior, sem alterar tools nesta entrega.

**REFUTADO para a contagem histórica de 44–47 tools como valor universal:** o catálogo depende do papel e da topologia; aqui são 40/28. **NOT_PROVEN para “reenviadas/cobradas a cada turno” e “maior custo real”**: `listTools` e bytes locais não demonstram serialização pelo provedor, cache, cobrança ou participação no custo de uma missão real. Nenhuma economia percentual faturada é afirmada.

## F1 — envio ao líder

O composer usa `draft?.dispatch ?? 'continue'` para todos os panes. Dois envios sem alteração do seletor carregam `dispatch: 'continue'` para o mesmo líder. A fixture do core recebe esses dois envios explícitos e mantém dois panes (líder + helper), com dois ACKs para o líder. O teste de navegador verifica esses payloads e monta novamente o componente com um rascunho explícito `new-task`, preservando a escolha. A opção Nova tarefa continua disponível. O fallback histórico da API para clientes que omitem `dispatch` foi preservado; o composer sempre envia o valor explícito.

## F2 — resume do Claude e medição

`buildCommand` omite `--append-system-prompt` e o path do role no resume com receipt válido da política do toolkit; mantém a próxima mensagem quando fornecida. Sem receipt ou com política diferente, o core define `refreshRole: true` e Claude reaplica o role para migrar a política. No lançamento novo a flag permanece. Os metadados do toolkit indicam `inherited` no resume normal e `role` quando o role é reaplicado. Os demais adapters continuam migrando por mensagem, como antes.

A medição agora separa `preparedRoleBytes` (bytes do role gerado localmente, inclusive no resume) de `initialBytes`/`sourceBytes` (conteúdo inicial efetivamente selecionado para envio pelo adapter). Na fixture do líder: lançamento novo com 10203 bytes preparados; resume com 10203 bytes preparados e 0 bytes iniciais enviados, pois não há nova mensagem. Preparado não significa reenviado, retido ou cobrado. Na prova empírica fornecida pelo Maestro no brief B1-r1, Claude 2.1.312 em modo `-p` reteve o conteúdo de `--append-system-prompt` no `--resume` sem reenvio. Essa prova não foi repetida nesta worktree. **Modo interativo, cache e cobrança continuam NOT_PROVEN**. Quando `refreshRole` é verdadeiro, `initialBytes` e `sourceBytes` incluem o role reaplicado; o teste de jornada compara os bytes medidos com o texto efetivamente selecionado pelo comando. As contagens de usage permanecem desconhecidas (`null`), sem economia artificial atribuída ao provedor.

## Limites

Não foram medidos missão real, tokens totais faturados, número de turnos do líder em produção, retrabalho, subagentes nativos, tools nativas ou plugins externos. A fixture tem dois agentes e dois envios do usuário; isso não equivale a dois turnos de modelo. Não houve alteração de roteamento, catálogo MCP, hooks ou política de custos. A cópia de `docs/orchestration-audit.md` preserva a auditoria de origem integralmente.

## Validação B1 e revisão B1-r1

- Antes das alterações: `npm test`, exit 0, 405 testes do sidecar + 50 do desktop = 455 aprovados.
- RED: teste de comando falhou pela flag no resume; teste de navegador falhou pelo padrão `new-task`; teste da medição falhou pela ausência de `preparedRoleBytes`.
- Depois: testes direcionados (`command.test.ts` + `tokenBaseline.test.ts`), exit 0, 12/12; navegador, exit 0, 2/2; `npm run typecheck`, exit 0.
- Suíte completa ao final de B1: `npm test`, exit 1, 407 testes do sidecar (406 aprovados, 1 falha) + 50 do desktop aprovados = 457 testes, 456 aprovados. A expectativa antiga em `toolkitJourneys.test.ts:128` exigia o role no resume normal. O brief B1-r1 ampliou o escopo para atualizar esse teste e preservar a migração quando não há receipt válido.
- B1-r1, RED: comando com `refreshRole: true` não reaplicava o role e jornada Claude sem receipt não enviava a política, exit 1.
- B1-r1, testes direcionados (`command.test.ts`, `toolkitJourneys.test.ts`, `tokenBaseline.test.ts`): exit 0, 23/23. Cobrem resume normal, receipt ausente, política diferente, bytes reenviados e demais adapters.
- B1-r1, validação final: `npm run typecheck`, exit 0; `npm test`, exit 0, sidecar 408/408 + desktop 50/50 = 458/458 testes aprovados. A pendência de B1 foi resolvida.
- Build e atualização do app instalado pertencem ao Maestro, conforme o brief; não foram executados aqui.
