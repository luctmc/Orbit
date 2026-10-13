# Overclock → Orbit: inventário de interface

> Fonte: screenshot da janela principal do Overclock 1.4.13 (`screencapture -l <windowId>`), 2026-10-13.
> A captura nativa do REA (`capture-native-ui-scenario`) recusou o alvo: *"Selected application does not
> expose a launch time"*. Árvore de acessibilidade pendente (falta permissão de Acessibilidade).
> Clean-room: só estrutura e comportamento. Nenhum asset (mascote, ícones, fontes) vai para o Orbit.

## Tela principal (workspace aberto, 2 panes)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ [ícone] Overclock 1.4.13          ✳3h  ◎1  4h C 4h  ⋀ deslogada  ● Atualizado           │ ← title bar custom
├──┬──────────┬───────────────────────────┬───────────────────────────────────────────────┤
│⌂ │ CIINTEC  │ ● CIINTEC.cockpit-frontend│      ⊞  ARQUIVOS  VOL 0 ▁▁▁  0 PPM  CHAT  +TERMINAL (L)│ ← abas de workspace + ações
├──┴──────────┼───────────────────────────┴──┬────────────────────────────────────────────┤
│ MISSÕES + ‹ │ ● ✳ [PILOTO] 78⧉ título…  ⋯ ×│ ● ✳ 89⧉ + nome                         ⋯ × │ ← header do pane
│ ⚡ Missão 3 2│                              │                                            │
│             │   (TUI real do Claude Code   │   (TUI real do Claude Code em xterm)       │
│             │    rodando em xterm)         │                                            │
│             │                              │                                            │
│ › ARQUIVADOS 2                             │                                            │
│  [mascote]  │ ❯ prompt…                    │ ❯ ▌                                        │
│ LV 3   754k │ Opus 5.5 · medium · <branch> │ Sonnet 5.5 · medium · <branch>             │ ← status line (hook)
│ faltam 46k→LV4                             │ ▸▸ bypass permissions on                   │
│ ‹ WORKSPACE │                              │                                            │
└─────────────┴──────────────────────────────┴────────────────────────────────────────────┘
```

### Regiões e o que cada uma revela

| Região | Elementos | Leitura para o Orbit |
|---|---|---|
| **Title bar** (custom, sem chrome nativo) | nome + versão; à direita: medidores de janela de uso por provider/conta (ex. "3h", "4h"), contagem de algo ativo ("1"), status de login por provider ("deslogada"), status do updater ("Atualizado") | Barra de status global: limites de uso por conta + saúde das contas + updater |
| **Abas de workspace** | botão Home; uma aba por workspace aberto (pasta); ponto verde = atividade; sublinhado = ativa | Multi-workspace em abas, estilo navegador |
| **Ações do workspace** | layout de grid (⊞), ARQUIVOS (explorador), VOL + medidor e PPM (voz: nível do mic e palavras/min), CHAT, + TERMINAL, avatar da conta | Painéis auxiliares por workspace; voz integrada na toolbar |
| **Sidebar "Missões"** | `+` nova missão, colapsar; lista de missões com ícone por tipo (⚡ = agêntica) e contagem de panes; seção ARQUIVADOS colapsável | Missão = agrupador de panes dentro do workspace |
| **Gamificação** (rodapé da sidebar) | mascote pixel-art com skin, nível (LV 3), tokens acumulados (754k), barra de progresso, "faltam 46k → LV 4" | XP = tokens consumidos. Opcional; baixa prioridade |
| **Header do pane** | ponto de status (verde = vivo), ícone do CLI (✳ Claude), badge de papel (**PILOTO**), id do pane (78) com copiar, título auto-gerado do 1º prompt ou "+ nome" para renomear, menu ⋯, fechar × | Metadados do pane vêm do sidecar; título editável; papel visível |
| **Corpo do pane** | o **TUI do próprio CLI** (Claude Code) renderizado em xterm — markdown, tabelas, "Ran N shell commands", prompt `❯` | O Overclock **não** desenha o chat: ele hospeda o terminal. Orbit = xterm.js + PTY |
| **Handoffs no pane** | mensagens injetadas como input do usuário: `← pane-101: <resumo> · fechado ao entregar` | Resultado de worker chega ao piloto como prompt escrito no PTY |
| **Status line** | `modelo · effort · branch git` + modo de permissão | Vem do `statusline-model.mjs` configurado por pane |
| **Layout** | panes lado a lado em colunas redimensionáveis | Tiling de panes por missão |

### Estados/variações a capturar (pendente)

- Home (⌂) / tela sem workspace / onboarding
- Nova missão (`+`): escolha de modo (Livre · Squad · Agêntico), squad, modelo
- ARQUIVOS, CHAT, + TERMINAL, grid de layout
- Menu ⋯ do pane, renomear, fechar
- Configurações / providers / contas / squads / catálogo de skills
- Estado de pane "esperando humano" e "ocioso" (cores do ponto de status)
