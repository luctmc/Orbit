# Sugestões contextuais no maestro — Implementation Plan
**Goal:** mostrar sugestões no campo do Orbit e no terminal do maestro; somente Tab ou botão insere texto e somente o envio explícito o executa.
**Architecture:** sugestões locais derivadas da missão, atividades, revisão e quadro; nenhuma chamada de modelo por tecla. Um motor puro fornece candidatos e completa apenas prefixos compatíveis. O terminal mantém um rascunho efêmero e só oferece texto quando reconhece o prompt vazio de origem e confirma o eco exato da digitação; controles, menus, seleção e estado não compatível preservam o comportamento nativo.
**Stack:** React 19, TypeScript, xterm instalado, node:test, tokens CSS existentes.

## Global constraints
- Pedido confirmado pelo usuário: nos dois lugares, apenas sugestão visual, Tab necessário para inserir.
- Tab não envia Enter nem chama `pane.submit`; Esc dispensa; Shift+Tab e atalhos modificados não aceitam.
- Nenhum novo provider, instalação, chamada real a modelos ou envio de código nesta implementação.
- Não substituir aplicativo instalado, alterar missões pessoais, commit ou push.
- Terminal shell e ajudantes conservam entrada nativa; a nova predição é do maestro Claude/Codex.
- Estado desconhecido/antigo não justifica afirmar conclusão; orçamento esgotado e prompts de permissão não recebem sugestão de prosseguir.

## Design do componente
Pessoa: desenvolvedor alternando conversa e terminal; verbo: escolher e inserir a próxima orientação; sensação: controle e continuidade. Conceitos: missão, maestro, atividade, revisão, entrega, contexto. A assinatura é o próximo passo ligado à atividade real, com a razão visível.
Paleta: grafite `--bg`, carbono `--surface`, metal `--line-2`, texto `--text-3`, lima `--accent`, âmbar `--wait`, todos existentes. A conversa continua em primeiro plano; sugestão tem menor peso e um rótulo explícito. Profundidade por borda/superfície; Geist existente e Geist Mono no terminal; escala de 4 px, sem animação ao digitar. Evitar popover flutuante que cubra texto, aceitação automática e escrita no buffer de saída do PTY; usar ghost visual, Tab e Esc.

## File map
- `apps/desktop/src/orbit/inputSuggestions.ts`: candidatos por estado, limites e correspondência de prefixo preservando a digitação original.
- `apps/desktop/src/orbit/inputSuggestions.test.ts`: estado fresco/antigo, isolamento por missão, conclusão, bloqueios, prefixos, teclas e tamanho.
- `apps/desktop/src/orbit/terminalPrediction.ts`: acompanhamento conservador do rascunho e confirmação do eco no prompt nativo.
- `apps/desktop/src/orbit/terminalPrediction.test.ts`: prompt reconhecido, eco, controles, edição, Esc e limites sem PTYs/modelos.
- `apps/desktop/src/components/MessageComposer.tsx`: overlay no textarea, Tab/Esc, botão de inserir e preferência de sugestões.
- `apps/desktop/src/components/Terminal.tsx`: overlay independente do PTY, entrada via paste sem Enter, preservação de atalhos/menus e reset por execução.
- `apps/desktop/src/components/PaneView.tsx`: repassar candidatos e habilitação ao terminal do maestro.
- `apps/desktop/src/components/MissionView.tsx`: contexto já consultado, candidatos comuns às duas vistas e preferência local.
- `apps/desktop/src/styles.css`: ghost, explicação e controles usando tokens existentes, 375–1440 px.
- `README.md`: uso do Tab/Esc/Enter e limites das sugestões locais.
- `docs/plans/2026-10-15-orbit-input-suggestions-report.md` e diretório de evidências: implementação, QA, limites e comandos.

## Task 1: motor contextual
Produz `InputSuggestion {id,text,reason}` e `inlineSuggestion(draft,candidates)`; usa `Mission`, `Pane`, `MissionProgress`, `Card` existentes, sem novo protocolo. Candidatos: investigar bloqueio; revisar entrega; conferir integração desatualizada; acompanhar atividade em andamento; planejar objetivo; organizar próxima tarefa. Retornar no máximo três sugestões, nunca comandos destrutivos automáticos ou uma conclusão inventada.
- [x] Testar os casos antes da integração visual; normalizar somente a comparação, preservando o prefixo digitado e acentos.
- [x] Rodar `apps/desktop/build/node/node --test apps/desktop/src/orbit/inputSuggestions.test.ts`.

## Task 2: entrada e terminal
O compositor recebe candidatos prontos. O terminal consome somente sugestões compatíveis e o rascunho observado desde um prompt reconhecido `❯`/`›`/`>`; uma navegação ou entrada desconhecida suspende predição até reinício da linha. Confirmar linha, coluna e eco antes de aceitar. Não tentar reconstruir entradas de sessões antigas ou operar um menu do CLI.
- [x] Testar tracker e ausência de aceitação com eco divergente, cursor movido, composição ou modificadores.
- [x] Integrar sugestões e preferência; nada escrito no campo ou PTY antes da aceitação.
- [x] Conferir tipos e comportamento com textarea/terminal reais em fixture de agentes simulados.

## Task 3: verificação e relatório
- [x] QA no browser com React, xterm e PTY locais; capturar DOM antes das imagens. Verificar Tab insere sem enviar, Enter separado, Esc, Shift+Tab, alternância das vistas, preferência, conexão/estado e responsividade.
- [x] Rodar testes desktop, suíte relevante, typecheck e build debug. Build antes dos testes que usam o Node empacotado.
- [x] Registrar explicitamente o limite da referência: o Overclock foi observado na home, sem sessão aberta; não foi ativada uma missão pessoal para reproduzir seu predictor. O comportamento é implementado a partir do pedido do usuário, sem copiar algoritmo recuperado.

Execução inline autorizada pelo pedido de implementação. Nenhum commit no checkout atual.

Implementação e QA local concluídos. O teste do gesto nas CLIs reais permanece explicitamente pendente no [relatório](2026-10-15-orbit-input-suggestions-report.md). Nenhum modelo foi iniciado nesta fatia.
