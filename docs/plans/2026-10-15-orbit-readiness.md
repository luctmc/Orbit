# Prontidão do Orbit — 15/10/2026

**O build local é candidato a começar com tarefas acompanhadas. A substituição exclusiva do ambiente principal ainda exige validar uso cotidiano, paralelismo real maior e margem econômica.** [Evidências atuais](2026-10-15-orbit-repository-evidence/readiness.json).

| Capacidade | Estado observado |
|---|---|
| Claude Code e Codex CLI | Ambos completaram os dois fluxos nativos pequenos da última rodada aprovada: Codex líder → Claude implementação → Codex revisão e o inverso. |
| Líder, atribuição e revisão | Delegação, resultados, ACKs, revisão independente e conclusão conjunta passaram nesses cenários. Isso não certifica planejamento irrestrito de tarefas complexas. |
| Paralelismo | O motor suporta vários agentes e controla escritores. Na mesma cópia/raízes sobrepostas, não admite dois writers gerenciados simultâneos. Worktrees distintos permitem escrita em paralelo, salvo pastas extras compartilhadas. Há testes locais de admissão/leases; ainda falta um squad real maior com writers simultâneos e integração. |
| Retomada | O piloto inverso passou por SIGKILL após commit durável e antes do dispatch; entrega, sessão e replay preservados. Outros pontos de falha não receberam certificação universal. |
| Ferramentas | Perfil Orbit como padrão, mantendo ferramentas nativas de código; opção de herdar integrações em Ajustes → Quem faz cada tarefa, na próxima abertura/retomada. |
| Interface/mascote | Implementados e verificados localmente; estados distinguem declaração de pronto, revisão atual e código alterado. |
| Consumo | Contadores e limites implementados. Redução drástica não comprovada; último inverso terminou apenas 9.006 tokens abaixo de 1.500.000. USD completo continua desconhecido para Codex. |

Na conferência do motor/supervisores, **224 testes passaram, exit 0**. [Logs dessa rodada](2026-10-15-orbit-repository-evidence/current-tests.log). A rodada posterior de sugestões validou Tab e Esc nos prompts reais do Claude e Codex, sem submissão de tarefas, e passou **19 testes desktop**, typecheck e novo build debug. [Relatório e limites da validação nativa](2026-10-15-orbit-native-tab-report.md). Scripts de piloto receberam suporte opt-in ao replay de regressões conhecidas, com quatro testes locais do supervisor; o próximo piloto de tarefas em código privado ainda não foi executado.

**O aplicativo em `/Applications/Orbit.app` foi atualizado posteriormente com o release local validado**, incluindo sugestões por Tab e botões de adicionar contas por provedor. Abertura em perfil isolado, assinatura e arquivos foram conferidos; os dados pessoais e o app anterior foram preservados. [Relatório de instalação](2026-10-15-orbit-install-report.md). Essa instalação não substitui os pilotos de tarefas reais que continuam pendentes.

**Atualização posterior de limites:** o release instalado consulta Claude/Codex por conta a cada 30 segundos e mostra saldo restante, com validade e falhas explícitas. Abertura no perfil normal e duas leituras reais sucessivas foram confirmadas. A suíte atual passou com **233 testes do motor e 21 do desktop**, typecheck e build release. Na abertura houve demora em leitura Git de workspace antes do motor conectar; depois as duas sessões retomaram ociosas. [Relatório de limites e limitações observadas](2026-10-15-orbit-live-limits-report.md).

**Apresentação Claude alinhada ao provedor:** após comparar o popover do próprio Claude com a CLI, o indicador Claude passou a mostrar **percentual usado** (sessão e semana); o Codex mantém **restante**. A alteração abrange barra, tooltip e Contas, com 22 testes desktop aprovados. [Conferência e instalação](2026-10-15-orbit-claude-meter.md).

## Pendências para uso como ambiente principal exclusivo
1. Avaliar o build atual em tarefas reais consecutivas no mesmo repositório, mantendo histórico, consumo e resultados anteriores íntegros.
2. Validar uma missão real com vários agentes e escritores em worktrees separados, seguida de revisão e integração.
3. Obter margem de consumo estável em várias execuções; nenhuma porcentagem de economia está comprovada.
4. Melhorar a fidelidade dos resumos: houve contradição textual no piloto anterior, embora os checks estruturados indicassem corretamente falha antes e sucesso depois.
5. Avaliar o aplicativo atualizado na experiência cotidiana. A instalação já foi concluída; a validação prolongada de uso segue pendente.

## Bloqueio atual do próximo piloto
O usuário respondeu “pode seguir” ao pedido de envio do snapshot de código do Orbit aos provedores, solicitando primeiro esta lista de pendências. A lista foi apresentada antes da execução. A revisão automática recusou novamente a abertura por não considerar a resposta confirmação explícita de envio do payload aos destinos OpenAI/Codex e Anthropic/Claude Code. **Os dois pedidos de abertura foram rejeitados antes de iniciar processos; não houve chamadas de modelo nesse novo piloto.**

O próximo teste permanece limitado a duas tarefas, nos pins anteriores e sem elevar o teto. Como os dois defeitos já estão corrigidos, o teste fará replay dos arquivos antigos somente na cópia própria; o supervisor/testes atuais e o checkout pessoal permanecem preservados. [Conteúdo proposto](2026-10-15-orbit-repository-evidence/proposed-native-payload.json). É necessária a confirmação explícita de envio do código para liberar esse passo, sem contornar a revisão automática.
