# R6 — interface de trabalho e mascote Orbit

Interface e mascote implementados e verificados no checkout em 15/10/2026, após retomada autorizada pelo usuário. **Esta é a entrega visual/local da R6. O gate autônomo real bidirecional ainda está pendente.** Não houve novas chamadas a Claude/Codex, commit, push, instalação ou release nesta fatia. O build debug foi gerado sem substituir o app instalado.

## O que mudou

A missão agora apresenta um próximo passo derivado dos estados reais do motor: conexão, espera por resposta/permissão, orçamento atingido, atividade interrompida, revisão pendente, execução e conclusão verificada na consulta. Texto acompanha o estado; cor e mascote não são o único sinal.

O painel **Atividades** lê o ledger durável, incluindo trabalhos cujos terminais já foram fechados. Expõe responsável, modelo, esforço e motivo da escolha, critérios, dependências, último retorno, revisões, tentativas anteriores e recibos. Resultado salvo, envio ao terminal, confirmação de recebimento e aceite continuam separados. Os checks aparecem como saídas **informadas pelo revisor**, sem inventar execução comprovada pelo MCP.

`readyAt` sozinho deixou de produzir um selo de validação atual. A Base mostra “Conclusão declarada”. Dentro da missão, uma consulta confere o fingerprint do código integrado, os contratos, as entregas e os pareceres atuais. Se o código mudar, o próximo refresh pede nova conferência, conservando o aceite histórico individual. Falha de leitura produz estado desconhecido, sem sinal verde fictício. Dispensa de trabalho não recebe rótulo de revisão independente.

O layout dá prioridade à conversa do líder, com terminal acessível pelo mesmo pane. Foco é o default para instalações sem preferência salva; escolhas anteriores permanecem. O histórico de eventos passou a ser um painel sob demanda, evitando três trilhos disputando espaço com a conversa. Quadro, arquivos e navegador continuam disponíveis, com um painel lateral por vez.

## Mascote refinado

O usuário escolheu **manter a base, simplificar e refinar**. A v2 preserva núcleo grafite, anel verde e dois satélites; simplifica olhos e detalhes e remove as mãos para uma silhueta mais legível. A v1 está preservada. [Asset integrado](../../../apps/desktop/src/assets/orbit-mascot-v2.png) e [direção visual](../../design/orbit-v2/README.md).

O componente tem opção de ocultar/restaurar e movimento desligado por default. A preferência é local e funciona mesmo quando storage não está disponível. Movimento CSS discreto só é aplicado durante trabalho quando habilitado; `prefers-reduced-motion` o desativa. Não há loop JavaScript, som ou chamada de modelo para animá-lo. Existe **uma pose refinada**, acompanhada de estados textuais e visuais, sem afirmar cinco animações de personagem prontas.

O PNG tem transparência confirmada, 1254×1254 e 921.483 bytes. É servido como asset estático local, com espaço de 64/88 px reservado e decodificação assíncrona. Ainda não é uma família de sprites nem um asset otimizado para distribuição web móvel.

## Consulta e limites de desempenho

`mission.progress` usa o WebSocket autenticado existente e responde somente à conexão solicitante, com `requestId`; erros são correlacionados. Não replica esse histórico no snapshot de todas as missões. Testes cobrem resposta, erro, ausência de broadcast, leitura sem mutação/modelo, preservação após fechamento/restart e invalidação da integração.

A UI consulta somente a missão aberta, sem sobrepor requisições, com intervalo de dez segundos após a resposta, pausa em aba oculta e botão de conferência manual. Respostas atrasadas não são aplicadas depois de trocar missão ou desmontar a tela. Erro e desconexão impedem tratar dados antigos como confirmação nova.

Quando há revisão final, a conferência faz fingerprint síncrono do source, sujeito aos limites da R4. Isso tem custo de filesystem e pode bloquear o event loop em árvores grandes; **não foi medido ganho de latência nem otimizado esse caminho para monorepos grandes**. O instante de observação fica visível no painel. Não é um monitor contínuo ou snapshot atômico, e alterações entre consultas não são detectadas instantaneamente. Os limites do fingerprint e dos relatos de revisão descritos na R4 permanecem.

