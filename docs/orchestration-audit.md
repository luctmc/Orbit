# Auditoria de orquestração do Orbit (fase 1, somente leitura)

Data: 2026-10-28. Base: `main` @ 8a55213. Nenhum código foi alterado.

Fontes: handoffs S1 (Orbit), S2 (Alethe + Orca), S3 (Maestri) em `.maestri/handoffs/`.
Restrições: clean-room. Alethe é AGPL-3.0+, então só padrões, sem portar código. Orca é MIT, mas a regra do projeto continua sendo reimplementar.

## Limites desta auditoria

- Nenhuma missão real foi executada. Todos os custos de token abaixo são **inferidos da leitura de código**, não medidos. A primeira ação da fase 2 é medir (R4).
- O `rea` **não foi rodado**: o checkout não tem build e instalar exigia rede. O S3 usou `strings`, `plutil` e a CLI `maestri` ao vivo, somente leitura. O formato do fio além de `{args, workingDirectory}`, a detecção de idle e o formato de `connections` e `floors` estão marcados INFERRED.
- Não foi confirmado se o cache de prompt do Claude sobrevive ao `--resume` com respawn.

## 1. Diagnóstico: por que o Orbit gasta muito e entrega mal

Ranqueado por impacto provável. Caminhos em `packages/sidecar/src`.

| # | Sev. | Defeito | Evidência |
|---|---|---|---|
| D1 | Alta | "Nova tarefa" é o padrão do composer do líder. Cada mensagem abre uma CLI nova no seat do líder (ex.: Opus high), sem contexto e fora do roteamento do maestro. | `MessageComposer.tsx:24`, `core.ts:1489-1497` |
| D2 | Alta | Resume do Claude reenvia o role inteiro e reinicia o processo (cache frio). A medição conta 0 bytes de role no resume, então esconde o custo. | `command.ts:79,103`, `core.ts:3150`, `:3130` |
| D3 | Alta | Revisão obrigatória por atividade mais revisão de integração, sem escalar pela dificuldade. Cada revisor é uma CLI completa com schema MCP próprio. | `prompts.ts:15` |
| D4 | Alta | Orçamento só avisa. Sem teto de helpers por missão (líder abre até 8 por chamada) e permissões em bypass. | `core.ts:485-499`, `agentPermissions.ts:10`, `prompts.ts:70` |
| D5 | Média | Cada entrega acorda o líder por texto no PTY (turno de contexto completo). N helpers geram N+ turnos do líder. | `core.ts:1943`, timer `:214` |
| D6 | Média | Roteamento por regex e palavras-chave. Tier errado pode mandar tarefa de código para Haiku, ou "security fix" para Opus. | `maestro.ts:12,45,73` |
| D7 | Média | Harness adaptativo nunca ativa (exige 30 amostras live) e só acrescenta ~600 B constantes por agente. | `harness.ts:84-87` |
| D8 | Média | Troca de líder envia briefing de até 18 KB com transcript anterior. | `core.ts:877-932` |
| D9 | Média | `resumeCrews` no start do app acorda todos os agentes que estavam rodando, cada um com primeiro turno frio. | `core.ts:2237` |
| D10 | Média | Classificação duplicada (`openHelper` e `spawn`) com resultados que podem divergir, mais chamada Haiku extra por atividade ambígua. | `core.ts:2124,2875,2133` |
| D11 | Baixa | Guarda do nudge do Stop hook só em memória. Resultado "auto" não verificado bloqueia `mission_ready` e manda o líder refazer (origem dos "retornos repetidos"). | `core.ts:2511` |
| D12 | Baixa | 44 a 47 tools MCP (schemas) reenviadas a cada turno de cada agente. Suspeito de ser o maior custo fixo, **não medido**. | `mcp.ts:80-480` |
| D13 | Baixa | Idioma misto: roles em inglês, mensagens do usuário em português. | `store.ts:23`, `core.ts:1428` |

Tamanhos medidos de prompt: líder 5.925 B, crew 2.185 B, toolkit core 2.015 B (mais ~600 B de execution strategy e memória do projeto).

## 2. Padrões de referência

### Alethe (AGPL: só padrões)
- Entrega pelo menos uma vez: `check` com `ack`, flag `repeat` e espera limitada a 45 s.
- Dedup por (planner, spec exata) que só substitui job que terminou mal.
- Bloco de cota injetado em toda resposta de tool por um único wrapper. Só notifica, não reroteia.
- Roles resolvidos no servidor. Rejeita role mais overrides. Read-only nunca cai em role de escrita.
- Regras e orçamento de tempo só no primeiro turno. Prompt do planner gerado do estado vivo.
- Workers headless (`claude -p` stream-json, `codex app-server`), teto de resposta de 16.000 caracteres.

