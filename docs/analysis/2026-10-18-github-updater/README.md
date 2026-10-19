# F-165 — atualização GitHub pela ponte persistente

Conta desta execução: Codex 1 (`codex-cli`), confirmada no providerId do processo. Reserva própria e worktree `fix/orbit-github-updater`, baseada em origin/main 37ea51f. Outros agentes e seus arquivos preservados.

O daemon instalado respondeu ao manifesto real com 200/v0.2.31. A regressão nova, com servidor HTTP e ponte reais e gh determinístico, falhou 401. A autenticação da ponte estava incompatível com o header do plugin; também faltavam tradução de token e URLs para os arquivos. O fix mantém o token privado dentro da ponte e preserva a verificação de assinatura do plugin. O prazo anterior de 15 s foi alinhado ao download pelo gh (15 min).

Validação dev real: `node docs/analysis/2026-10-18-github-updater/verify-live.ts`. O script abre uma ponte descartável com token aleatório para o daemon existente, busca pelo gh, baixa o arquivo pela URL devolvida e verifica assinatura de arquivo e comentário com a chave pública empacotada. Não imprime tokens nem usa chave privada. Resultado em live.json. PIDs/instanceId e dois processos ativos do motor permaneceram intactos; nada foi interrompido.

Regressões: `node --test packages/sidecar/test/updates.test.ts packages/sidecar/test/runtimeDaemon.test.ts`; typecheck global e suíte pelo fluxo obrigatório agent:finish. Os logs red/green/typecheck registram a validação inicial. Integração, publicação e instalação são gates separados; recibo final registra seus resultados reais.
