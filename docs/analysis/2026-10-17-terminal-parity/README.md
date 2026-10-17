# Terminal do Orbit — revisão de densidade

Intenção: pessoa acompanhando execuções, localizar o agente e responder; bancada técnica com saída do terminal dominante. Hierarquia: uma barra de 48px, saída ocupando o restante, entrada compacta. Paleta: grafite do instrumento, preto do terminal, alumínio do texto, lima do foco e âmbar de decisão; tokens existentes preservados. Profundidade: superfície e borda discreta; menus acima do canvas. Tipografia: Geist 12–14 para controles e Geist Mono 11–13 para modelo/saída. Espaçamento: base de 4px, zonas de 8/12px para liberar área ao terminal.

Domínio: missão, líder, ajudante, sessão, entrega, contexto, espera. Assinatura: papel e número da sessão na barra do terminal. Trocas: múltiplas faixas de identidade → uma barra; rodapé e status repetidos → detalhes no menu; configuração de tradução sempre aberta → opções sob Idioma; painel de próximo passo → expansão nativa.

## Baseline

Worktree isolada a partir de origin/main e tag v0.2.21, commit 1da15e6578716508fd041a7ebe55aebd59ad1db2. O source.json da release oficial v0.2.21 aponta para esse commit. SHA256 do executável oficial baixado e de /Applications/Orbit.app antes da mudança: 990fe8f4a24bf062e66dc22e9f57995d0af7267084005cdada9439768a3f1f4f. As versões-base 0.2.15 da main são intencionais: o workflow incorpora a versão na release sem commit de bump. Não foi usado o checkout original com mudanças pendentes.

npm run agent:status retornou lista vazia. agent:begin recusou a sobreposição com alterações preexistentes no checkout original. A instrução explícita do usuário autoriza esta worktree isolada preservando aquele checkout; branch renomeada para fix/orbit-terminal-parity e hooks ativados. Nenhum arquivo alheio foi incorporado.

## Referência

A imagem fornecida é do Orbit v0.2.21 e mostra duplicação de status/cabeçalho/identidade/espera/rodapé, pouca área do terminal e compositor grande. Não é uma captura do Overclock.

Não há app_observe, app_diag, app_screenshot nem ToolSearch no inventário deste pane. Não foi usado screen/cua no Overclock. Consultados os diretórios locais autorizados Documents/GitHub, Documents/Projetos, Desktop, ~/Overclock e arquivos de referência do projeto: não foi localizado um checkout atual do frontend do Overclock. ~/Overclock contém somente dados de projeto. O bundle instalado contém binário e sidecar, não fonte de componentes frontend acessível nesses locais. Não foram extraídas medidas atuais de frontend a partir de binário. Referências locais de 14–16/10 são históricas e não comprovam identidade visual atual. Nenhuma alegação de equivalência pixel a pixel.

## Catálogo

Falha reproduzida no MCP autenticado com limit=100: validação rejeitava o pedido antes do catálogo. Não há chamada interna fixa acima de 50; limite vinha do chamador. O contrato agora documenta paginação, aceita inteiro positivo e limita cada página a 50 no core, retornando limit/maxLimit e nextCursor. Zero/fração continuam inválidos. skill-before.log registra a regressão vermelha; skill-after.log registra a aprovação.

## Verificação

Fixture de UI sintética: Vite + WebSocket isolados, sem perfil/credenciais ou chamadas de provedores. Medidas, DOM e capturas Chromium/WebKit ficam nesta pasta. Não confundir o teste de layout com inferência real. Os terminais xterm reais da UI permanecem montados nas mudanças de largura/layout/conversa. O teste confere envio/ACK sintético e um único attach por sessão.

skills: inline [oc-showcase].

## Retomada e auditoria independente (pane-168)

A worktree com a implementação e os artefatos acima já existia ao iniciar esta retomada. Pane-166 confirmou que não era proprietário e não faria commit/push; nenhum processo de build estava ativo. Foi assumida exclusivamente a entrega deste diff visual e de skill_catalog, sem incorporar alterações do checkout original. A instalação 0.2.22 não foi refeita: nova verificação codesign --verify --deep --strict --all-architectures passou; SHA256 do executável instalado e build coincidiram em 141df97a18a08380abb86b75fef6acc9622fff7de9d2ac8cb9494115cd2e604d.

Reexecutados typecheck, testes e prévia isolada Chromium/WebKit: 55 verificações de UI por engine sem erros, cobrindo 375–1920px, foco após envio e menu, resize, identidade e attach único por terminal. A captura focus-webkit.png foi revisada: uma barra por pane, terminal dominante e compositor de 119px em 1440×900. A referência Overclock atual continua indisponível; esta entrega comprova redução objetiva de clutter, não fidelidade exata.
