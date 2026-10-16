# Instruções para agentes — Orbit

## Conferir e manter atualizado o app instalado (obrigatório)

Pedido literal do usuário: 'sempre que usarmos o orbit deve atualizar o aplicativo que ja existe no MAC'.

- Nas sessões de trabalho deste projeto, **conferir e manter atualizado o aplicativo existente em `/Applications/Orbit.app`**. Se estiver desatualizado em relação ao build atual, atualizar essa mesma instalação, sem pedir ao usuário que faça isso. Se já estiver idêntico ao build atual, a verificação basta, sem rebuild desnecessário.
- Toda alteração com impacto no app (código, sidecar, hooks, UI, configuração empacotada) exige **build** e **atualização automática dessa mesma instalação**. Mudanças apenas de instruções ou documentação, sem impacto no app, não exigem rebuild nem reinstalação.
- Não criar cópias paralelas nem substituir a atualização do app instalado por apenas um dev server.
- A atualização deve **preservar dados e credenciais** do usuário (configurações, sessões, tokens, login). Nunca apagar nem recriar o diretório de dados do app.
- A entrega exige **verificar a instalação efetiva**: versão/hash/data do build em `/Applications/Orbit.app` deve corresponder ao build atual (e o app deve abrir/rodar esse código).
- **Não considerar a entrega concluída enquanto o app instalado estiver antigo.**
- Se o build ou a instalação falhar, ou houver impedimento concreto (app em uso, permissão, assinatura, etc.), **relatar explicitamente** o que falhou e o estado real; nunca fingir que atualizou.
- Atualização **local** não é **publicação**: build + instalação local não implicam `git push`, release no GitHub (`npm run release -- … --publish`) nem commit. Esses passos só com pedido explícito do usuário.
- Esta regra orienta as sessões de trabalho do projeto; não implica criar automação de atualização em cada lançamento do produto.
- Se outro agente já estiver construindo/instalando a mesma atualização, não duplicar nem interferir nos processos dele; aguarde o resultado e verifique o artefato instalado.

## Branches, agentes paralelos e publicação oficial

- Nesta atividade, usar exclusivamente a conta **Codex 2 (`codex-acc-2`)**. Não iniciar outro provedor nem trocar de conta silenciosamente. Credenciais nunca entram no Git.
- Para qualquer ajuste, inclusive feito por Claude ou Codex, criar uma branch nova a partir de `origin/main` atualizada: `feature/orbit-resumo_do_ajuste` ou `fix/orbit-resumo_do_ajuste`. Não editar nem fazer commit diretamente na `main`.
- Uma worktree por agente. Antes de editar, consultar `npm run agent:status` e reservar arquivos com `npm run agent:begin -- feature/orbit-resumo_do_ajuste caminho/arquivo caminho/pasta`. O comando faz fetch, verifica mudanças existentes, reserva arquivos no diretório Git compartilhado e cria a worktree. Entre na worktree indicada e rode `npm ci`.
- Arquivos/pastas reservados por outro agente não podem ser editados. Mudança de escopo exige coordenar a reserva antes da edição. O registro é compartilhado pelas worktrees do mesmo clone; em clones/máquinas diferentes, coordene pelo PR antes de tocar arquivos comuns.
- Executar `npm run agent:setup` uma vez por clone para habilitar os hooks versionados: bloqueiam commits fora do padrão e push direto na `main`. Não usar `--no-verify` para contornar o fluxo.
- Fazer commits com paths específicos; nunca incluir trabalho de outro agente. Antes do merge, atualizar com `origin/main`, resolver conflitos conscientemente e repetir validação.
- `npm run agent:finish` exige worktree limpa, faz rebase em `origin/main`, testes/typecheck, push, PR, aguarda checks e faz squash merge do commit validado. Pare se houver conflito/falha; não use force-push automático. Depois confira **Official release** no GitHub Actions.
- O usuário autorizou este fluxo de branch → push → merge na `main` → publicação oficial automática. A Action `Official release` executa checks, incrementa a versão a partir da maior versão/tag, compila e publica arquivo assinado e `latest.json`. Só anuncia a release quando os arquivos já foram enviados. Uma falha não equivale a publicação.
- A chave `TAURI_SIGNING_PRIVATE_KEY` nos secrets do GitHub deve ser a mesma das instalações existentes. Nunca gerar/substituir a chave para destravar o CI. O token padrão do GitHub publica a release; não adicionar tokens pessoais no código.
- A versão é incorporada aos artefatos durante o build; `source.json` registra o commit exato. O bump do CI não cria commit recursivo na `main`. O código-fonte pode manter uma versão-base menor que a última release.
- O app busca novas versões automaticamente e pelo botão de atualização já existente. O repositório é privado: download e busca requerem acesso ao repositório via `gh auth login`. Manter a instalação local conforme as regras acima; não apagar dados nem credenciais.
