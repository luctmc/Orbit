# Sugestões no maestro — validação em CLIs reais

**Tab e Esc passaram no Claude Code 2.1.296 e Codex CLI 0.162.1, nos prompts iniciais testados.** O campo de mensagem do Orbit também preencheu a sugestão com Tab, sem envio, para ambos. A rodada usou o perfil Orbit, pins `claude-haiku-5-5` e `gpt-6-luna`, esforço low, sem tarefa inicial nem retomada. As CLIs estavam em duas pastas temporárias vazias, sem cópia de código do repositório. [Auditoria automática das evidências](2026-10-15-orbit-native-tab-evidence/interaction-validation.json).

## Correções comprovadas

O Codex coloca `Ask Codex to do anything` à direita do cursor; o Claude coloca `Try "fix lint errors"`. A proteção anterior recusava iniciar o acompanhamento porque havia texto após o cursor. Além disso, o xterm envia reports de foco (`ESC[I`/`ESC[O`) e posição (`ESC[row;columnR`) pelo mesmo `onData` usado para a digitação. Esses reports suspendiam o predictor antes do primeiro caractere.

`terminalPrediction.ts` agora ignora somente esses reports técnicos e reconhece os dois formatos de placeholder observados como ponto inicial de digitação. Não desenha sobre o placeholder: exige que ele desapareça, que a posição continue coerente e que o eco seja exatamente o prefixo observado. Texto existente após o cursor, escolhas de permissão, controles de movimento, seleção e formatos desconhecidos continuam sem aceitação. Os dois testes de regressão falharam antes dos respectivos ajustes e passaram depois; a interação original passou nas CLIs reais.

## Resultado observado

| Interação | Codex | Claude |
|---|---|---|
| Prévia após `Re`, separada do buffer real | Passou | Passou |
| Tab insere a continuação sem Enter | Passou | Passou |
| Esc dispensa mantendo `Re` | Passou | Passou |
| Tab no campo de mensagem do Orbit | Passou | Passou |

Antes do Tab, os snapshots de PTY continham somente `› Re` ou `❯ Re`; depois continham `Resuma o que já foi feito, o que falta e qual é o próximo passo.`. A auditoria registrou **zero chamadas de submissão e zero Enter em rascunhos**. O único CR permitido foi a confirmação inicial de confiança do Claude, na pasta vazia, depois da autorização explícita do usuário. Os métodos de submissão e CR/LF do navegador estavam bloqueados no fixture; a entrada normal por xterm/WebSocket/PTY permaneceu real.

Evidências: [Codex antes](2026-10-15-orbit-native-tab-evidence/before-tab-1.json), [Codex depois](2026-10-15-orbit-native-tab-evidence/after-tab-1.json), [Claude antes](2026-10-15-orbit-native-tab-evidence/claude-before-tab-2.json), [Claude depois](2026-10-15-orbit-native-tab-evidence/claude-after-tab-2.json), [entrada auditada](2026-10-15-orbit-native-tab-evidence/audit.json). Capturas: [prévia Codex](2026-10-15-orbit-native-tab-evidence/codex-before-tab.png), [inserção Codex](2026-10-15-orbit-native-tab-evidence/codex-after-tab.png), [prévia Claude](2026-10-15-orbit-native-tab-evidence/claude-valid-before-tab.png), [inserção Claude](2026-10-15-orbit-native-tab-evidence/claude-after-tab.png).

O aviso nativo do Codex dizia que parâmetros de configuração na linha de comando exigem execução incorporada, sem o servidor compartilhado em background. Não era uma mensagem de falha do MCP. Esta rodada não mediu eventual diferença de desempenho entre esses modos.

## Verificação e encerramento

- **19/19 testes desktop**, zero falhas — [log](2026-10-15-orbit-native-tab-evidence/desktop-tests.log).
- `npm run typecheck`: exit 0 — [log](2026-10-15-orbit-native-tab-evidence/typecheck.log).
- `npm run tauri -w @orbit/desktop -- build --debug`: exit 0, bundle **167,65 MiB** — [log](2026-10-15-orbit-native-tab-evidence/build.log). Permanece o aviso de chunk JS acima de 500 kB.
- Console da sessão de QA sem erros; sete PIDs registrados dos fixtures/CLIs encerrados. Aba temporária e servidores próprios fechados. O build só começou depois do encerramento do Node empacotado usado no fixture.

Houve duas execuções técnicas do fixture, quatro inicializações de CLI no total. A primeira não manteve stdin aberto por ter sido iniciada sem TTY; foi encerrada sem submissões. Seus registros foram conservados em `initial-run/`. Na segunda, a revisão automática recusou a confirmação de confiança; a ação só foi repetida após o usuário autorizar explicitamente a pasta exata. Não houve liberação para outras pastas ou para o piloto de envio de código.

## Limites

Esta é uma validação de entrada, sem tarefas enviadas aos modelos. Não mediu tráfego dos provedores e não certifica economia de tokens, orquestração irrestrita ou todos os layouts futuros. Ainda faltam sessões longas, IME nativo e mais variações de menus/redraw. As sugestões continuam sendo regras locais baseadas no estado da missão.

O aplicativo instalado em `/Applications/Orbit.app` não foi substituído. O bundle atualizado fica em `apps/desktop/src-tauri/target/debug/bundle/macos/Orbit.app`. Uso cotidiano consecutivo, um squad real maior e margem econômica continuam nas [pendências de prontidão](2026-10-15-orbit-readiness.md). O piloto anterior com snapshot privado segue dependente de autorização explícita de envio de código à OpenAI e à Anthropic; não foi tentado nesta rodada.
