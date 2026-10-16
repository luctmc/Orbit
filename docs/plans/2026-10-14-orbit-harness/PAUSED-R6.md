# R6 — checkpoint da pausa solicitada em 15/10/2026

> **Registro histórico.** Retomada autorizada por “pode seguir”; timeout do teste foi reproduzido com fragmentação de stream e tratado, e a fatia visual/local foi validada. Estado atual e gates pendentes: [implementation-r6.md](implementation-r6.md).

Pausa solicitada pelo usuário: “pausa ja vamos retomar”. **Não continuar implementação nem disparar modelos até autorização de retomada.** Nenhum commit, instalação ou release foi feito. Todas as alterações anteriores permanecem no checkout.

## Implementado, ainda sem validação final completa

- Plano: [06-interface-companion.md](06-interface-companion.md).
- Usuário escolheu para o mascote: **“Manter a base, simplificar e refinar”**. Nova arte gerada com imagegen, preservando núcleo grafite/anel verde/satélites e simplificando olhos, detalhes e mãos. Asset integrado: `apps/desktop/src/assets/orbit-mascot-v2.png`, 1254×1254, alpha confirmado, aproximadamente 900 KiB. V1 preservada em docs/design/orbit-v2. Ainda cabe revisão visual do usuário; não produzir mais variantes sem necessidade.
- `OrbitCompanion.tsx`: ocultar/restaurar, movimento opcional desligado por default, preferência local guardada, CSS respeita reduced motion. Uma pose refinada, sem cinco animações próprias; animação CSS discreta apenas no estado working quando habilitada.
- `MissionProgress` no protocolo + `core.missionProgress`: consulta somente leitura do histórico durável, pareceres, recibos de entrega sem texto duplicado e validade atual da integração por fingerprint/contratos. Resposta/erro com requestId, sem broadcast global. Nenhum modelo na consulta.
- `useMissionProgress.ts`: serializa consultas da missão visível a cada 10 s, pausa com aba oculta, descarte de respostas após unmount/troca de missão, erro e refresh manual. Consulta com revisão final existente faz fingerprint síncrono; avaliar custo em repositórios grandes antes de prometer desempenho.
- `missionStatus.ts`: sinal determinístico de conexão, espera, orçamento, bloqueio, revisão, execução e conclusão observada. `readyAt` isolado não produz certificação.
- `MissionProgress.tsx`: trilho de atividades, tentativas, critérios, motivo da escolha de modelo, evidência e recibo de transporte separado do aceite. Pareceres continuam relatos dos agentes; não são execução comprovada pelo MCP.
- `MissionView.tsx`: integra sinal/mascote e painel, com um painel lateral por vez. Histórico de eventos passou do painel permanente em App para opção “Histórico” dentro da missão. App usa foco como default para instalações sem preferência; preferência existente é preservada. Líder não-shell abre com conversa, terminal permanece acessível.
- HomeView: selo derivado apenas de readyAt agora diz “Conclusão declarada”, com instrução para conferir a missão.
- CSS responsivo: painel e panes empilhados até 1000 px; missão rola sem espremer conversa; root sem overflow nessa largura. Novos controles com altura mínima de 44 px e foco nativo visível. Tema permanece somente escuro, conforme sistema existente.

## Evidências e pendências de validação

- Regressões novas do backend: vermelho inicial em `/private/tmp/orbit-r6-progress-red.log`, depois 2/2 verdes em `/private/tmp/orbit-r6-progress-green.log`.
- Desktop: 6/6 testes passaram, incluindo precedência de estados e correlação de respostas/erros. Typecheck final desta fatia terminou com exit 0: `execution-r6/typecheck.log`.
- `npm test` **terminou com exit 1**, com uma falha: `packages/sidecar/test/mcp.test.ts:76`, `timeout waiting for pane.data` no teste “lead and helper coordinate through MCP, handoffs and hooks”. Log completo: `execution-r6/tests.log`. Os novos testes de progresso passaram nessa suíte. **Não foi diagnosticada nem corrigida antes da pausa.** Usar oc-blackbox ao retomar; reproduzir e localizar causa antes de qualquer reparo. Não presumir flake nem apenas ampliar timeout.
- Vite build intermediário passou, log `/private/tmp/orbit-r6-vite.log`, antes das últimas alterações de App/HomeView/CSS. **Não há build final Tauri R6 nem suíte Node 24 final desta fatia.** O bundle debug existente é R5.
- `git diff --check` passou ao pausar. Índice de hashes R6 e relatório implementation-r6.md ainda não foram escritos.
- QA pelo navegador sobre servidor e agentes **sintéticos**: revisão pendente, aceite sintético, fechar terminal mantendo atividade, alteração de source invalidando sinal final, espera por decisão e ocultar/restaurar mascote por teclado. Nenhum Claude/Codex real foi invocado nesta fatia. Fonte do fixture: `/private/tmp/orbit-r6-preview.mjs`.
- Evidências em `execution-r6/`: capturas e DOMs, `stale-dom.txt`, `waiting-dom.txt`, `responsive*.json`. DOM/medidas observaram larguras 375/768/1024/1440 sem overflow horizontal e conversa com altura preservada. **As capturas têm bytes JPEG com extensão .png**; corrigir nomes/referências. O screenshot API teve inconsistências ao alternar override de viewport: algumas capturas ficaram escaladas/recortadas; `getScreenshot` funcionou bem em 375, mas algumas imagens posteriores ainda estão cortadas. Revalidar evidência final sem declarar todos os pixels aprovados. O viewport foi restaurado antes da pausa.
- A API de clique do navegador teve alvos inconsistentes após HMR/viewport. Interação por `playwright.locator(...).press('Enter')` funcionou com snapshot DOM atual; não repetir cliques cegos.

## Serviços encerrados

Servidor fixture na porta 4326 foi encerrado por `quit` na sessão 91891, exit 0. Vite de QA na porta 5274 (PID 25092, comando verificado contendo vite e --port 5274) recebeu SIGTERM. Um primeiro fixture (PID 25108) já havia sido encerrado após conferir comando exato. Nenhum processo de usuário alheio ao QA foi sinalizado. O servidor antigo do protótipo na porta 8766 não foi alterado.

## Ao retomar

1. Ler este checkpoint e preservar o checkout. Diagnosticar falha do teste MCP, sem chamar modelos.
2. Rever código de UI/endpoint e o custo do polling com fingerprint; acrescentar verificação WebSocket real do novo contrato se necessário. Revisar React best practices já lida, sem migrar bibliotecas.
3. Revalidar screenshots responsivos com nomes corretos; testar acesso a compositor/evidências ao rolar, reduced motion e preferências. Finalizar direção/proveniência da arte em docs/design/orbit-v2/README.md.
4. Rodar types, suíte completa, Node 24 empacotado e build Tauri debug final. Gerar relatório R6 e índice de hashes; atualizar README e PAUSED.
5. **Não declarar R6 completa:** ainda faltam o cenário autônomo real bidirecional Claude/Codex e interrupção entre entrega e consumo, além do gate econômico R5 com tratamento efetivamente exercitado. Não ampliar chamadas pagas automaticamente; a fatia atual foi visual/local. Confirmar escopo concreto de um próximo piloto quando necessário.
