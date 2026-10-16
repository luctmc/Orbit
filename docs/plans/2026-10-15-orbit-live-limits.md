# Limites atuais por conta

**Objetivo:** atualizar Claude/Codex automaticamente e mostrar saldo restante com procedência e validade, sem inferir renovação nem iniciar tarefas de modelo.
**Causas reproduzidas:** Codex lê apenas o último rollout; watcher roda a cada 10 minutos; UI transforma janela vencida em zero usado; UI não explicita que a porcentagem atual é consumo. Consulta nativa confirmou `/usage` do Claude com zero tokens de inferência e `account/rateLimits/read` do Codex com dados atuais diferentes do cache.
**Stack:** Node 24, CLI app-server JSON-RPC, `/usage` local, protocolo Orbit e React.

## Arquivos
- `packages/sidecar/src/accountLimits.ts`: parsing da resposta atual Codex e normalização dos resultados.
- `packages/sidecar/hooks/read-codex-limits.mjs`: subprocesso limitado a initialize e leitura de limites; sem threads/turnos.
- `packages/sidecar/src/core.ts`: consultas por conta a cada 30 segundos, deduplicação, falhas preservando o último sucesso e refresh solicitado pela UI.
- `packages/sidecar/src/store.ts`, `usage.ts`: impedir dados antigos de substituir leituras novas e preservar timestamp do evento de rollout.
- `packages/protocol/src/index.ts`: metadados opcionais de origem/última tentativa/erro para limites.
- `apps/desktop/src/orbit/limitPresentation.ts`: saldo restante e estados desconhecidos/vencidos, sem zero inventado.
- `apps/desktop/src/components/chrome.tsx`, `AccountsPanel.tsx`, `App.tsx`: mesma apresentação, atualização ao voltar ao app e controle de refresh.
- Testes `accountLimits.test.ts`, `liveLimits.test.ts`, `limitPresentation.test.ts`: parser, regressão de cache, concorrência/contas, validade/zero e falha.

## Critérios
1. Preferir o bucket `codex`, nunca outro limite de modelo. Valores inválidos ou janelas ausentes ficam desconhecidos; zero válido continua zero.
2. Não enviar prompts, criar threads, ler/copiar tokens ou alterar configurações globais. As CLIs usam o perfil da respectiva conta.
3. Uma consulta em andamento por conta; intervalo nominal 30 s, throttle de pelo menos 15 s e backoff de falhas. Dados antigos mantêm sua data, sem serem apresentados como atuais.
4. Nenhuma janela vencida vira 0% usado/100% disponível por inferência. Mostrar explicitamente “restante” e atualização/erro.
5. Reproduções/testes vermelhos antes da correção; testes de integração com CLIs simuladas e uma leitura nativa real sem modelos. QA visual e build release; atualizar app instalado com backup após verificar agentes ativos.

Referência de transporte: documentação oficial OpenAI, [Codex App Server](https://learn.chatgpt.com/docs/app-server), `initialize`, `initialized`, `account/rateLimits/read`. Polling não garante entrega instantânea do provedor; a UI deve expor quando a leitura foi obtida.
