# Orbit instalado — 15/10/2026

**O aplicativo em `/Applications/Orbit.app` foi atualizado com o pacote release local 0.2.14**, incluindo as melhorias do harness, sugestões por Tab e os botões para adicionar contas por provedor. A versão numérica é a mesma do app anterior; os arquivos e o binário foram substituídos e conferidos por hash. [Recibo final](2026-10-15-orbit-install-evidence/installation.json).

## Contas adicionais

O usuário confirmou que não encontrava como adicionar outra conta. A tela agora mostra **Adicionar conta Claude**, **Adicionar conta Codex** e **Adicionar conta Gemini** diretamente em cada seção. O formulário já vem com o provedor escolhido; após cadastrar, o botão **Entrar** no cartão da nova conta inicia a autenticação nativa. O cadastro não substitui as contas anteriores.

O QA criou uma segunda conta sintética de Claude e Codex, preservou as contas iniciais, conferiu cancelamento e abertura dos terminais de login simulados. Os botões têm 44 px de altura e não houve overflow horizontal em 375, 768, 1024 e 1440 px. Console sem erros. [Evidência de interface](2026-10-15-orbit-install-evidence/accounts-ui.txt) · [Responsivo](2026-10-15-orbit-install-evidence/accounts-responsive.json).

Isso corrige a descoberta da ação na interface. Não foi realizado login OAuth de uma segunda conta pessoal pelo agente. Consultas nativas em novos perfis vazios retornaram deslogado nas duas CLIs; nenhum defeito de isolamento de credenciais foi comprovado nesta rodada. O backend de autenticação não foi alterado.

## Pacote e validação

A primeira cópia instalada era um build debug. A checagem detectou que `cfg!(debug_assertions)` em `sidecar.rs` faz esse pacote usar o repositório e o Node do sistema. O app final foi substituído pelo **release otimizado**, de **135,57 MiB**, com Node e sidecar incluídos no bundle.

- `npm run typecheck`: exit 0.
- Testes desktop no Node 24: **19/19**, zero falhas.
- Build release: exit 0 — [log](2026-10-15-orbit-install-evidence/release-build.log).
- Assinatura local ad hoc aplicada à cópia de instalação; `codesign --verify --deep --strict` aprovou o bundle instalado. Não é uma publicação notarizada.
- Todos os arquivos instalados conferidos contra a cópia assinada de preparação; fonte e binário antes da assinatura registrados em [validação](2026-10-15-orbit-install-evidence/release-validation.json).
- Abertura real do app instalado em perfil isolado mostrou **Motor ativo**; os botões de contas foram observados na janela nativa. Encerramento normal, exit 0. [Captura do app instalado](2026-10-15-orbit-install-evidence/installed-accounts.png).

## Preservação

O app original e os dados normais foram preservados em `/Applications/.Orbit-backups/2026-10-15-cd5b502f`. A cópia intermediária de debug foi preservada em `/Applications/.Orbit-backups/2026-10-15-8ab376fb`. O estado pessoal de `~/.orbit` manteve o mesmo hash após as checagens. Não foram iniciadas as duas sessões pessoais com retomada automática.

Durante a primeira checagem, o usuário realizou logins no perfil temporário `/private/tmp/orbit-installed-smoke-l7FgvV`. O supervisor desse teste foi interrompido para evitar fechar a janela durante o uso. A revisão automática recusou duplicar os perfis com credenciais sem autorização específica; a cópia só ocorreu depois de autorização explícita do usuário. Os perfis foram preservados, sem remover os originais, em `/Applications/.Orbit-backups/2026-10-15-cd5b502f/login-check-profile`, com conteúdo conferido e pasta privada.

O perfil temporário final e os servidores de QA foram encerrados. O app fica instalado no caminho habitual; ao abrir normalmente, usa seus dados e preferências originais, inclusive a retomada automática configurada. Nenhum commit, push, release público ou mudança de senha foi realizado.
