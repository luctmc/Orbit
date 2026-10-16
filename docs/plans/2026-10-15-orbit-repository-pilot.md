# Piloto em código real — Implementation Plan
**Goal:** validar duas correções consecutivas no snapshot isolado do código atual do Orbit e incorporar somente mudanças verificadas.
**Architecture:** estender o supervisor existente com tarefas de repositório. Copiar fontes atuais, incluindo mudanças locais, sem histórico, credenciais ou artefatos; resolver os pacotes Orbit para a cópia. Manter o mesmo workspace e Store entre missões, arquivando a primeira após guardar seu resultado. Oracle externo protege todos os caminhos fora do contrato.
**Stack:** Node 24.21.0, TypeScript nativo, node:test, supervisor Orbit e CLIs já instalados.

## Global constraints
- Duas tarefas: contadores Codex e custo no relatório Markdown; uma tentativa por atividade.
- Pins Claude `claude-haiku-5-5` / Codex `gpt-6-luna`, esforço low, perfil orbit.
- Cada missão: 1.500.000 tokens, US$ 0,15 Claude conhecido, seis minutos por fase; sem fallback ou aumento automático.
- Segunda missão somente se a primeira passar; segunda com interrupção após resultado durável e retomada auditada.
- Nenhuma instalação, alteração de missões pessoais, commit no checkout do usuário, push ou publicação.
- Snapshot de código sem histórico não equivale a validação de um grande projeto externo ou uso diário amplo.

## File map
- `scripts/lib/repository-pilot.mjs`: snapshot, resolução de dependências, contratos e oracle protegido.
- `scripts/lib/repository-pilot.test.mjs`: isolamento dos pacotes, escopo, adulteração do oracle e preservação entre tarefas.
- `scripts/verify-autonomous-harness.mjs`: seleção opt-in das tarefas reais e continuidade do Store/workspace; caminho do corpus preservado.
- `packages/sidecar/test/usageCounters.test.ts`: regressão de raciocínio como subconjunto da saída.
- `packages/sidecar/test/reportCost.test.ts`: custo conhecido positivo, zero e desconhecido.
- `packages/sidecar/test/usage.test.ts`: corrigir fixture inventada incompatível com o contrato de contagem.
- `packages/sidecar/test/report.test.ts`: atualizar a expectativa do relatório completo para a identificação do subtotal.
- `packages/sidecar/src/usage.ts`: mudança mínima na saída do Codex, após reprodução vermelha.
- `packages/sidecar/src/report.ts`: explicitar subtotal e custo desconhecido, após reprodução vermelha.
- `docs/plans/2026-10-15-orbit-repository-report.md` e diretório de evidências homônimo: resultados, falhas, consumo, hashes e limites.

## Task 1: reproduzir e proteger
- [x] Adicionar testes antes da correção: input 75 + output 1186 = total 1261, reasoning 1024 já incluso; raciocínio zero e ausente preservam saída. A documentação oficial mostra esse contrato: https://developers.openai.com/api/docs/guides/reasoning.
- [x] Custo zero deve aparecer como US$ 0,00; null deve ser explicitamente desconhecido; positivo deve ser descrito como subtotal informado, sem prometer cobertura integral.
- [x] Rodar os dois arquivos novos no Node empacotado; guardar falhas e códigos de saída.

## Task 2: preparar e validar supervisor
- [x] Copiar somente fontes/configurações de código enumeradas; rejeitar links nas fontes. Dependências externas existentes são compartilhadas; aliases @orbit apontam para os pacotes copiados.
- [x] Oracle verifica hashes e caminhos antes de executar testes. Alterações fora do contrato ou no oracle impedem execução.
- [x] Testar adulteração, resolução dos pacotes e sequência: primeira alteração torna-se parte protegida da segunda tarefa.
- [x] Integrar flags `--repository-task usage|report` e `--continue-from RUN`, sem chamadas de modelo por padrão; recusar sequência se primeira falhou ou processos próprios ainda vivem.

## Task 3: executar e incorporar
- [ ] Rodar missão forward de contadores; conferir diff, oracle e gates, independentemente do texto livre.
- [ ] Somente após aprovação: rodar missão reverse de relatório no mesmo workspace/Store, com interrupção/retomada; verificar identidade, replay e primeira missão preservada.
- [x] Piloto bloqueado antes de iniciar: registrar o bloqueio e concluir localmente as duas correções com seus testes, sem repetir o piloto automaticamente.
- [x] Rodar typecheck e build debug antes dos testes que dependem do Node empacotado. Rodar suíte apropriada, validar diff e registrar limites reais. Não instalar nem publicar.

Execução autorizada pelo usuário: inline, com checkpoints. Não há commit no checkout atual.

Status desta rodada: validação local concluída; execução nativa depende da autorização de envio solicitada pela revisão automática. [Relatório](2026-10-15-orbit-repository-report.md).

## Preparação da retomada e confirmação de escopo
O usuário pediu para continuar após o pedido de envio à OpenAI e Anthropic, mas solicitou primeiro a lista de pendências. A lista foi apresentada, incluindo a distinção entre build local e aplicativo instalado. A revisão automática recusou novamente a abertura: não considerou “pode seguir” confirmação explícita do envio. Nenhum modelo foi iniciado; a autorização específica continua pendente. As duas correções já estão verdes no checkout: para medir a execução dos agentes, reproduzir somente na cópia os dois arquivos anteriores preservados no manifesto proposto. Isso é replay de regressões conhecidas, não descoberta de novos bugs. O supervisor e os testes continuam na revisão atual.
- `scripts/lib/repository-pilot.mjs`: `seedRepositoryRegressions(root, manifestPath)` valida o diretório temporário próprio e os hashes dos dois arquivos antes de copiar; nenhum outro caminho é restaurado.
- `scripts/lib/repository-pilot.test.mjs`: recusa de hash divergente sem cópia parcial, depois restauração somente dos caminhos declarados.
- `scripts/verify-autonomous-harness.mjs`: flag opt-in `--replay-from MANIFEST` apenas na primeira tarefa usage; relatório registra proveniência. O caminho padrão não injeta regressões.
- Rodar os testes do supervisor e preflight; abrir o piloto forward. Só se passar, abrir o inverso no mesmo Store/workspace com interrupção controlada, mantendo pins e limites anteriores.
