# Modelo e conta do líder

## Diagnóstico antes da alteração

Base: origin/main 6a9f12a (release oficial 0.2.19). Worktree isolada fix/orbit-leader-account; root dirty preservado. Inventário MCP sem outro worker de código proprietário; coordenação com panes 122/135.

O formulário iniciava adaptiveLead=true e escondia AgentFields. core.createMission, em modo adaptativo, sobrepunha message.lead com routing.lead (Claude de fábrica) e apagava accountId. normalizeRouting não conservava accountId. Logo, só mudar um rótulo não corrigiria a execução.

No estado instalado, Claude reportou fiveHour=0% e weekly=95%, com renovação semanal cerca de 45 horas depois. ACCOUNT_FULL_PERCENT=85 e uma segunda constante literal no harness tornavam essa conta "esgotada" apesar de ainda ter 5%. A leitura é identificada por accountId+CLI; não houve evidência de mistura entre contas. Testes em leaderAccount.test.ts falharam antes das alterações (quota e persistência), registrados em before.log.

## Implementação

O padrão persistido contém CLI, modelo, esforço e accountId opcional; nulo mantém seleção automática dentro da CLI. Store valida a existência e o vínculo da conta. Formulário inicia com o padrão salvo, mantém campos visíveis e conserva a escolha ao trocar modo. Escolher campos desliga adaptação; habilitá-la explicitamente permite adaptar apenas modelo/esforço, preservando CLI e conta. Backend usa a escolha enviada, sem reinjetar Claude da tabela. Trocar um líder já existente continua sendo operação explícita da missão; configurar o padrão não mata processos existentes.

A lista de modelos vem do catálogo da CLI (Codex: debug models), com esforço compatível e opção de ID manual; conta API conserva seu próprio modelo padrão na resolução existente. Consulta real separada aos homes das duas contas Codex produziu os mesmos sete IDs/níveis, sem criar turnos (account-models.json). Isso comprova a lista apresentada, não promete acesso a todo modelo em toda assinatura. O provedor continua explícito para filtrar combinações de conta e modelo.

Esgotamento agora significa 100%, em ambos os caminhos de elegibilidade. Quota ausente, expirada, inválida ou antiga não aparece como 0% no seletor. Contas são comparadas por ID e CLI. Saturação confirmada continua bloqueando e mostrando a janela de recuperação; leitura falha não declara recuperação. Fixtures de saturação foram corrigidas para 100%.

## UI e intenção

Pessoa prestes a iniciar uma missão: escolher quem lidera sem perder modelo/conta; sensação de bancada previsível. Foco: modelo+conta, sempre expostos. Domínio: líder, ajudantes, missão, assento, login, janela, renovação. Paleta física existente: carvão do console, grafite dos controles, branco do texto, verde do sinal ativo, âmbar de aviso. Assinatura existente: assento da missão vinculado a uma conta com quota própria. Rejeitados: novas cartas decorativas (controles nativos existentes), warning oculto (corrigir limiar), CLI fixa (escolha persistida). Mantidos Geist, tokens de superfície/borda, densidade de 16px, foco nativo e alvos de 44px. Sem novo tema ou animação. No formulário de líder, seletor compacto evita que cartas de provedores empurrem modelo e conta para longe.

## Verificação

- npm run typecheck: exit 0.
- npm test: 308/308 sidecar e 35/35 desktop, exit 0.
- node --test scripts/*.test.mjs: ver script-tests.log.
- Integração WebSocket: persistência após reload, configuração global conflitante, liderança Codex com conta não automática, diretório CODEX_HOME efetivo da segunda conta, modelo/esforço explícitos e adaptação preservando CLI/conta.
- Playwright nos componentes reais com estado sintético isolado: default salvo, modelo e conta ao mudar modo, alteração manual desliga adaptação, quota desconhecida e 375/768/1024/1440. DOM em ui-results.json antes das imagens. Campos cabem; tabela/nav existentes têm rolagem interna. Tema escuro existente; nenhuma alteração de cores/motion.
- Tradutor GPT-6 Luna/low e executor independente não alterados.

Release e instalação efetiva serão registradas na devolutiva após merge/checks.