### Orca (MIT)
- IDs Run/Task/Dispatch em toda mensagem. Mensagens de tentativas antigas são rejeitadas (`stale_dispatch`).
- Só prova positiva de saída autoriza parar ou refazer. Circuit breaker de 3 falhas. Profundidade máxima 1 com texto "faça você mesmo".
- Spec de tarefa com 5 campos: Target, Change, Constraints, Ownership, Observable acceptance.
- Guia em stub com referências sob demanda. Herdar modelo e effort, a menos que o usuário nomeie um, e verificar o `effective`.
- Reuso de terminal após settle. Isolamento de contas por `CLAUDE_CONFIG_DIR` e `CODEX_HOME`.
- Fragilidade: TUI em PTY com timing de paste por agente. Não é base para workers headless.

### Maestri (comportamento observável)
A economia de tokens é estrutural, não um roteador esperto:
1. CLI fina, sem schemas de tool no contexto (help sob demanda no servidor).
2. Brief como arquivo, só o ponteiro no prompt.
3. Handoff como arquivo, resposta de no máximo 10 linhas com `STATUS:` e `SUMMARY:`.
4. Effort médio por padrão. `high` só com motivo.
5. Reusar antes de recrutar, máximo 3 recrutas, profundidade 2.
6. Escada de resgate limitada, "worker quieto não é falho", nota de missão de uma linha por delegação.

Observação importante: nem Alethe nem Orca nem Maestri impõem teto de tokens. O controle é estrutural.

## 3. Comparativo

| Aspecto | Orbit hoje | Alethe | Orca | Maestri |
|---|---|---|---|---|
| Interface do agente | ~47 tools MCP | ~13 tools MCP | CLI + skill stub | CLI fina |
| Brief | texto no `agent_spawn` | rules + task | preamble + spec de 5 campos | arquivo + ponteiro |
| Retorno | MCP inline + wake no PTY | `check`/`ack`/`repeat` | mailbox com ack | arquivo + 10 linhas |
| Anti-reatribuição | dedup por activityId | supersede só se falhou | IDs de Dispatch + breaker 3 | "nunca reenviar" + escada |
| Revisão | sempre, por atividade | do planner | por tarefa | só quando o gate pede |
| Teto de tokens | só aviso | nenhum | nenhum | nenhum (estrutural) |
| Fan-out | até 8 por chamada | 4 simultâneos | 4 por padrão | 3 sem avisar o usuário |
| Reuso de sessão | desencorajado no prompt | worker parked (4) | reuso de terminal | `ask` no mesmo agente |
| Transporte | PTY interativo | headless | PTY interativo | PTY (via `ask`) |

## 4. Spec de correção em fases

Cada item tem critério de aceite testável. Ordem pensada para cortar custo primeiro.

### Fase 2.0, medir antes de mexer (pré-requisito)
- **M0.** Relatório em `docs/analysis` com tokens por componente de um helper (role, schemas MCP, hooks) e uma missão real de referência (tokens totais, nº de agentes, nº de turnos do líder, taxa de retrabalho).
  Aceite: números reais registrados, e a hipótese D12 confirmada ou refutada.

### Fase 2.1, vazamentos de custo (P0)
- **F1 (D1).** "Nova tarefa" deixa de ser padrão no composer do líder. A mensagem vai ao líder.
  Aceite: enviar duas mensagens seguidas ao líder não cria nenhum pane novo.
- **F2 (D2).** No resume do Claude, não reenviar `--append-system-prompt`. Corrigir a medição para contar o role real.
  Aceite: teste de `buildCommand` sem flag no resume. Medição não zera bytes no resume do Claude.
- **F3 (D3).** Revisão proporcional: dificuldade "simples" sem revisor separado, revisão de integração só com 2 ou mais atividades. Revisão independente permanece para segurança, migração e dados pessoais.
  Aceite: atividade simples completa sem spawn de revisor. Atividade de segurança continua exigindo.
- **F4 (D4).** Teto duro configurável por missão: nº de helpers vivos (padrão 3, com aviso acima) e orçamento de tokens com ação de pausar o líder e perguntar ao usuário.
  Aceite: o 4º spawn é recusado com o motivo. Ao estourar o orçamento a missão pausa e notifica.
