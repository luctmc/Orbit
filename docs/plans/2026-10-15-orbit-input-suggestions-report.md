# Sugestões com Tab no maestro — 15/10/2026

**Implementado no campo de mensagem do Orbit e no terminal do maestro Claude/Codex, no build local.** A mensagem fica como prévia visual; **Tab insere, Enter envia, Esc dispensa**. Nenhum texto da sugestão entra automaticamente no rascunho ou no PTY. O aplicativo instalado não foi substituído.

[Plano](2026-10-15-orbit-input-suggestions.md) · [Validação e hashes](2026-10-15-orbit-input-suggestions-evidence/validation.json) · [QA de interação](2026-10-15-orbit-input-suggestions-evidence/qa-results.json) · [QA do prompt vazio](2026-10-15-orbit-input-suggestions-evidence/empty-prompt-qa.json).

**Atualização da rodada seguinte:** Tab e Esc passaram nos prompts reais do **Claude Code 2.1.296 e Codex CLI 0.162.1**, em pastas vazias próprias e sem tarefas submetidas. O campo de mensagem passou com os dois agentes. Foram corrigidos os placeholders iniciais e os reports técnicos de foco/cursor; **19 testes desktop**, typecheck e novo build debug passaram. [Relatório nativo](2026-10-15-orbit-native-tab-report.md) · [Auditoria](2026-10-15-orbit-native-tab-evidence/interaction-validation.json).

## Comportamento

As sugestões usam os dados já disponíveis da missão: objetivo, cartões, atividades bloqueadas/em andamento, entregas aguardando revisão e estado da integração. São até três candidatos, com uma razão visível. Exemplo diante da entrega pendente: **“Revise a entrega ‘Corrigir cálculo de frete’ e confira cada critério de aceite.”**

A geração é **local, sem chamadas adicionais a modelos**. Esta versão oferece próximos passos e completa prefixos compatíveis; não é um modelo generativo que continua qualquer frase nem uma interpretação de todo o histórico de conversa. A comparação tolera diferenças de caixa e acentos, preservando exatamente o prefixo que a pessoa digitou.

No campo do Orbit, a prévia aparece sobre o textarea, sem alterar seu valor. Tab ou o botão **Inserir** preenche o rascunho; o envio continua separado. Esc dispensa a sugestão atual e permite sair normalmente com Tab. Shift+Tab, composição de texto e seleção não aceitam a prévia. A sugestão também aparece com o campo vazio focado, para propor o próximo passo.

No terminal, a prévia é uma camada visual independente do buffer do xterm/PTY. Reconhece prompts simples `❯`, `›` ou `>`; com texto digitado, exige correspondência exata entre o rascunho observado, a linha, a posição do cursor e o eco. Um prompt vazio reconhecido também pode mostrar o próximo passo antes de digitar. Tab usa o paste do xterm, respeitando bracketed paste quando disponível, **sem acrescentar Enter**. Não há `pane.submit` nesse caminho.

O predictor não assume posse de rascunhos anteriores, menus ou prompts desconhecidos. Não desenha sobre placeholders nativos. Os placeholders iniciais observados do Codex (`Ask Codex to do anything`) e do Claude (`Try "…"`) permitem iniciar o acompanhamento; a prévia só aparece quando o placeholder desaparece e o eco corresponde exatamente ao prefixo digitado. Reports de foco/posição enviados pelo xterm não contam como edição. Seleção de texto, cursor movido, outros controles, paste com escapes e linhas não reconhecidas suspendem a predição. Os atalhos nativos permanecem disponíveis quando não existe uma sugestão válida. Gemini, Antigravity, terminais shell e ajudantes não receberam esse predictor.

O controle **Sugestões ligadas/desligadas** afeta os dois lugares e guarda a preferência localmente. O rascunho e o acompanhamento de digitação não são persistidos por essa funcionalidade. Inicialização, pedidos de resposta/permissão, missão arquivada, falta de conexão e orçamento esgotado não geram orientação para prosseguir. Estado ausente, antigo ou pertencente a outra missão produz apenas uma orientação de conferir o estado, sem inventar conclusão.

## Evidência de interação original, com CLIs simuladas

O QA usou **React, xterm, WebSocket e PTYs reais com processos Node simulando a entrada de CLIs**, em pastas e servidores próprios. Não foram iniciados Claude/Codex reais nem chamados modelos. Esse QA verifica a mecânica de entrada, não certifica todos os layouts/redraws das CLIs reais.

