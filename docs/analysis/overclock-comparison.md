# Overclock 1.4.13 — evidências para o refinamento do Orbit ADE

> Etapa histórica. A continuação com auditoria do repositório REA, execução real do analisador, inspeção do aplicativo e testes Claude/Codex está em [overclock-runtime-followup.md](overclock-runtime-followup.md).

Investigação estática em 14/10/2026. O alvo foi `/Applications/Overclock.app`; nenhum executável do alvo foi iniciado, nenhuma configuração foi alterada e nenhum segredo ou descritor de sessão foi lido. Esta análise sustenta escolhas de arquitetura; não mede desempenho real nem comprova comportamento em execução.

## Identidade e método

O `Contents/Info.plist` declara `sh.overclock.app`, versão/build `1.4.13`, executável `overclock`. `file` identifica o executável como Mach-O arm64. `otool -L` mostra vínculos com WebKit, AppKit, CoreAudio e AudioToolbox. Essas dependências são evidência de integração nativa, não prova de um fluxo de voz específico.

| Artefato | Bytes | SHA-256 |
|---|---:|---|
| `Contents/MacOS/overclock` | 26.403.664 | `9f84731e2b17f73ee2950b51c5941c6dc6bb4af347dbf793e0b2b70866bd0d74` |
| `Contents/Resources/sidecar/dist/index.js` | 132 | `d1f949bf405665bbf11d76e6042096cdd7e08e511a70edb72926bf2a70207183` |
| `Contents/Resources/sidecar/dist/index.jsc` | 6.660.416 | `b9810acbd3408f039eeea1ce937dd4d01f0b7023a911124433dd297b53a488bb` |

Foi aplicada a skill [reverse-engineer-anything](/Users/lucas/.agents/skills/reverse-engineer-anything/SKILL.md), incluindo seus guias de conexão e aplicações JavaScript. Não havia ferramentas REA anunciadas nesta sessão; `command -v rea` não encontrou CLI no PATH. Não foi instalado pacote nem reparada a configuração. A recuperação documentada admite continuar com ferramentas estáticas comuns e exige distingui-las de Evidence produzida pelo REA. Portanto, este relatório não possui Evidence IDs REA.

