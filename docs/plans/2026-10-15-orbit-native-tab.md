# Validação de Tab nas CLIs nativas

**Objetivo:** conferir a prévia e a inserção por Tab nos prompts reais de Claude Code e Codex, sem enviar mensagens aos modelos.
**Arquitetura:** fixture opt-in usa o servidor, xterm e PTY do Orbit com duas missões sintéticas em pastas vazias próprias. O launcher retira tarefa e instrução de papel antes de construir o comando; um bloqueio adicional rejeita submissões e CR/LF do navegador. Não copia o repositório para a área acessível às CLIs.
**Stack:** Node 24 empacotado, sidecar TypeScript, React/Vite, CUA.

## Arquivos
- `scripts/verify-terminal-suggestions.mjs`: fixture opt-in, limite de duas aberturas, auditoria de entrada e encerramento.
- `docs/plans/2026-10-15-orbit-native-tab-evidence/`: comandos, snapshots de terminal e observações de interface.
- `apps/desktop/src/orbit/terminalPrediction.ts` e seu teste: somente se houver reprodução de incompatibilidade no prompt nativo.
- `docs/plans/2026-10-15-orbit-input-suggestions-report.md`: acrescentar o resultado observado e suas limitações.

## Restrições
- Claude `claude-haiku-5-5`, Codex `gpt-6-luna`, esforço low; sem tarefa inicial, retomada ou chamada voluntária de modelo.
- Nenhum Enter sobre texto sugerido; confirmação de diálogo inicial somente pelo controle explícito do fixture, antes de qualquer rascunho.
- Métodos de submissão e CR/LF do navegador bloqueados no fixture; não alterar essas rotas em produção.
- Sem instalação, mudanças de configurações pessoais ou uso do piloto de código privado recusado anteriormente.
- Encerrar os processos próprios em até 12 minutos por fixture; duas aberturas por execução, sem fallback de provedor. A primeira execução foi encerrada sem submissão porque o processo sem TTY não manteve stdin aberto; uma segunda execução com TTY foi reservada para o teste de confirmação inicial. Isso permite quatro inicializações de CLI nesta validação, sem tarefas de modelo.

## Execução
1. Conferir que o script sem opt-in apenas imprime ajuda; inspecionar comandos construídos sem `taskPath`, `rolePromptPath` ou resume.
2. Abrir o fixture e o Vite próprios, observar o prompt real antes de digitar. Se houver menu nativo, manter a predição suspensa.
3. Conferir que a prévia não faz parte do snapshot do PTY; digitar prefixo, aceitar com Tab e conferir texto inserido sem CR/LF/submissão. Testar Esc e atalhos que não devem aceitar.
4. Se falhar, registrar a linha/cursor real, escrever teste vermelho e corrigir somente a causa comprovada. Repetir a interação original.
5. Encerrar fixture, Vite e abas; conferir PIDs próprios mortos. Rodar testes desktop e typecheck após eventual alteração; build somente com os processos Node empacotados já encerrados.