- **F5 (D5, D9).** Agrupar entregas em um único wake do líder e não acordar agentes ociosos no start.
  Aceite: 3 helpers terminando em 5 s geram 1 wake. Reabrir o app não envia prompt a agente sem pendência.

### Fase 2.2, coordenação sem loops (P0/P1)
- **F6.** IDs de Dispatch em toda mensagem de worker. Resultado de tentativa antiga é rejeitado (modelo Orca).
  Aceite: handoff com dispatch antigo retorna `stale_dispatch` e não aparece como entrega.
- **F7.** Entrega com `ack` e flag `repeat`, espera limitada (modelo Alethe). Resultado "auto" não verificado não bloqueia `mission_ready` sozinho.
  Aceite: entrega não confirmada volta com `repeat:true`. Entrega "auto" não reabre trabalho.
- **F8.** Escada de resgate limitada com circuit breaker de 3 falhas. A tentativa 2 exige causa concreta, a 3 exige evidência nova com escopo menor, a 4 é recusada e avisa o usuário. Reenviar o mesmo brief ao mesmo modelo é recusado.
  Aceite: atividade que falha 4 vezes é recusada na 4ª com "pare e pergunte ao usuário".
- **F9.** Silêncio não é falha: um único evento "quiet for T", sem reatribuição automática. Só prova positiva de saída libera retry.
  Aceite: helper mudo por 10 min gera 0 reatribuições e 1 evento.

### Fase 2.3, modo Maestri (P1)
- **F10.** Brief por ponteiro: `agent_spawn` aceita `briefPath` e envia só uma frase fixa. Brief em `<ground>/.maestri/briefs/<ID>.md`.
  Aceite: prompt do helper com menos de 400 caracteres. `task` acima de 1.200 caracteres sem `briefPath` é recusado.
- **F11.** Handoff em arquivo, resposta do wake com no máximo 10 linhas (`STATUS` + `SUMMARY` + caminho).
  Aceite: handoff de 4 KB gera wake de no máximo 10 linhas. Handoff sem `STATUS` é rejeitado.
- **F12.** Gate de brief (nota de 0 a 10, mínimo 7, objetivo e resultado com no mínimo 2) feito de forma determinística pelas seções obrigatórias.
  Aceite: brief sem escopo não cria pane.
- **F13.** Roles em arquivo (`.maestri/roles/<id>/role.json` + `CLAUDE.md`/`AGENTS.md` idênticos), importados do repo, com validador.
  Aceite: role colocado no repo aparece no seletor. Id diferente do diretório é ignorado com motivo.
- **F14.** Redução de contexto fixo por agente: mover tools raras (board, browser, branches) para grupos sob demanda ou para uma CLI fina `orbit`, guiado pela medição M0.
  Aceite: tokens fixos por helper caem em pelo menos 30% (meta INFERRED, validar com M0) sem quebrar testes.

### Fase 2.4, qualidade e visibilidade (P2)
- **F15.** Roteamento por tabela com tier explícito e motivo registrado. Regex vira só sugestão, sem subir para Opus sozinha.
- **F16.** Nota de missão de uma linha por delegação (ID, tipo, modelo/esforço, nota do brief, status, evidência).
- **F17.** Status por worktree (`working|blocked|review|done`) com notificação só nas transições, e `land` seguro que recusa sem alterar nada.
- **F18.** Veredito `NOT_PROVEN` além de PASS/FAIL em `verification_submit`.

Fora de escopo desta rodada: canvas infinito, bands, partituras, chat do Maestri, simuladores, SSH/Docker, e qualquer cópia de código ou asset.

## 5. Riscos e decisões pendentes

- **Segurança:** bypass de permissões está sempre ligado e a leitura-somente é só por prompt. Decidir se muda (afeta F4).
- **Transporte:** a base atual usa TUI em PTY interativo. Workers headless (modelo Alethe) cortariam custo e fragilidade, mas é mudança grande e deve ser decisão separada, após M0.
- **Licença:** Alethe é AGPL. Não portar código nem texto de prompts.
- **EULA do Maestri:** o uso do `rea` ou de `strings` no app é decisão do usuário. Nada do app entra no Orbit.
- **Medição incompleta:** subagentes nativos não entram na contagem de tokens (`claudeUsage.ts`), então qualquer meta de economia precisa de um método de medição que os inclua.