O [repositório oficial do REA](https://github.com/morluto/rea) foi consultado como referência solicitada. Ele descreve análise local de JavaScript, aplicações e binários, com limites explícitos. A presença da skill não prova que o servidor ou um decompilador esteja conectado. Não foi possível decompilar o bytecode principal do Overclock nesta investigação.

As referências de Orbit correspondem ao checkout com HEAD `04818974a4d3bd075ca24dc1b5b39c27d5244a8a`, antes das alterações deste refinamento; arquivos locais podem evoluir durante a implementação. Não usar as linhas de Orbit abaixo como evidência da implementação final.

## Arquitetura observada

**Observado em arquivos:** [package.json](/Applications/Overclock.app/Contents/Resources/sidecar/package.json:4) descreve um host WebSocket Node para migração Tauri, exige Node >=22.12 e declara SDK Claude, módulos de bus/core/catalog/MCP/PTY, `ws`, `zod` e `bytenode`. O [loader](/Applications/Overclock.app/Contents/Resources/sidecar/dist/index.js:1) importa bytenode e carrega `index.jsc`. A lógica central não está disponível como TypeScript ou JavaScript legível nesse ponto de entrada.

**Observado em código legível:** [arms-mcp/index.js](/Applications/Overclock.app/Contents/Resources/sidecar/arms-mcp/index.js:2) exporta discovery, proxy e board relay; o comentário define um conector para orquestradores externos. [discovery.js](/Applications/Overclock.app/Contents/Resources/sidecar/arms-mcp/discovery.js:4) explica a descoberta por descritor, porta dinâmica e credencial por boot; os trechos de validação ficam nas linhas 97–123. Valores reais de descritores não foram consultados.

**Inferência delimitada:** os artefatos são compatíveis com host nativo/WebView + sidecar Node + CLIs/PTY + MCP, uma separação semelhante à do Orbit. O manifesto não comprova todas as ligações em execução. Não houve inspeção de processos vivos, sessões do usuário ou tráfego.

## Líder, contexto e delegação

Os manuais embarcados são contratos pretendidos pelo produto. Sua existência é observada; sua aplicação pelo código oculto não foi verificada.

| Contrato embarcado | Evidência | Aplicação útil ao Orbit |
|---|---|---|
| O piloto de missão agêntica pensa/decompõe; ajudantes executam; lote único para atividades independentes | [oc-pilot](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-pilot/SKILL.md:13), linhas 17–23 | Papel de líder estabelecido no nascimento, com ferramentas compatíveis com essa função |
| Encerrar o turno após delegar; handoff acorda o piloto | [oc-pilot](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-pilot/SKILL.md:30) e [oc-mcp](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-mcp/SKILL.md:325) | Coordenar por eventos, evitando polling e repetição do objetivo a cada retorno |
| Tarefa aponta para registro; registro carrega contrato | [oc-pilot](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-pilot/SKILL.md:82), [oc-mcp](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-mcp/SKILL.md:313) | Identificador estável de atividade, contexto mínimo e retorno por referência |
| Deduplicar tudo que já foi visto; retomar worker fechado preservando contexto | [oc-pilot](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-pilot/SKILL.md:95) | Ledger de atividades e tentativas, com decisão explícita entre continuar e abrir trabalho novo |
| Validar artefatos na entrega contra schema declarado no nascimento | [oc-mcp](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-mcp/SKILL.md:254) | Validação de critérios antes de aceitar resultado; retries ligados à atividade original |

As cifras de tokens/economia nos manuais não foram reproduzidas. Não são benchmark desta análise. Também não se deve transportar a regra de delegar absolutamente tudo sem considerar o pedido do usuário: no Orbit, operações pequenas devem usar o menor número de agentes necessário.

No snapshot de Orbit, [prompts.ts](/Users/lucas/Documents/GitHub/Orbit/packages/sidecar/src/prompts.ts:80) já instrui decomposição, classificação por tipo, dificuldade e paralelismo. [core.ts](/Users/lucas/Documents/GitHub/Orbit/packages/sidecar/src/core.ts:1362) classifica uma atividade e abre um pane, mas o caminho de `spawnHelper` examinado (1362–1404) não reserva uma identidade de atividade nem consulta trabalho equivalente antes de spawn. Reforçar apenas a prosa do líder não resolve repetição por retry concorrente ou resposta perdida. Esse limite de busca não prova ausência de toda forma de dedup em outros módulos.

## Duplicação e transporte: evidência mais forte

O [boardRelay.js](/Applications/Overclock.app/Contents/Resources/sidecar/arms-mcp/boardRelay.js:201) separa métodos idempotentes de mutações: somente os primeiros passam por `postWithRetry`; chamadas restantes usam `postOnce` (linha 211). O erro informa que a ação pode ter acontecido e orienta conferir o estado antes de repetir (216–217). O laço de retry, nas linhas 130–151, aplica backoff e nova tentativa em erro de transporte/5xx. Não se trata de dedup semântica de tarefas, e sim prevenção de retry cego em transporte.

No [proxy.js](/Applications/Overclock.app/Contents/Resources/sidecar/arms-mcp/proxy.js:63), `ArmsTimeoutError` conserva a distinção entre sidecar lento e ausente, e alerta que repetir cegamente pode duplicar panes/mensagens. O mesmo arquivo permite uma recuperação específica de sessão HTTP 400 (346–374); portanto seria incorreto dizer que o proxy nunca repete requests.

Uma busca de literais em `index.jsc` encontrou `dedupText` no offset de byte 390713, `dest_dedup` em 391419, `deduped` em 920665 e `handoff.poke_deduped` em 4359081. São pistas de mecanismos internos, **não** prova de algoritmo, janela, escopo, persistência ou execução. Nenhuma dedup global do Overclock foi estabelecida.

Decisão recomendada para Orbit: reserva síncrona de uma chave por missão/atividade antes de qualquer classificação assíncrona; retorno do mesmo recibo para repetição idêntica; chave preservada em follow-ups e retries; estados separados para execução ativa, entrega e tentativa adicional. Mudanças intencionais do escopo precisam criar uma revisão identificada, sem usar apenas título do pane como identidade. Handoffs repetidos também precisam ser idempotentes, pois um retorno duplicado pode reativar o líder e disparar nova rodada.

## Seleção de modelo e esforço

O [oc-mcp](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-mcp/SKILL.md:150) declara resolução de CLI/modelo/effort/skills/persona por tabela de tipo. Campo explícito prevalece; tipo desconhecido leva à classificação/default declarado no recibo. As linhas 166–170 distinguem prévia determinística da decisão efetiva. As [linhas 267–279](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-mcp/SKILL.md:267) detalham recibo com origem da escolha e fallback. As [linhas 281–286](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-mcp/SKILL.md:281) documentam um decisor externo e fallback para regras. Não foram feitas chamadas a provedores.

No Orbit, [maestro.ts](/Users/lucas/Documents/GitHub/Orbit/packages/sidecar/src/maestro.ts:89) já contém uma escada cheap/strong para Claude/Gemini e ajuste de esforço compatível com o modelo. No snapshot examinado, Codex conserva o modelo e altera esforço, pois não consta nessa escada. [core.ts](/Users/lucas/Documents/GitHub/Orbit/packages/sidecar/src/core.ts:1372) já combina regras e classificador leve quando ambíguo, mantendo fallback se o decisor falha. A evolução útil é tornar capacidades/custo relativo explícitos em catálogo validado, preservar escolhas humanas e informar o resultado efetivo no recibo. Não assumir que uma tabela fixa constitui otimização de custo monetário real.

## Anexos, imagens e voz

**Voz parcialmente respondida:** [oc-guide](/Applications/Overclock.app/Contents/Resources/resources/arsenal/skills/oc-guide/SKILL.md:148) descreve ClockVoice como push-to-talk, transcrição local/API e modos code/chat; Jarvis aparece como interface de controle que conversa com o piloto. `index.jsc` contém `audio:transcribe` no offset 5918953. Não se estabeleceu provedor, codec, latência, retenção ou suporte efetivo na máquina. Para o Orbit, [dictation.ts](/Users/lucas/Documents/GitHub/Orbit/apps/desktop/src/orbit/dictation.ts:25) detecta Web Speech API e esconde a função quando não existe: isso explica a limitação de disponibilidade da interface, sem demonstrar a causa em um runtime específico.

**Anexos de imagem não resolvidos:** os manuais pesquisados documentam geração de mídia e screenshots, mas não estabeleceram o caminho de anexar uma imagem do usuário ao prompt. A maior parte dos literais `attachment` no bytecode refere-se a `pane_attach`, conexão de terminal, não upload de imagem. Não confundir essas superfícies. O suporte a anexos no Orbit deve ser implementado e validado pelos adaptadores das CLIs do próprio projeto, sem atribuir ao Overclock um comportamento não observado.

## Cobertura e limites

| Pergunta | Estado | Limite |
|---|---|---|
| Identidade/arquitetura de empacotamento | Respondida estaticamente | Topologia em execução não observada |
| Papel do líder e contratos de delegação | Parcial | Manuais legíveis; enforcement central em bytecode |
| Prevenção de repetição | Parcial | Retry de transporte observado; ledger/dedup global desconhecidos |
| Modelos/effort e fallback | Parcial | Contratos e recibos documentados; seleção real não executada |
| Voz | Parcial | Manual e strings; captura/transcrição não testadas |
| Anexos de imagens ao prompt | Não resolvida no Overclock | Sem evidência de fluxo completo no material legível pesquisado |

A análise usou inventário de arquivos, leituras com linhas, hashes SHA-256, metadata de Mach-O, buscas delimitadas e leitura de documentação oficial. Sem REA conectado/decompilador e sem executar o alvo, não é possível afirmar equivalência comportamental ou que Overclock é mais eficiente que Orbit. As recomendações são escolhas para o Orbit, apoiadas em contratos e em código de transporte observado, não uma cópia certificada da implementação do Overclock.