- **Campo Orbit:** com a prévia visível, o valor permaneceu vazio ou `Re`; Tab preencheu a frase, sem envio. O contador de linhas submetidas permaneceu **2 → 2**. Esc preservou o rascunho; o Tab seguinte navegou para anexos; Shift+Tab navegou para o controle anterior, sem aceitar. O botão Inserir preencheu sem enviar.
- **Terminal com prefixo:** a prévia apareceu depois do eco de `Re`. Tab inseriu somente a continuação; o snapshot do PTY continha a frase completa e o contador de submissões permaneceu **3 → 3**. Esc dispensou a prévia. Enter posterior produziu a submissão explícita.
- **Terminal vazio:** antes de Tab, o snapshot terminava em `❯ ` e não continha a sugestão; depois de Tab continha a frase, mantendo **2 → 2** submissões. [Registro próprio](2026-10-15-orbit-input-suggestions-evidence/empty-prompt-qa.json).
- **Estados e preferência:** desligar removeu as sugestões nos dois lugares e persistiu após reload; um pedido de decisão ocultou as prévias e pausou o predictor do terminal.
- **Responsivo:** 375, 768, 1024 e 1440 px sem overflow horizontal. Campo acessível ao focar/rolar nas larguras menores; fonte da prévia e da digitação iguais, botões de inserir/dispensar com pelo menos 44 px de altura. [Medições](2026-10-15-orbit-input-suggestions-evidence/responsive-final.json). Console sem erros na sessão principal de QA.

Capturas de interface sintética: [campo em 1440 px](2026-10-15-orbit-input-suggestions-evidence/final-1440.png), [campo em 375 px](2026-10-15-orbit-input-suggestions-evidence/final-375.png), [prévia com prefixo no terminal](2026-10-15-orbit-input-suggestions-evidence/terminal-final.png) e [prévia no prompt vazio](2026-10-15-orbit-input-suggestions-evidence/terminal-empty-prompt.png). As capturas iniciais foram preservadas; as `final-*` são a referência responsiva final.

## Ajustes encontrados durante a validação

O primeiro fixture tentou confirmar recebimento antes do recibo de dispatch; o motor recusou corretamente. O fixture passou a aguardar o dispatch real, sem enfraquecer o gate de produção.

A primeira condição visual do terminal exigia `idle`. No Codex, o mecanismo existente pode marcar `running` ao observar saída, inclusive eco de digitação. A prévia desaparecia nesse limite. A elegibilidade agora aceita `idle` ou `running`, mas continua dependendo do prompt reconhecido e eco exato; `starting`, `waiting` e `exited` seguem excluídos. A evidência inicial e os testes vermelhos foram conservados.

O teste de seleção demonstrou que uma predição não podia continuar ativa sobre texto selecionado. O tracker passou a recusar essa situação, e o componente observa mudanças de seleção. A checagem de 768 px também detectou fontes diferentes entre ghost e textarea; ambos agora usam a mesma regra de fonte móvel. O caso proativo de prompt vazio começou vermelho e passou após sua implementação.

## Verificação da implementação original

| Comando | Resultado |
|---|---|
| Suíte motor/supervisores no Node empacotado | **224/224**, exit 0 — [log](2026-10-15-orbit-input-suggestions-evidence/tests.log) |
| Testes desktop no Node empacotado | **17/17**, exit 0 — [log](2026-10-15-orbit-input-suggestions-evidence/desktop-tests.log) |
| `npm run typecheck` | Exit 0 — [log](2026-10-15-orbit-input-suggestions-evidence/typecheck.log) |
| `npm run tauri -w @orbit/desktop -- build --debug` | Exit 0; bundle **167,65 MiB** — [log](2026-10-15-orbit-input-suggestions-evidence/build.log) |
| `git diff --check` | Exit 0 — [log](2026-10-15-orbit-input-suggestions-evidence/diff-check.log) |

O Node empacotado é 24.21.0. O build terminou antes dos testes que usam esse executável. Binário e sidecar do bundle correspondem aos artefatos construídos por hash. Permanece o aviso conhecido de chunk JS acima de 500 kB. A alteração final de prompt vazio foi seguida de novo build, typecheck e suíte desktop; o motor não foi alterado nessa etapa. Logs anteriores foram preservados com sufixo `-initial`.

As abas temporárias foram fechadas, o viewport foi restaurado e os seis PIDs próprios dos fixtures foram conferidos como encerrados. Não houve instalação sobre `/Applications/Orbit.app`, publicação, commit ou push. As mudanças anteriores do checkout foram preservadas.

## Alcance da referência e próximos testes

O Overclock observado estava na versão visual **1.4.16 local**, na home, sem sessão aberta. Não foi iniciada uma missão pessoal para ativar seu predictor nem recuperado seu algoritmo. A solução do Orbit foi implementada a partir do comportamento solicitado pelo usuário.

**A rodada nativa posterior validou os prompts iniciais, Tab e Esc de ambas as CLIs.** Ainda falta ampliar para sessões longas, IME nativo, menus e variações de redraw/layout. Para prompts não reconhecidos, a política é deixar a entrada nativa operar. Isso não altera as pendências anteriores de uso cotidiano, paralelismo maior e margem de consumo registradas na [avaliação de prontidão](2026-10-15-orbit-readiness.md).
