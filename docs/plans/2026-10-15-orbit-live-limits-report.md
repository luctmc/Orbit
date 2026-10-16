# Limites atuais de Claude e Codex — 15/10/2026

O release corrigido foi instalado em `/Applications/Orbit.app` e aberto com o perfil normal. Os dois provedores retornaram limites atuais; uma segunda leitura automática avançou os timestamps de ambos, sem clicar em atualizar. As duas sessões existentes ficaram ociosas, com os dois workspaces e as duas missões preservados.

## Diagnóstico e mudança

O Codex usava limites do último rollout, que podiam estar antigos. O motor consultava a cada dez minutos e a interface mostrava porcentagem usada, enquanto a referência do Codex mostrava restante. Além disso, uma janela vencida virava zero usado, sugerindo uma renovação que não havia sido confirmada.

Agora o Codex usa `account/rateLimits/read` do app-server e o Claude usa seu comando local `/usage`, por perfil de conta. Não há criação de thread nem submissão de tarefa nessas consultas. A medição nativa do Claude registrou zero tokens de entrada e saída de inferência. A interface apresenta **restante**, a última leitura e eventual falha.

O intervalo nominal é 30 segundos, com consulta ao voltar ao app e botão manual. Consultas simultâneas da mesma conta são deduplicadas, com intervalo mínimo de 15 segundos após sucesso. Falhas aplicam espera progressiva de 30 segundos até cinco minutos. O último sucesso mantém sua data; após 90 segundos, ou após o reset da janela, a porcentagem fica indisponível até nova confirmação. Isso é atualização periódica, sujeita à resposta do provedor, sem promessa de transmissão instantânea.

## Evidências

- Regressões reproduzidas antes da correção: cache antigo sobrescrevendo leitura nova, data de rollout perdida, reset Claude inventado e Codex sem consulta atual.
- Motor/supervisores: **233 testes aprovados**, exit 0, concorrência limitada a quatro. Desktop: **21 aprovados**, exit 0. Typecheck, build release e verificação de whitespace passaram.
- Uma execução com concorrência máxima teve timeout de encerramento PTY no teste de exclusão. O teste isolado passou, assim como a suíte completa com concorrência quatro. Não foi feita alteração no encerramento PTY nem alegada correção dessa instabilidade.
- QA com provedores simulados confirmou atualização automática, isolamento por conta, preservação do último sucesso em falha e ausência de overflow em quatro larguras. As imagens `expired-cache.png` e `automatic-refresh.png` são sintéticas.
- [Consulta real normalizada](2026-10-15-orbit-live-limits-evidence/native-normalized.json), sem tarefas de modelo.
- [Primeira leitura no app instalado](2026-10-15-orbit-live-limits-evidence/installed-first-read.json) e [leitura automática posterior](2026-10-15-orbit-live-limits-evidence/installed-auto-read.json). As porcentagens são fotografias do momento e mudam com o uso, inclusive fora do Orbit.
- [Captura do app instalado](2026-10-15-orbit-live-limits-evidence/installed-native.png).

## Instalação e observação de inicialização

O bundle release recebeu assinatura ad hoc local, verificada com `codesign --verify --deep --strict`. Os arquivos instalados foram comparados ao bundle preparado. O app anterior e os dados foram preservados em `/Applications/.Orbit-backups/2026-10-15-fb52becb`; o fingerprint dos dados permaneceu igual durante a substituição. [Registro da instalação](2026-10-15-orbit-live-limits-evidence/installation.json).

Nesta abertura, a retomada demorou cerca de 90 segundos, com Git bloqueado em leitura de diretório de um workspace existente antes do handshake do motor. A amostra do processo mostrou `rev-parse --show-toplevel` aguardando `getcwd/open`; a causa externa desse bloqueio não foi determinada. A conexão depois completou, retomou as duas sessões e atualizou os limites. Essa demora de inicialização permanece uma observação a investigar separadamente; não comprometeu a confirmação das leituras automáticas após conectar.

Logs e hashes: [validação](2026-10-15-orbit-live-limits-evidence/validation.json), [motor](2026-10-15-orbit-live-limits-evidence/tests-bounded.log), [desktop](2026-10-15-orbit-live-limits-evidence/desktop-tests.log), [build](2026-10-15-orbit-live-limits-evidence/build.log).
