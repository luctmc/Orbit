# Modal Nova missão e exclusão de workspace — evidências

Base: `origin/main` 0eac159, Orbit instalado 0.2.20.
Execução: codex-acc-2 / gpt-6.1-sol / medium.

## Causas reproduzidas

1. `dialogs.tsx`: `pending` desabilitava o fieldset inteiro. Na instalação nativa, AX retornou `enabled=0` em dropdowns, texto, checkbox e modos. Clique físico no dropdown do líder não abriu opções. Journal real: `submitting`, erro de admissão Claude por quota, sem `missionId`. O pedido real não foi repetido nem modificado.
2. `WorkspaceDialog.tsx`: formulário de exclusão dentro do formulário de edição. No WebKit, confirmar navegou para `/?` sem emitir `workspace.delete`. Na instalação nativa, workspace QA descartável continuou nas abas, em Projetos e no arquivo de estado. Portanto, a exclusão não foi persistida; não era apenas cache stale.
3. `client.ts`: `workspace.saved`/`workspace.error` não chegavam aos listeners de `ask`; criação/edição permanecia em Salvando até timeout apesar do ACK.

## Mudanças

- `mission.check` consulta recibo sem chamar tradução, spawn ou retry. Snapshot original e requestId permanecem imutáveis; rascunho atual pode ser editado e persistido separadamente.
- Quota rejeitada antes de qualquer PTY é terminal, com tipo de erro próprio. Consulta reconhece o erro legado específico da 0.2.20 sem reescrever o journal original.
- Pedidos realmente incertos ou sem recibo continuam protegidos, com aviso e consulta explícita; não ocorre reenvio automático.
- Formulários de editar/apagar workspace são irmãos; ACK e erro são encaminhados ao pedido correspondente. Snapshot de exclusão atualiza a lista.

## Validação anterior à publicação

- Teste novo de reconciliação: vermelho por método inexistente, depois verde.
- Teste novo workspace: vermelho por timeout mesmo após `workspace.saved`, depois verde.
- Typecheck completo: passou.
- Scripts: 6/6. Suíte completa: sidecar 309/309 e desktop 37/37; teste de quota adicional passou (inputLanguage 16/16).
- WebKit: campos, dropdown, checkbox e modo editáveis enquanto pendente; fechamento/reabertura preserva rascunho; consulta mantém requestId e zero `mission.create`.
- WebKit: exclusão emite `workspace.delete` exatamente uma vez, lista fica vazia e não há navegação de formulário.
- Regressões existentes de tradução gpt-6-luna/low, conta/modelo do líder e idempotência passaram.

Os scripts WebKit usam apenas estado/contas sintéticos, sem sidecar real. Exigem Playwright e Vite na porta 5376 (ou `ORBIT_QA_URL`). `ORBIT_PLAYWRIGHT_MODULE` pode apontar ao módulo instalado fora do repositório; `ORBIT_WEBKIT_EXECUTABLE` é opcional.

A validação nativa final depende do pacote oficial produzido após merge; resultados e hashes serão registrados no recibo da entrega. Nenhuma instalação local duplicada foi construída.
