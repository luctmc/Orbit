# Orbit — direção visual e mascote v1

> Atualização de 15/10/2026: [R6 visual implementada](../../plans/2026-10-14-orbit-harness/implementation-r6.md). A v1 abaixo permanece como exploração histórica. O usuário escolheu “Manter a base, simplificar e refinar”; a [v2 integrada](../../../apps/desktop/src/assets/orbit-mascot-v2.png) conserva núcleo/anel/satélites, simplifica olhos e detalhes e remove mãos. Arte original editada com `image_gen` a partir desta v1, com transparência, sem substituir o arquivo original. Uso atual: uma pose a 64/88 px, estado textual do motor, ocultação e movimento opcional desligado por default. Nenhum modelo é chamado em runtime para o personagem.

14/10/2026. Exploração de produto para o roteiro de harness. [Protótipo interativo](prototype.html), com dados simulados; [mascote original](orbit-mascot-v1.png). Nenhuma alteração foi aplicada à interface de produção.

## Intenção e foco

Usuário: desenvolvedor que quer pedir, acompanhar, corrigir e aceitar trabalho dentro do mesmo ambiente. A tela deve parecer uma bancada de engenharia: densa nas ferramentas e calma na conversa. O elemento principal é o trabalho atual e seu próximo passo, não um painel de números.

Referência do Overclock: densidade de panes, hierarquia piloto/ajudantes, contexto por missão e saúde das contas, observados nas etapas anteriores. A direção preserva a paleta do Orbit; não afirma extrair valores exatos da UI do Overclock nem copia seus assets.

## Território do produto

- Conceitos: órbita, núcleo, trajetória, acoplamento, sincronização, sinal e ponto de controle.
- Cores físicas de referência: grafite de instrumentos, preto de uma bancada desligada, alumínio claro, verde de sinal e âmbar de atenção.
- Assinatura: o núcleo coordena atividades em torno de um objetivo. Ela aparece no símbolo orbital, no mascote, no mapa de atividades, no encadeamento de dependências e nos estados de entrega.
- Escolhas evitadas: grid de cards igualmente importantes → conversa dominante e trilho secundário; mascote que recompensa tokens → companheiro que explica estado; terminal como única leitura → conversa com evidências e terminal acessível.

## Sistema visual

Tokens já presentes em `apps/desktop/src/styles.css:1–25`:

| Papel | Valor | Uso |
|---|---|---|
| Canvas | `#0d0d0d` | Área principal |
| Fundo profundo | `#0a0a0a` | Barra/entrada de contexto |
| Superfícies | `#121212`, `#161616`, `#1b1b1b` | Hierarquia discreta por luminosidade |
| Acento | `#c5e04b` | Ação principal, foco e estado ativo |
| Texto | `#e6e6e6`, `#b8b8b8` | Leitura principal/secundária |
| Atenção | `#ff9f43` no app | Pedido de decisão; protótipo usa tom mais claro `#ffb36b` |

Tipografia de produção: Geist/Geist Mono existentes. O HTML autônomo usa fallback do sistema se essas fontes não estiverem disponíveis. Espaçamento: base de 4 px, zonas densas de 12–16 px e conversa com mais respiro. Profundidade: variação de superfície e borda discreta; sem efeitos de vidro ou animações constantes.

Hierarquia: título da tarefa → próximo passo/bloqueio → conversa → decisão do maestro → evidência detalhada → métricas. Motivo da escolha aparece de forma legível; detalhes de protocolo permanecem na inspeção técnica.

## Mascote Orbit

Conceito v1: núcleo grafite com rosto discreto, anel verde-lima e dois satélites; forma comunica coordenação. A imagem é original, gerada pela ferramenta embutida `image_gen`, com transparência. Fonte preservada em `orbit-mascot-v1.png`; não substitui o ícone vetorial atual.

Estados a produzir na fase R6: pronto, trabalhando, esperando você, bloqueado e entregue. Nesta etapa existe uma pose; o protótipo muda o rótulo de estado, não inventa cinco animações prontas.

O companheiro deriva seu estado do motor e tem rótulo textual. Deve ser ocultável, funcionar sem movimento, respeitar `prefers-reduced-motion` e não capturar foco ou bloquear a conversa. Não terá XP por consumo, chamadas de modelo, som automático nem canvas em loop contínuo. Conquistas, se houver, devem refletir entregas verificadas e qualidade, nunca gasto de tokens.

O bitmap é fonte de conceito, não formato final otimizado: gerar variantes pequenas e otimização preservando alpha na implementação. Uma silhueta vetorial simples pode servir a 24–32 px; não reduzir o render complexo a favicon.

## Protótipo e limites

`prototype.html` é independente, sem bibliotecas remotas, chamadas de API, modelos ou escrita em arquivos. Permite alternar execução/revisão/espera/aceite, alternar conversa/terminal estático, abrir evidência, ocultar mascote e testar envio local de texto. Anexos são explicados como parte do produto, sem abrir arquivos no protótipo.

Os dados, nomes de arquivo, decisões e estados são fictícios. “Aceita” na demonstração não certifica execução real. Tokens/custos permanecem sem medição, evitando apresentar economia inventada.

## Prompt usado para o mascote

Use case: stylized-concept. Asset type: original desktop developer-tool mascot, concept v1 for Orbit ADE. Create ONE original friendly intelligent orbital creature, isolated with genuine transparent background and full body visible, premium restrained 3D illustration, highly readable small silhouette. Subject: a compact hovering graphite rounded core, softly squared spherical body, two expressive small warm off-white eyes in a recessed dark face, a single tilted lime-green orbital ring wrapping around the core, two tiny satellite nodes on the ring suggesting coordinated agents, two very small relaxed floating hands. Calm capable curious expression, slight three-quarter angle, no clothing and no tools. Refined matte graphite ceramic with subtle soft highlights, lime accents precisely #c5e04b, charcoal #161616, off-white #e6e6e6, black-lime inner glow used sparingly. Large clean shapes, minimal detail, no distracting particles, no neon bloom or thick outlines. Friendly enough to be a mascot, serious enough for a professional development workbench. Character fills about 75 percent of square composition, centered with generous margin for UI integration. Must remain distinct from any existing product character; no astronaut helmet, no common chat-bot speech bubble, no logos, no text, no watermark, no shadows drawn onto a background. This is one clear concept, not a character sheet or app screenshot.

## QA desta proposta

Verificação de estrutura e overflow no navegador nas larguras 375, 768, 1024 e 1440. Estados e ações são testados somente no protótipo. A integração React/Tauri, captura de voz, drop/paste e estados reais de autorização seguem fora desta exploração visual. A fase R6 precisa repetir teclado, contraste, light/dark se houver, motion e responsividade no aplicativo final.
