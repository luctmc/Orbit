# Overclock, REA e confiabilidade real do Orbit

14/10/2026. Continuação do [levantamento estático](overclock-comparison.md). Esta etapa analisou o código do repositório REA, executou sua CLI sobre artefatos locais do Overclock e inspecionou a interface do Overclock já em execução. Também exercitou Claude e Codex reais pelo sidecar do Orbit. As três fontes de evidência têm alcances diferentes.

## Resposta à pergunta original

A primeira entrega tinha consultado o REA e examinado arquivos do Overclock, mas não tinha realizado essa sequência completa. Agora ela foi realizada. Não se recuperou o núcleo inteiro do Overclock: seu sidecar principal contém bytecode bytenode, que o analisador JavaScript do REA não decompila.

## Repositório e execução do REA

A [auditoria do código fonte](rea-source-audit.md) registra revisões, caminhos, limites e links presos a commits. Foram examinados main `3d2846f2371bc3e73b7069f713f6daa80f4db78c` (6.5.0) e a tag `rea-agents-6.4.0`, commit `a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`. A execução utilizou **6.4.0**, sem atribuir a ela recursos presentes somente em main.

Após a rejeição inicial da execução npm pela revisão automática, a procedência, a metadata e o launcher foram examinados. A nova execução com versão fixa, cache temporário e lifecycle desativado foi aprovada. Não se registrou servidor MCP nem se alterou a configuração do REA. O comando foi:

```sh
npm exec --ignore-scripts --offline --cache /tmp/orbit-rea-npm-cache --yes --package=rea-agents@6.4.0 -- rea analyze-javascript-application /Applications/Overclock.app/Contents/Resources/sidecar/arms-mcp --artifact-format directory --max-heap-mb 512 --analysis-timeout-ms 15000 --format json
```

| Escopo | Resultado | Evidence ID |
|---|---|---|
| `sidecar/arms-mcp` | 30 fontes parseadas, 135.353 bytes de texto, 327 findings, zero falhas de parse | `ev_e6b1ad96979e7b0b9cdd5b9ebc40e605a89a53c17c2dfa74f27a0f649d2683f7` |
| `sidecar/dist` | Um loader JS de 132 bytes, cinco findings; núcleo `.jsc` não decompilado | `ev_72b3ec0c7ea3c3abeeaad5a1ded1c660354f713d9e54ed19faf6dffba282eac1` |

Os resultados canônicos completos estão preservados em gzip em [rea-evidence](rea-evidence/index.json), com SHA-256 do JSON descomprimido, identidade dos alvos e limitações. [arms-summary.json](rea-evidence/arms-summary.json) é uma projeção legível da análise. “Complete” no grafo significa cobertura do escopo selecionado, não conhecimento completo do produto ou cobertura semântica integral. Findings são observações de análise, não 327 bugs.

O código legível do conector confirma a distinção entre retry de consultas e mutações, recuperação de sessão e recibos de transporte. Isso sustenta decisões de idempotência no Orbit; não revela o algoritmo do líder escondido no bytecode. O Overclock é Tauri/WebKit, portanto não se aplicou a ele uma captura específica de Electron.

## Overclock observado na máquina

Foi inspecionada a versão instalada **1.4.13**, sem atualizar o aplicativo, salvar configurações ou iniciar trabalho nas missões existentes. Conversas, credenciais e capturas de conteúdo privado não foram incorporadas aos artefatos desta análise.

| Observação da interface | Implicação para o Orbit |
|---|---|
| Piloto e ajudantes, panes com sessões retomadas e histórico | Sessões, papéis e estado persistente precisam continuar coerentes após reinício |
| Medidores de uso, cache, limites e várias contas Codex | Exibir uso conhecido e sua origem; distinguir custo estimado de cobrança real |
| Tabela com 12 tipos, CLI/modelo/effort/skills/persona por tipo e fallback | A escolha efetiva deve ser explicável, preservar overrides e validar o catálogo |
| Configuração observada encaminhava os 12 tipos a Claude apesar de haver Codex conectado | Ter vários provedores disponíveis não comprova distribuição inteligente entre eles |
| `claude-sonnet-5` aparecia como “indisponível (o CLI não aceita)” | Um modelo salvo pode ficar obsoleto; validar disponibilidade no momento de usar e explicar o fallback |
| Cinco decisões automáticas estavam desligadas, com fallback por regras indicado na interface | Separar capacidade anunciada de recurso realmente ativo |

Esses são estados observados nesta instalação, não defaults universais do Overclock. A indicação de modelo indisponível não prova falha em toda execução, pois pode existir fallback. Benchmarks anunciados na tela não foram reproduzidos. A inspeção terminou quando o Mac foi bloqueado; não se tentou desbloqueá-lo automaticamente.

## Falhas reproduzidas no Orbit e correções

