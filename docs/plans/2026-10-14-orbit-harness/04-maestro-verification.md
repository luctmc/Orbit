# R4 — decisões, admissão e revisão de resultados

**Goal:** impedir concorrência de writers na mesma cópia e conclusão de trabalho novo sem revisão independente vinculada ao código.
**Architecture:** manter PTYs/CLIs e snapshots existentes. Fazer admissão síncrona antes do lançamento; registrar política/decisão na tentativa. Registrar inspeção e parecer em transações duráveis, comparando fingerprints do código na entrega, inspeção, parecer e conclusão da missão.
**Stack:** TypeScript, Node 24, Git e MCP existentes; sem framework ou serviço novo.

## Restrições

- Preservar alterações R0–R3 e demais mudanças locais; não instalar, publicar ou commitar.
- Serialização conservadora por cópia física, incluindo pastas adicionais; worktrees distintos permitem paralelismo.
- Dependências são atividades existentes e aceitas. Não criar fila invisível nem lançar automaticamente pedidos recusados.
- Fingerprints incluem HEAD, index, diff e arquivos não ignorados no Git; fora do Git, árvore limitada e exclusões explícitas de artefatos/dependências/dados do Orbit.
- Checks de um revisor são declarações atribuídas a ele. O motor confere identidade, contrato e fingerprint, sem executar shell por um novo tool MCP nem inventar evidência de execução.
- Histórico sem contrato R4 permanece legado, sem atribuir revisão independente retroativa.

## Mapa e sequência

| Arquivo | Responsabilidade |
|---|---|
| `packages/protocol/src/index.ts` | Contrato de admissão, revisão de source, inspeção, parecer e recibo de decisão |
| `packages/sidecar/src/scheduler.ts` | Normalização de raízes e conflito entre cópias; dependências/ciclos |
| `packages/sidecar/src/verification.ts` | Fingerprint limitado e checagem de parecer/critério |
| `packages/sidecar/src/activityLedger.ts` | Incorporar dependências ao hash do contrato |
| `packages/sidecar/src/store.ts` | Leases, decisões, inspeções e pareceres em transações; migração conservadora |
| `packages/sidecar/src/maestro.ts` e `routing.ts` | Recibo estruturado e hash de política; override e CAS de edição |
| `packages/sidecar/src/core.ts` | Admissão/revalidação e fonte da entrega; gate de conclusão |
| `packages/sidecar/src/mcp.ts` e `prompts.ts` | Contratos de dependência, inspeção/parecer e instruções operacionais |
| `packages/sidecar/test/scheduler.test.ts`, `verification.test.ts`, `orchestration.test.ts` | Casos de concorrência, diff, aceite, invalidação, persistência e falha de disco |

1. Adicionar testes que recusam autoaceite, source alterado, dependência não aceita, writers sobrepostos e override de squad ignorado. Observar falhas antes da integração.
2. Implementar fingerprints e políticas puras; testar Git com alterações staged/unstaged/untracked e aliases de diretório.
3. Integrar leases antes do processo, verificar escolhas explícitas e registrar recibo antes do lançamento. Revalidar revisão da tabela depois de classificação assíncrona.
4. Persistir inspeção/parecer; exigir outro pane para aceitar, todos os critérios cobertos e checks declarados com resultado. Rejeitar novo resultado/revisão/tentativa depois da inspeção.
5. Exigir parecer atual para obrigações R4 concluídas e dependências fixadas. Force com razão produz dispensa auditável, sem fabricar aceite.
6. Conferir integração MCP, regressões R0–R3, Node 24, tipos e build; registrar comandos, saídas e hashes no relatório R4.

Execução inline já autorizada pelo usuário; decisões de implementação e testes ficam nas fontes e no relatório desta etapa.
