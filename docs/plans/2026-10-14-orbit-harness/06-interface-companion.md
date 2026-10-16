# R6 — interface de atividades e companheiro Orbit

**Goal:** tornar trabalho, entrega, revisão e bloqueio legíveis na missão e refinar o mascote sem criar gasto de modelos em runtime.
**Architecture:** leitura autenticada do ledger existente, com resposta por solicitação; projeção determinística de estado na UI; componentes React usando o sistema visual atual. O motor continua sendo a autoridade de aceite. A arte pode mudar sem alterar os contratos de estado.
**Stack:** React, TypeScript, CSS e WebSocket existentes; geração embutida de imagem somente para produzir o asset nesta etapa.

## Restrições

- Preservar mudanças locais; sem commit, instalação ou release.
- Não usar `readyAt` isoladamente como certificação atual. Conferir source e contratos na consulta de progresso; apresentar instante da observação e cobertura.
- Entrega persistida, recebimento no PTY, confirmação do agente e revisão são fatos distintos.
- Sem modelo durante idle, consultas, labels ou animações; consultas apenas na missão visível e sem requisições sobrepostas.
- Mascote ocultável, movimento opcional, `prefers-reduced-motion`, nome textual e sem som automático.
- A arte atual é v1; salvar ajuste em versão nova, sem apagar o original. Pergunta de direção enviada ao usuário; preservar identidade orbital como default reversível se não houver resposta.
- Escopo de modelos reais já realizado na R5 não será ampliado nesta fatia visual. Cenário autônomo bidirecional e gate econômico permanecem explicitamente separados da validação local da interface.

## Mapa de arquivos

Complementos da integração final: `App.tsx` move o histórico para um painel sob demanda e define foco como default; `HomeView.tsx` distingue declaração de conclusão de revisão atual; `progressClient.test.ts` cobre correlação de respostas. `mcp.test.ts` teve a suposição de chunk único corrigida após reprodução determinística com fragmentação de PTY. O novo contrato também foi validado através do WebSocket real em `missionProgress.test.ts`.

| Arquivo | Responsabilidade |
|---|---|
| `packages/protocol/src/index.ts` | Consulta/resposta de progresso com ID e erro correlacionado |
| `packages/sidecar/src/core.ts` | Projetar ledger, recibos e validade atual da integração, sem mutação/modelo |
| `packages/sidecar/test/missionProgress.test.ts` | Histórico após fechamento/restart, revisão atual/obsoleta e ausência de chamadas a modelo |
| `apps/desktop/src/orbit/client.ts` | Correlacionar resposta/erro sem erro alheio resolver consulta |
| `apps/desktop/src/orbit/useMissionProgress.ts` | Consulta serial na missão visível, desconexão/erro/refresh e cleanup |
| `apps/desktop/src/orbit/missionStatus.ts` | Derivação pura de próximo passo e estado do companheiro |
| `apps/desktop/src/orbit/missionStatus.test.ts` | Precedência de bloqueios, revisão, dispensa e integração obsoleta |
| `apps/desktop/src/components/MissionProgress.tsx` | Atividades, motivos de modelo, critérios, revisões e recibos em detalhes nativos |
| `apps/desktop/src/components/OrbitCompanion.tsx` | Arte, estado textual e preferências locais acessíveis |
| `apps/desktop/src/components/MissionView.tsx` | Integrar status e trilho com conversa/terminal existentes |
| `apps/desktop/src/components/PaneView.tsx` | Conversa inicial do líder não-shell; terminal acessível |
| `apps/desktop/src/styles.css` | Layout responsivo, tokens e motion do conjunto |
| `apps/desktop/src/assets/orbit-mascot-v2.png` | Arte refinada original com transparência |
| `docs/design/orbit-v2/README.md` | Direção e proveniência da arte refinada |
| `docs/plans/2026-10-14-orbit-harness/implementation-r6.md` | Resultados, evidências e gates ainda pendentes |

## Execução inline

1. Acrescentar teste que exige progresso sem inferir sucesso de processo encerrado; entregar fixture e exigir revisão pendente; aceitar e exigir integração atual; alterar arquivo e exigir integração obsoleta sem modificar o parecer histórico. Executar vermelho antes da implementação.
2. Implementar consulta com `requestId` e erro correspondente. Não espalhar esse payload no snapshot de todas as missões nem devolver tokens de autenticação. Reusar `verificationStatus`, `integrationState`, history e delivery notices.
3. Implementar projeção de status com precedência: desconexão/ausência de observação → permissão → orçamento/bloqueio → revisão/invalidação → trabalho → pronto observado. Dispensa não recebe rótulo de verificação independente. Testar os estados de domínio, não detalhes de CSS.
4. Integrar componentes e consultas seriais, com pausa em aba oculta; limpar dados ao trocar missão; mostrar erro e tentativa manual. Layout conversa dominante e histórico secundário, detalhes expandíveis sem inventar progresso percentual.
5. Refinar asset com a ferramenta de imagem, preservar v1, inspecionar resultado, integrar versão nova. Preferências locais para ocultar/movimento e fallback para storage indisponível.
6. Verificar types, testes pertinentes, build e UI em 375/768/1024/1440 com estados sintéticos explicitamente identificados. Depois rodar suíte completa e registrar limites; não declarar cenário autônomo real executado por ter testado UI sintética.

## Decisões visuais

Intenção: desenvolvedor acompanha e decide o próximo passo numa bancada calma e densa. Foco: o próximo passo da missão e a conversa do líder; o mascote é sinal secundário. Paleta: grafite/preto/alumínio/verde/âmbar já definidos no projeto, com semântica de sinal. Profundidade: superfícies existentes e bordas discretas. Tipografia: Geist e Geist Mono, hierarquia por peso e contraste. Espaçamento: unidade de 4 px, controles de 44 px onde adicionados e zonas de 12–16 px. Assinatura orbital presente no companheiro, estado, encadeamento de atividades, dependências e recibos; sem grid decorativo de métricas ou recompensa por tokens.
