# Auditoria do código REA para investigar o Overclock

> A execução posterior do coordenador e seus Evidence IDs estão no [relatório de validação](overclock-runtime-followup.md). Os limites e a rejeição abaixo descrevem o estado no momento desta auditoria de fonte.

Inspeção em 14/10/2026. Esta etapa aprofundou o código do REA, além do README e da análise estática anterior do Overclock. Não foram instaladas dependências nem executados launcher REA, testes REA ou executáveis do Overclock por este pesquisador. A execução da CLI e a verificação de Codex/Claude pertencem à etapa de validação separada.

## Revisões e procedência

O repositório oficial `https://github.com/morluto/rea` foi clonado em `/tmp/orbit-rea-source`. A primeira tentativa sem rede falhou em DNS; a operação com acesso de rede aprovado concluiu com exit 0. A revisão de main obtida foi **`3d2846f2371bc3e73b7069f713f6daa80f4db78c`**, com `package.json` versão **6.5.0**. Para auditar a versão exata proposta para CLI, também foi obtida a tag **`rea-agents-6.4.0`**, commit **`a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`**. `v6.4.0` não existe nesse remoto; não confundir os nomes.

Os links de código abaixo estão presos aos commits, pois **as capacidades de main e 6.4.0 diferem**. Não se assume que uma tag Git comprove os bytes dos arquivos compilados publicados no npm. O checkout não contém `node_modules` preparado para rodar a suíte; os testes citados foram lidos, não executados.

## O que a análise JavaScript realmente faz

