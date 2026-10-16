# Perfil de ferramentas e piloto econômico — 15/10/2026

**Implementado: opção 1 como padrão, com opção 2 disponível nos ajustes.** Claude e Codex abrem com as ferramentas nativas de código e a coordenação do Orbit. Desmarcar o controle em **Ajustes → Quem faz cada tarefa** faz a próxima abertura/retomada herdar as integrações configuradas. A escolha persiste; não muda uma execução já aberta. Retomar conserva o contexto antigo, portanto conversas novas são necessárias para comparar o contexto inicial.

O código e o build debug local foram atualizados. Não houve instalação sobre o aplicativo em uso, publicação, commit ou push.

## Implementação e limites

- Preferência `agentToolProfile: orbit | inherit`, com migração de valor ausente para `orbit`, conforme escolha explícita do usuário. Clientes antigos que salvam outros ajustes não apagam essa preferência. O pane e os tools de consulta expõem o perfil efetivo.
- Claude usa `--strict-mcp-config` com a configuração preparada pelo Orbit. Preserva ferramentas nativas, hooks, instruções, skills, autenticação e permissões.
- Codex desabilita Apps e os MCPs externos apenas nessa execução. O helper consulta `codex mcp list --json`, aplica sobrescritas de transporte inerte, confere novamente e faz `execve`, preservando o PID usado pelas políticas de execução. Não altera configurações globais ou desativa plugins.
- Um override vazio `mcp_servers={}` não remove servidores herdados. Uma entrada isolada `.enabled=false` pode criar transporte inválido para servidores fornecidos por plugins. Ambos os casos foram reproduzidos; o helper usa entradas completas desabilitadas sem copiar URLs, headers ou credenciais.
- Falha de metadata, nome incompatível ou runtime sem `execve` impede o perfil enxuto; não abre silenciosamente com todas as integrações. Nomes simples `[A-Za-z0-9_-]` são suportados. Implementação verificada no macOS/Node 24, Claude 2.1.296 e Codex 0.162.1; não certifica outras versões ou Windows. Configuração externa não deve mudar entre preflight e abertura; isso não é uma fronteira universal de segurança.
- O perfil completo conserva as configurações e desativações explícitas existentes. Gemini/Antigravity continuam no comportamento anterior; o controle identifica Claude/Codex como os adapters abrangidos.

[Plano e mapa de arquivos](08-focused-tools.md). O sandbox continua independente: Codex líder/revisor em `read-only`, worker gravável em `workspace-write`. Nenhum gate de revisão, autorização ou integração foi retirado.

## Evidência de contexto

O transcript Claude histórico do worker `execution-autonomy/forward-2` registrou 50 skills (23.396 bytes), schemas nativos e centenas de ferramentas externas, sem chamada a esses serviços nessa tarefa. No novo worker Claude, o catálogo de skills e os schemas nativos permaneceram; **nenhum servidor externo apareceu nos metadados de descoberta ou nas chamadas**. Os dois agentes Claude da missão inversa também não registraram externos. O CLI Codex confirmou, sem chamar modelos, `orbit: true` e quatro servidores externos desabilitados.

O worker anterior teve 9 respostas e entradas reportadas de 45.244 a 72.407 tokens por resposta. O novo teve 6 respostas, de 45.072 a 52.779. O uso total desse worker passou de 598.299 para 301.791 tokens observados. São observações de execuções diferentes, com quantidade de chamadas e comportamento distintos; **não isolam o efeito do perfil nem comprovam uma porcentagem de economia**. O contexto nativo e o catálogo de skills ainda são grandes.

O analisador local em `scripts/analyze-native-context.mjs` lê somente sessões explicitamente retidas no run/panes/tentativas e emite contagens, tamanhos, hashes e uso reportado, sem conteúdo de prompts, entradas de ferramentas ou credenciais. Snapshots/deltas de catálogo se sobrepõem: não somar seus bytes como contexto único. A primeira leitura do resultado final não encontrou o helper removido da lista de panes; foi preservada em `native-forward.json`. O analisador agora consulta também as tentativas retidas, produzindo a observação completa separada.

Evidências: [histórico](execution-focused-tools/native-before.json), [worker novo](execution-focused-tools/native-forward-complete.json), [missão inversa](execution-focused-tools/native-reverse.json), [metadata Codex](execution-focused-tools/validation/codex-metadata.json).

## Duas tarefas reais, sem ampliar o orçamento

Modelos fixados: `claude-haiku-5-5` e `gpt-6-luna`, esforço baixo. Limites mantidos: 1.500.000 tokens e US$ 0,15 de custo Claude conhecido por missão; seis minutos por fase; sem fallback ou nova tentativa paga após o resultado. O supervisor só abre a missão, observa, executa o oracle protegido e injeta a interrupção controlada. Os agentes reais delegam, entregam, confirmam recibos, revisam e declaram conclusão.

| Caso | Resultado funcional | Tokens observados | USD Claude conhecido | Gate limitado |
|---|---|---:|---:|---|
| Codex líder → Claude implementação → Codex revisão (`bug-mean`) | Dois resultados aceitos, recibos confirmados, integração atual e missão pronta | 1.439.381 | 0,007680 | Aprovado, 3 aberturas |
| Claude líder → Codex implementação → Claude revisão (`bug-pagination`), com SIGKILL e retomada | Resultado/recibo preservados; revisão e integração aceitas; missão pronta | 1.515.110 | 0,029842 | Reprovado: excesso de 15.110 tokens e auditoria de identidade incompleta, 5 aberturas |