## Diagnóstico do timeout MCP

O [teste anterior à pausa](execution-r6/tests-before-pause.log) falhou esperando `pane.data`. O teste era idêntico ao da R5 e passou isoladamente e em doze repetições. A inspeção encontrou uma suposição inválida: procurar a frase inteira em **um único chunk** do terminal.

A fragmentação forçada na fronteira real de eventos do PTY reproduziu o timeout deterministicamente: o aviso completo estava no texto concatenado, mas não em nenhum bloco de quatro caracteres. [Vermelho com diagnóstico](execution-r6/mcp-fragment-red.log), [verde com fragmentação preservada](execution-r6/mcp-fragment-green.log). Os tokens das fixtures foram redigidos no diagnóstico.

O teste agora acumula o stream por pane para procurar avisos, leitura e tokens de fixture. O transporte de produção não foi alterado e o timeout não foi ampliado. A fragmentação forçada permanece no teste de integração. Como os chunks do timeout original não foram preservados, a reprodução comprova esse defeito do teste, sem provar que foi a única causa possível daquela ocorrência histórica.

## Verificação

| Comando | Resultado | Evidência |
|---|---|---|
| `npm test` | 193/193 sidecar + 6/6 desktop, exit 0 | [tests.log](execution-r6/tests.log) |
| `apps/desktop/build/node/node --test packages/sidecar/test/*.test.ts` | 193/193, Node 24.21.0, exit 0 | [node24-tests.log](execution-r6/node24-tests.log) |
| `npm run typecheck` | Sem erros, exit 0 | [typecheck.log](execution-r6/typecheck.log) |
| `npm run tauri -w @orbit/desktop -- build --debug` | Bundle macOS, exit 0 | [build.log](execution-r6/build.log) |
| `git diff --check` | Sem erros, exit 0 | [diff-check.log](execution-r6/diff-check.log) |

Bundle: `apps/desktop/src-tauri/target/debug/bundle/macos/Orbit.app`, 167,62 MiB. Permanece o aviso de chunk acima de 500 kB; o principal tem 760,34 kB. [validation.json](execution-r6/validation.json) registra hashes das fontes, recursos, testes, logs e artefatos e compara sidecar/Node/skills do bundle com o build.

QA usou o React e o servidor reais, com agentes/processos e resultados **sintéticos** em pasta temporária isolada. Foram verificados: revisão pendente, revisão sintética aceita, histórico após fechar terminal, source alterado invalidando a integração, espera por decisão, ocultar/restaurar mascote, alternar movimento e caminho pelo teclado até o compositor. A política de redução de movimento foi conferida no CSS; não houve alteração da preferência do sistema nem teste em dispositivo físico. O produto tem somente o tema escuro existente.

As capturas finais usam dimensões explícitas e extensão JPEG correta: [1440 px](execution-r6/final-1440.jpg), [1024 px](execution-r6/final-1024.jpg), [768 px](execution-r6/final-768.jpg), [375 px](execution-r6/final-375.jpg) e [compositor em 375 px](execution-r6/final-375-composer.jpg). DOM e medidas confirmaram ausência de overflow horizontal e preservação da área da conversa. Evidências anteriores com prefixo `ui-` são históricas e algumas sofreram recorte/escala da ferramenta; usar as `final-` para avaliar a entrega. Não extrapolar o QA sintético para qualidade dos modelos.

Servidores de QA e aba temporária foram encerrados; viewport restaurado. O servidor antigo do protótipo na porta 8766 não foi alterado.

## Gates ainda pendentes

O cenário autônomo real completo continua necessário: líder planeja e delega, Claude implementa, Codex revisa, recuperação entre entrega e consumo e depois papéis invertidos. A R5 executou um piloto dirigido com coordenador determinístico; não substitui esse gate. O experimento econômico também precisa exercitar tratamento diferente de contexto num líder real antes de sustentar economia de tokens. Não houve ampliação automática das chamadas pagas.

Portanto, **interface/mascote e validação local estão concluídos nesta fatia; R6 completa e candidato para uso diário ainda não estão certificados**.