O registro do comando [electronCommands.ts:230](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/electronCommands.ts#L230) recebe ASAR ou diretório e encaminha controles ao serviço. [JavaScriptApplicationService.ts:55](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/application/javascript/JavaScriptApplicationService.ts#L55) inventaria, reconstrói o grafo, valida resultados e produz Evidence com hash. A fronteira sintática é [Babel, javascriptSourceParser.ts:1](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/domain/javascript/javascriptSourceParser.ts#L1): parse de JS/TS/JSX e recuperação de erros, sem executar o código analisado.

[JavaScriptArtifactFiles.ts:67](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/artifacts/javascript/JavaScriptArtifactFiles.ts#L67) lê bytes consistentes com o inventário e exige paths exatos para seleção. O resultado registra arquivos fora do escopo. A existência de um grafo não transforma relações inferidas em execução observada.

O analisador cria **um processo auxiliar próprio**, não o processo do artefato: [JavaScriptAnalysisWorker.ts:451](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/javascript/analysis/JavaScriptAnalysisWorker.ts#L451) cria diretório temporário privado e inicia `process.execPath` com o worker do REA e limites V8. Portanto, “análise estática” não significa “zero criação de arquivos/processos”. Os efeitos esperados são leitura do alvo, worker e workspace temporário do REA, saída de Evidence e limpeza dos recursos próprios.

Em main, os defaults são 1024 MiB de old-space, 300.000 ms por fonte, 100.000 nós semânticos totais e 20.000 por arquivo; [javascriptAnalysisResourceControls.ts:5](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/domain/javascript/javascriptAnalysisResourceControls.ts#L5). Limites/cancelamento podem devolver cobertura parcial. [JavaScriptApplicationService.ts:109](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/application/javascript/JavaScriptApplicationService.ts#L109) tenta preservar Evidence concluída antes de cancelamento; erro ou parcial não autorizam alegar investigação completa.

## Limite decisivo: bytenode não é recuperado

O Overclock 1.4.13 fornece um loader legível `sidecar/dist/index.js` de 132 bytes, que carrega `index.jsc` de 6.660.416 bytes. A identidade e os hashes estão no [relatório anterior](/Users/lucas/Documents/GitHub/Orbit/docs/analysis/overclock-comparison.md).

**Main 6.5.0:** [javascriptArtifactFiles.ts:5](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/domain/javascript/javascriptArtifactFiles.ts#L5) admite como fonte apenas extensões JS/TS. O teste [javascriptRequireLiteralPaths.test.ts:201](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/tests/boundary/filesystem/javascriptRequireLiteralPaths.test.ts#L201) exige que `require('./core.jsc')`, quando o arquivo existe, produza `resolution_status: unavailable`, preservando path/hash/tamanho; o arquivo ausente resulta em `not-found`. Esse teste é evidência direta de que o grafo **não decompila** o alvo `.jsc`.

**Release 6.4.0:** [JavaScriptArtifactFiles.ts:390](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/artifacts/javascript/JavaScriptArtifactFiles.ts#L390) também classifica fontes por extensões JS/TS. Uma busca delimitada `git grep` em `src` e `tests` da tag não encontrou backend bytenode nem tratamento `.jsc`; o único match amplo de `jsc` foi `jsconfig.json`. Não atribuir à release antiga os diagnósticos específicos adicionados em main.

O comando `recover-javascript-sources` também **não** é decompilador de bytecode V8. [javascriptRecoveryCommands.ts:20](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/javascriptRecoveryCommands.ts#L20) exige JavaScript UTF-8 e diretório de saída inexistente. O adapter [WakaruCommand.ts:61](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/javascript/recovery/WakaruCommand.ts#L61) recusa hosts diferentes de Linux x64, requer binário Wakaru explícito e `prlimit`; portanto essa recuperação não é suportada no macOS arm64 desta investigação. Ela recupera estrutura de bundles legíveis, não recria o núcleo bytenode do Overclock.

## Comandos suportados e versões

| Operação | 6.4.0 | Main 6.5.0 |
|---|---|---|
| `analyze-javascript-application PATH --json` | Sim | Sim |
| `--artifact-format directory` | Sim | Sim |
| `--integrity-policy fail` | Sim, default | Sim, default |
| `--max-heap-mb`, `--analysis-timeout-ms` | Sim | Sim |
| `--source-path` repetível | **Não** | Sim; sem dependências implícitas |
| `--max-semantic-nodes`, `--max-semantic-nodes-per-file` | **Não** | Sim |
| `inspect-analysis-view INPUT.json --json` | Sim | Sim |

Fontes: [opções da tag 6.4.0](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/cliObservationOptions.ts#L62), [opções de main](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cliObservationOptions.ts#L63), [registro da CLI 6.4.0](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/cli/electronCommands.ts#L182), [analysisViewCommands.ts:72](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/analysisViewCommands.ts#L72).

Uma análise pequena compatível com 6.4.0, depois de a CLI estar disponível e autorizada, é:

```sh
rea analyze-javascript-application /Applications/Overclock.app/Contents/Resources/sidecar/arms-mcp --artifact-format directory --max-heap-mb 512 --analysis-timeout-ms 30000 --json > /tmp/orbit-overclock-arms-evidence.json
```

Isso cobre o conector legível, **não** o núcleo do orquestrador. A pasta `sidecar` completa inclui dependências e pode gerar Evidence muito maior. Em main 6.5.0 é possível selecionar exatamente `dist/index.js`, `package.json` e os módulos `arms-mcp/*.js` necessários, usando um `--source-path` por arquivo, sem glob. Cada path deve existir no inventário; a seleção deliberadamente parcial deve continuar marcada assim.

O comando genérico `analyze` exclui `.app` do roteamento automático JavaScript ([coreBinaryCommands.ts:235](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/coreBinaryCommands.ts#L235)). Não interpretar `rea analyze Overclock.app` como equivalente à análise JS do diretório `sidecar`.

Para não inserir um grafo enorme no contexto, salvar o JSON completo e gerar arquivo de view:

```json
{
  "source": { "kind": "inline", "evidence": "SUBSTITUIR PELO OBJETO EVIDENCE COMPLETO" },
  "view": { "kind": "summary" }
}
```

O valor `evidence` deve ser o objeto, não esse placeholder textual. Em seguida `rea inspect-analysis-view /tmp/orbit-overclock-view.json --json`. Views por módulo e traces devem partir dos IDs efetivamente retornados, preservando limitations/coverage/unknowns. IDs inventados ou JSON truncado não servem como entrada autenticada.

## Native, runtime e aplicação neste host

O executável do Overclock é Mach-O arm64. [GhidraInstallation.ts:40](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/ghidra/GhidraInstallation.ts#L40) admite macOS x64/arm64 e verifica formato/arquitetura das ferramentas nativas. Isso demonstra suporte do adapter ao host, **não** que Ghidra/Java/Hopper estejam instalados ou prontos aqui. Nenhum desses provedores foi executado nesta etapa.

Uma decompilação nativa usa provider real e análise de funções. O registro [coreBinaryCommands.ts:189](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/coreBinaryCommands.ts#L189) encaminha `decompile` para `procedure_pseudo_code`. Esse caminho pode ajudar a entender integrações do host Tauri/Rust/WebKit, mas **não** converte o arquivo separado `.jsc` em TypeScript nem demonstra o algoritmo de delegação do sidecar.

Há três superfícies distintas de runtime:

- **Electron/CDP:** [electronCommands.ts:82](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/electronCommands.ts#L82) registra captura que executa um Electron fornecido. Overclock identificado é um host Tauri/WebKit; não assumir compatibilidade Electron, endpoint Chromium ou API IPC Electron.
- **UI nativa existente:** [utilityCommands.ts:91](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/utilityCommands.ts#L91) registra observação de PID + windowId exatos; [linhas 107–141](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/utilityCommands.ts#L107) registram cenário que pode agir por acessibilidade. Requer acesso/permissões do sistema; screenshot/árvore podem conter dados privados. Não foi acionado aqui.
- **Processo/LLDB:** [processCommands.ts:19](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/processCommands.ts#L19) executa cenário de processo; [nativeCallCommands.ts:22](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/src/cli/nativeCallCommands.ts#L22) lança Mach-O sob LLDB. Ambos executam alvo e ficam fora desta pesquisa read-only.

O caminho útil imediato é Evidence estática do código legível mais testes do próprio Orbit. Para resolver algoritmos internos ainda desconhecidos do Overclock seria necessário outro tipo de evidência, como fonte autorizada ou cenário controlado de runtime, com limites e autorização próprios; não prometer que instalar REA desbloqueia automaticamente bytenode.

## Auditoria específica de `rea --help` e lifecycle 6.4.0

A revisão automática recusou a tentativa do coordenador de executar pacote npm externo por procedência/efeitos ainda não verificados. Este pesquisador não repetiu nem contornou essa execução. A inspeção abaixo é evidência para eventual reavaliação; não é uma concessão de aprovação nem uma prova de segurança integral das dependências.

Na tag exata [scripts/rea.mjs:9](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/scripts/rea.mjs#L9):

1. O launcher lê argv e `package.json`, define `REA_PACKAGE_VERSION` no processo e calcula paths. O ajuste de cache Playwright só ocorre no Android.
2. Somente argumentos exatos `mcp`/`--mcp` entram no servidor. `--help` segue a CLI, não setup ou MCP.
3. As linhas 33–43 verificam a existência de `dist/cli.js`, `dist/cliOutput.js` e `dist/cli/streamedJsonOutput.js`. Ausência apenas imprime erro/instrução e retorna exit 1; o launcher **não executa** o `npm ci`/build sugerido na mensagem.
4. As linhas 55–80 importam o runtime CLI, validam argumentos e chamam `createCli(...).serve(args)`, que deixa o Incur renderizar help. Não há chamada direta a rede, instalação, spawn de alvo ou escrita de configuração no launcher inspecionado.

[src/cli.ts:47](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/cli.ts#L47) instancia o catálogo com `sync:false`. [createDirectAnalysis:16](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/composition/directAnalysis.ts#L16) prepara callbacks de configuração e sessão; não abre binário ao criar a CLI. A aplicação de setup reside no callback `run` do comando, não no mero registro. O logger escreve em stderr, não em arquivo próprio ([logger.ts:15](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/logger.ts#L15)). Há imports transitivos; não foi feita prova exaustiva de ausência de efeitos em todas as bibliotecas importadas.

O `package.json` da tag declara `prepare` e `prepack`, sem `preinstall/install/postinstall` de nível raiz. [prepare.mjs:24](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/scripts/prepare.mjs#L24) pode instalar hooks Husky quando `HUSKY != 0`, `src` e `node_modules/husky` existem. [prepack.mjs:40](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/scripts/prepack.mjs#L40) pode iniciar build/metadata no checkout fonte; no pacote compilado verifica arquivos. Esses scripts **não** foram invocados. Desativar lifecycle com `--ignore-scripts` e usar cache temporário reduz efeitos de aquisição, mas o launcher e imports ainda são código externo executável; a revisão de aprovação permanece necessária enquanto o bloqueio persistir.

Pendências para uma reavaliação concreta: verificar integridade do tarball/metadata npm, conferir seus arquivos compilados contra a procedência informada, delimitar cache/saídas em `/tmp`, manter lifecycle desativado e limitar o primeiro comando a `--help`. Não registrar MCP, não alterar skills/configurações e não executar o Overclock nesse primeiro passo. A auditoria não pressupõe aprovação desses passos.

## Testes relevantes lidos e confiança prática

| Teste/fonte | O que verifica no projeto REA | O que não foi provado nesta sessão |
|---|---|---|
| [javascriptSourceSelectionCli.test.ts:30](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/tests/acceptance/applications/javascriptSourceSelectionCli.test.ts#L30) | Flags repetíveis, arquivos selecionados, cobertura parcial e bytes originais preservados | Execução desses testes ou suporte da release 6.4.0 a flags novas |
| [javascriptAnalysisLimits.test.ts:37](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/tests/acceptance/applications/javascriptAnalysisLimits.test.ts#L37) | Limites escolhidos preservados na Evidence | Capacidade de memória/latência do Overclock real |
| [javascriptAnalysisLimits.test.ts:117](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/tests/acceptance/applications/javascriptAnalysisLimits.test.ts#L117) | Timeout preserva partial Evidence e sessão responde a ping | Cobertura total após timeout |
| [javascriptRequireLiteralPaths.test.ts:201](https://github.com/morluto/rea/blob/3d2846f2371bc3e73b7069f713f6daa80f4db78c/tests/boundary/filesystem/javascriptRequireLiteralPaths.test.ts#L201) | Arquivo `.jsc` presente opaco é distinto de ausente | Semântica do bytecode |

Para tornar Orbit um ambiente principal confiável, as lições implementáveis do REA são: identidade/hash por artefato e operação; proveniência do resultado; cobertura e falha parciais explícitas; limites de recursos; limpeza de processos próprios; testes na fronteira CLI real; distinção entre código estático e comportamento em execução. REA não certifica que Codex/Claude funcionem no Orbit: isso exige smoke tests dos adaptadores, entrega de prompt/anexo, interrupção, retomada e handoff, usando versões instaladas e ambiente temporário. Esses resultados devem ser registrados pela etapa de validação, não inferidos desta auditoria.