Total das duas tarefas, incluindo retomada: **2.954.491 tokens observados**, subtotal Claude conhecido **US$ 0,037522**. Custo completo permanece `null`, pois Codex não informa USD. O consumo inverso é cumulativo e não foi somado duas vezes. Os totais usam o contador nativo, sem reconstruí-lo pela soma de componentes de input/output. [Agregado verificável](execution-focused-tools/observations.json).

As duas execuções passaram o oracle depois de encerrar os processos: fixtures protegidos intactos e alterações somente em `src/stats.mjs` ou `src/page.mjs`. Não houve dispensa, implementação repetida ou aumento de orçamento. As fontes e pins de cada execução estão nos manifests e snapshots próprios. [Fluxo normal](execution-focused-tools/forward-1/summary.json), [fluxo inverso](execution-focused-tools/reverse-1/summary.json).

### Recuperação e limitação da auditoria

O SIGKILL ocorreu depois do commit durável conjunto de resultado/outbox e antes do dispatch. A retomada consumiu o mesmo resultado `f7dc3732-0892-4a1e-94d6-932cf3519857`, tentativa `4b56238d-b23a-45ee-9248-a9033f4cce4f` e recibo `48366b59-e612-42fe-8527-f2ae1972e800`. A revisão cruzada e o aceite final foram registrados; os dois recibos ficaram `agent_acknowledged`.

O líder fechou os helpers antes da auditoria final. O runner procurava a identidade corrente somente na lista de panes e marcou o worker como ausente. A identidade do líder retomado foi confirmada, mas **a comparação final completa de sessões/epochs e o replay original não passaram**. Isso não é evidência de perda da sessão; também não autoriza marcar o gate como verde. O registro original foi preservado.

Uma auditoria offline dos baselines retidos reaplicou os dois reports do checkpoint e obteve delta zero, sem alterar a missão nem abrir modelos. Ela comprova a idempotência desses baselines, sem reconstruir a observação de identidade que faltou. [Auditoria suplementar](execution-focused-tools/reverse-1/post-run-accounting-audit.json).

O runner agora retém snapshots independentes dos panes observados nesta execução antes do fechamento e os usa na auditoria. Não infere sessões pelo checkpoint; uma identidade diferente permanece diferente. Dois testes locais cobrem remoção, mutação da referência e substituição de sessão. **Essa correção do supervisor ocorreu após o piloto e ainda não foi exercitada em nova chamada nativa.** Os snapshots dos pilotos permanecem na revisão anterior; não foram reescritos.

## Verificação local

| Verificação | Resultado | Evidência |
|---|---|---|
| Suíte sidecar no Node empacotado 24.21.0 | 201/201, exit 0 | [Log](execution-focused-tools/validation/node24-tests.log) |
| Testes desktop | 6/6, exit 0 | [Log](execution-focused-tools/validation/desktop-tests.log) |
| Perfil e retomada após ajuste de tipagem da fixture | 7/7, exit 0 | [Log](execution-focused-tools/validation/profile-final.log) |
| Retenção de observações do supervisor | 2/2, exit 0 | [Log](execution-focused-tools/validation/observations-green.log) |
| `npm run typecheck` | Sem erros, exit 0 | [Log](execution-focused-tools/validation/typecheck.log) |
| Build Tauri debug | Bundle macOS 167,63 MiB, exit 0 | [Log](execution-focused-tools/validation/build.log) |
| `git diff --check` | Sem erros, exit 0 | [Log](execution-focused-tools/validation/diff-check.log) |
| Interface em fixture isolada | Alternância salva, persiste após reload e funciona com Space | [Captura](execution-focused-tools/settings-focused.png) |

Os testes novos começaram vermelhos; logs foram preservados. A suíte inicial foi executada indevidamente em paralelo ao build, que recria o executável Node empacotado; houve falha transitória de spawn. A execução final ocorreu depois do build, sem sobreposição. O teste antigo de retomada também supunha que um token de terminal viria inteiro em um frame. A regressão forçou frames de quatro caracteres e passou após acumular o stream na fixture, sem mudar o transporte de produção.

O build mantém o aviso de chunk JS acima de 500 kB. O helper no `.app` corresponde por hash à fonte: [índice de validação e artefatos](execution-focused-tools/validation/validation.json). O servidor/aba temporários de QA e os processos próprios dos pilotos foram encerrados; os [PIDs retidos foram conferidos](execution-focused-tools/validation/process-cleanup.json). O app instalado e os servidores pessoais não foram substituídos.

## O que falta

O perfil solicitado está implementado e validado. A meta de redução drástica e o candidato para uso diário continuam pendentes: o caso inverso excedeu o limite e falta exercitar a nova retenção de identidade em uma futura rodada nativa autorizada. Não houve A/B controlado.

Os transcripts apontam a próxima redução concreta: chamadas redundantes de coordenação, tentativas de abrir revisão com `dependsOn` antes do aceite e erros de preenchimento de evidências. A semântica atual de dependência exige resultado aceito, portanto uma revisão do próprio resultado não deve depender desse aceite. Os dois líderes contornaram a recusa, mas gastaram chamadas. Reduzir esse retrabalho e o catálogo/contexto nativo restante deve preceder uma ampliação do corpus ou testes em repositórios grandes.
