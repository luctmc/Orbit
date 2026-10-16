# Perfil de ferramentas por execução

**Goal:** evitar que uma tarefa de código carregue integrações externas desnecessárias, preservando os tools nativos, instruções, hooks, permissões e gates do Orbit.
**Architecture:** configuração explícita `agentToolProfile: inherit | orbit`, aplicada na próxima abertura/retomada e registrada no pane. Claude usa o allowlist nativo `--strict-mcp-config`; Codex desliga Apps e desabilita cada MCP externo listado pelo próprio CLI. O preflight Codex roda dentro do processo de startup do pane e termina em `execve`, preservando o PID da política de execução.
**Stack:** TypeScript/Node 24, CLI/MCP/PTYS existentes e React.

## Global constraints

- Não editar configurações globais, credenciais, plugins instalados ou missões pessoais.
- Não usar `--bare`, safe mode, desativação de hooks/plugins ou mudança de sandbox/approval policy para economizar contexto.
- `inherit` conserva o lançamento existente. Usuário escolheu **Orbit por padrão e opção de herdar tudo** nesta rodada; perfis ausentes migram para Orbit, e a preferência explícita é preservada.
- Novo perfil não apaga contexto de conversas retomadas. Novas conversas são necessárias para medir a redução inicial.
- Falha/ambiguidade no preflight do perfil enxuto impede a abertura; não herdar silenciosamente tudo.
- Não confundir bytes de catálogo com tokens do provider. Medição paga, se necessária: só duas tarefas do corpus, mesmos pins econômicos e limites anteriores; não ampliar automaticamente após falha.

## Evidência que motivou a mudança

Transcript retido `forward-2`, worker Claude: catálogo inicial de 50 skills (23.396 bytes), schemas nativos registrados no prompt (117.810 bytes) e deltas com centenas de ferramentas externas, incluindo Higgsfield/Vercel/Figma, que não foram chamadas nessa correção. Instruções de quatro servidores externos acrescentaram 12.224 bytes serializados. Contagens são metadados do transcript, sem inferir economia de tokens.

`codex mcp list --json -c 'mcp_servers={}'` foi reproduzido com config sintética: não remove servidores herdados. Uma entrada isolada `.enabled=false` também é insuficiente para MCPs de plugins; a reprodução exigiu o transporte inerte completo descrito abaixo. O preflight lista plugins/MCP sem desativar plugins e conserva seu conteúdo/hook. Não usar uma sobrescrita vazia que só parece um allowlist.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/protocol/src/index.ts` | Tipo do perfil, preferência opcional compatível e perfil efetivo do pane |
| `packages/sidecar/src/store.ts` | Normalização/persistência da escolha sem alterar outros ajustes |
| `packages/sidecar/src/command.ts` | Flags Claude e startup Codex com helper privado do bundle |
| `packages/sidecar/hooks/codex-profile.mjs` | Listar/validar nomes, desativar externos/Apps, conferir e substituir processo pelo CLI |
| `packages/sidecar/src/core.ts` | Resolver perfil suportado e informar limite ao agente |
| `packages/sidecar/src/panes.ts` | Registrar perfil efetivo junto ao epoch |
| `packages/sidecar/src/mcp.ts` | Expor perfil efetivo em whoami/agent_list |
| `apps/desktop/src/components/RoutingDialog.tsx` | Controle reversível com indicação de quando a escolha entra em vigor |
| `packages/sidecar/test/toolProfile.test.ts` | Testes vermelho/verde do lançamento, limites, compatibilidade e helper sem modelos |
| `scripts/verify-autonomous-harness.mjs` | Fixar perfil do piloto no manifest e nas settings temporárias |
| `scripts/analyze-native-context.mjs` | Estatísticas locais redigidas de catálogo/instruções/chamadas dos transcripts retidos |
| `scripts/lib/autonomy-observations.mjs` | Conservar snapshots observados de sessões para a auditoria após fechamento de helpers |
| `docs/plans/2026-10-14-orbit-harness/implementation-focused-tools.md` | Resultado, consumo observado e limites |

## Execução inline autorizada

1. Registrar diagnóstico local sem conteúdo pessoal, apenas tamanhos/contagens/fontes. Não abrir modelos para isso.
2. Escrever teste de comando com `toolProfile: orbit`: Claude deve ter `--strict-mcp-config` e manter hooks/settings; Codex deve usar startup helper e preservar sandbox/MCP Orbit. Executar e registrar falha antes do reparo.
3. Implementar `AgentToolProfile = 'inherit' | 'orbit'`; `OrbitSettings.agentToolProfile?` opcional e `Pane.toolProfile?`. `Store.saveSettings` aceita só os dois valores e preserva a preferência se clientes antigos omitirem o campo. Perfil ausente em panes antigos significa herança.
4. Implementar helper Codex. Consumir `codex mcp list --json --disable apps` com timeout/maxBuffer; validar array, nomes únicos limitados e boolean `enabled`. Servidores vindos de plugins exigem uma entrada de transporte completa no override; usar `mcp_servers.NAME={enabled=false,command="NODE_ABSOLUTO"}` como stub inerte, sem copiar URL/headers/env. Aceitar só nomes simples `[A-Za-z0-9_-]` suportados pelo caminho de override do CLI; nomes incompatíveis recusam o perfil em vez de herdar silenciosamente. Conferir metadados com as mesmas sobrescritas e exigir Orbit habilitado. Usar `process.execve` com o executável resolvido por PATH e o env original.
5. Testar com executável sintético: imprime PID/argv somente na fase real e sai com 23. O PID final deve ser o do processo do helper; metadados não podem iniciar um agente. JSON inválido/timeout/falha não podem cair em herança. Testar nome com ponto/aspas sem criar arquivos nem executar shell.
6. Testar integração core/settings/epoch/perfil e caminho inherit inalterado. Outros adapters conservam herança; UI identifica Claude/Codex como adapters suportados. Revalidar a preferência de padrão após resposta do usuário.
7. Executar build e só depois suíte no Node empacotado: `fetch-node.mjs` recria esse executável, portanto as duas etapas não são independentes. Verificar types, controle no browser, helper no bundle e hashes de fontes/artefatos.
8. Só após checks locais, considerar piloto econômico de duas tarefas, novo diretório e sem sobrescrever observações anteriores. Manter oracles imutáveis e líder real; conclusão requer revisões, ACKs e integração atual. Relatar falhas e consumo, sem declarar A/B universal ou redução em porcentagem com amostra incompatível.

Sem commit/push nesta rodada: checkout contém alterações anteriores e a árvore Git não é gravável nesta sessão.