1. **Codex só leitura não iniciava.** O Orbit adicionava a pasta de anexos com `--add-dir`; o Codex 0.162.1 interpreta isso como raiz adicional gravável e rejeita a combinação com `-s read-only`. O launcher agora omite esse argumento no modo só leitura e conserva referências absolutas aos arquivos. O sandbox permanece só leitura. O erro original foi reproduzido com o CLI real e a regressão automatizada falhou antes da correção.
2. **Saída do CLI era mascarada por um shell.** O launcher anexava `; exec <shell> -l`, fazendo um CLI encerrado parecer um pane ocioso utilizável. Agora o processo encerra com o status real. A regressão executa um CLI sintético que retorna 23: antes retornava 0, depois retorna 23. O pane de terminal shell continua sendo um terminal.

Implementação: [command.ts](../../packages/sidecar/src/command.ts). Regressões: [command.test.ts](../../packages/sidecar/test/command.test.ts). As expectativas antigas dos testes Gemini/Antigravity e retomada foram atualizadas para o novo ciclo de vida.

## Validação com os CLIs reais

Ambiente: Claude Code **2.1.296**, Codex CLI **0.162.1**, autenticações existentes, sidecar real, PTYs reais, launcher de produção e MCP do Orbit. Cada execução criou repositório Git e dados do Orbit temporários, com somente `canary.txt`. Não foi usada implementação falsa de agente. Os prompts de confiança foram confirmados somente para a pasta sintética criada pelo diagnóstico.

Claude Haiku e Codex `gpt-6-luna`, effort baixo, leram `ORBIT_SYNTHETIC_CANARY_8421` e enviaram `handoff_submit` com status `done` e o conteúdo correto. Ambos tiveram IDs de conversa detectados. Isso prova lançamento → autenticação → tarefa → ferramenta de leitura → MCP → resultado persistido para esse cenário.

O diagnóstico reproduzível é [verify-live-clis.mjs](../../scripts/verify-live-clis.mjs):

```sh
node scripts/verify-live-clis.mjs --live
```

É opt-in, utiliza os limites das contas autenticadas, não integra a suíte automática e retorna falha se os dois agentes não entregarem o marcador correto com identificação de sessão. Os dados e telas sintéticos ficam na pasta temporária indicada na saída. Ele não valida escrita, PRs, retomada após queda, percepção de imagens, voz ou qualidade de uma tarefa de programação inteira.

Uma execução preliminar atingiu o teto sintético de 12 mil tokens cumulativos e interrompeu ambos os agentes, como configurado. O diagnóstico final usa teto de 150 mil tokens e estimativa de US$ 0,50. Tokens cumulativos incluem uso/cache de várias chamadas; não são a ocupação instantânea da janela de contexto. A estimativa não é uma fatura dos planos por assinatura.

## Comparação e próximos critérios de confiança

O [refinamento implementado](orbit-refinement.md) já acrescenta ledger persistente de atividades, deduplicação concorrente e de handoffs, classificação local de dificuldade, escolha por família de modelo, líder adaptativo opcional e envio de mensagens/anexos com confirmação local. O comparativo agora tem evidência real adicional, sem depender de copiar o código do Overclock.

Antes de considerar o Orbit substituto plenamente validado para o trabalho diário, ainda faltam cenários de aceitação maiores:

- Uma tarefa real de código com Claude e Codex: implementação, revisão cruzada, testes, branch e entrega, com falhas e retomada controladas.
- Envio de imagem/arquivo seguido de interpretação comprovada por ambos os CLIs; o ACK atual confirma entrega local ao processo, não compreensão pelo modelo.
- Ditado no bundle com microfone, permissões e interrupção reais.
- Catálogo com origem/versionamento de capacidades e custos; benchmark de qualidade, duplicações, latência e tokens por atividade. A tabela atual não comprova otimização econômica ideal.
- Dependências e integração de worktrees mais formais. O líder ainda decide o plano; não existe executor completo de DAG.

A evidência desta etapa melhora a confiança no caminho básico e elimina duas falhas concretas. Ela não sustenta promessa de confiabilidade absoluta ou superioridade universal ao Overclock.

## Verificação final do checkout

- `npm test`: 97/97 testes sidecar e 2/2 desktop, exit 0.
- `npm run typecheck`: exit 0.
- `npm run tauri -w @orbit/desktop -- build --debug`: exit 0, `apps/desktop/src-tauri/target/debug/bundle/macos/Orbit.app` gerado.
- Diagnóstico real reproduzível: exit 0, dois handoffs corretos e sessões identificadas; [registro sintético](rea-evidence/orbit-live-clis.json).

As mudanças permanecem no checkout local. Este build não substituiu o aplicativo instalado e não foi publicado como release.

Continuação: [harness, adaptadores e eficiência](overclock-harness-deep-dive.md) aprofunda os contratos e registra dois novos defeitos reproduzidos após esta validação básica. Os 99 testes anteriores não cobriam esses cenários.
