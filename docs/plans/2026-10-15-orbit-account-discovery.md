# Adicionar contas e instalação independente

**Objetivo:** tornar visível a criação de contas adicionais de Claude/Codex e concluir a instalação de um bundle independente do repositório.
**Causa confirmada:** o usuário informou que não encontra como adicionar outra conta. A tela observada contém apenas as contas deste Mac; a criação está escondida no botão genérico “Nova conta”, distante das seções. A consulta nativa de status em perfis novos isolados retornou deslogado para ambas as CLIs; não foi comprovado defeito de isolamento de autenticação.
**Stack:** React, CSS existente e Tauri release.

## Arquivos
- `apps/desktop/src/components/AccountsPanel.tsx`: botão por provedor, formulário pré-selecionado e orientação de cadastro/login.
- `apps/desktop/src/styles.css`: cabeçalho flexível das seções, mantendo tokens existentes e alvo acessível.
- `docs/plans/2026-10-15-orbit-install-evidence/`: evidências de instalação, backup e teste do app empacotado.

## Etapas
1. Reproduzir a dificuldade na tela atual e registrar o diagnóstico do usuário; manter a autenticação nativa e o backend existentes.
2. Expor “Adicionar conta Claude/Codex/Gemini” por seção, bloquear troca de formulário durante edição e orientar que “Entrar” conclui o login da nova conta. Criar com provedor escolhido, editar com o comportamento existente.
3. Conferir na UI: provedor pré-selecionado, cancelar preserva contas, criar conta sintética gera outro cartão sem substituir a existente. Não concluir OAuth, ler tokens ou enviar tarefas a modelos durante QA.
4. Rodar typecheck e testes apropriados, construir release após encerrar processos que usam os arquivos de build. Verificar que o app usa Node e sidecar empacotados.
5. Atualizar com backup, verificar assinatura e conteúdo, abrir para QA com dados isolados e encerrar esse perfil. Preservar os logins que o usuário realizou na janela temporária anterior e os dados normais de `~/.orbit`.

O bundle debug já copiado revelou dependência do repositório por `cfg!(debug_assertions)` em `sidecar.rs`; o pacote final instalado deve ser release. Não alterar preferências de retomada nem iniciar as duas sessões pessoais salvas durante a checagem.
