# Contabilização na retomada — Implementation Plan

> Aplicado no checkout: [relatório R0](implementation-r0.md), incluindo correção adicional do último report Codex no encerramento.

**Goal:** impedir que retomar o mesmo pane/conversa acrescente novamente o uso cumulativo antigo.

**Architecture:** conservar o baseline já persistido em Pane ao reconstruir o processo com `resume: true`. Conversa nova mantém o baseline vazio; `usageDelta` continua calculando somente o acréscimo. A fatia não tenta resolver importação de sessões externas nem baseline compartilhado entre panes diferentes; o ledger por identidade de sessão pertence a R1.

**Stack:** TypeScript nativo do Node 24, `node:test`, OrbitCore e PTYs sintéticos existentes.

## Global constraints

- Não modificar os outros arquivos já alterados no checkout.
- Não invocar Claude/Codex reais, autenticações ou serviços externos nos testes.
- Não alterar `usageDelta` para ignorar um primeiro report legítimo.
- Retomada: mesma sessão e conta; conversa nova: novo consumo.
- Preservar null de custo/contexto desconhecidos; não inventar dados.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| Criar `packages/sidecar/test/sessionAccounting.test.ts` | Resume idempotente, delta novo, reload do core e conversa nova |
| Modificar `packages/sidecar/src/core.ts` em `restartPane` (atual linha 2163) | Restaurar baseline da mesma conversa antes do próximo report |

## Task 1: baseline da mesma conversa

**Interfaces consumidas:** `OrbitCore.statusReport`, `hookReport`, `handle`, `store.mission`, `store.snapshot`, `PaneManager.setUsage` e `setSession` já existem. Nenhuma interface pública nova.

- [x] Criar o teste completo abaixo em `packages/sidecar/test/sessionAccounting.test.ts`.
- [x] Executar `cd packages/sidecar && node --test test/sessionAccounting.test.ts`. No código atual, testes de resume devem falhar com totais observados 2.200 versus esperados 1.100.
- [x] Aplicar a substituição completa abaixo somente no bloco indicado de `restartPane`.
- [x] Reexecutar o teste: todos passam. Confirmar totais por dia e custo, além da missão.
- [x] Executar `npm test` e `npm run typecheck` na raiz; interpretar cada falha antes de alterar expectativas.
- [ ] Revisar diff e, na execução autorizada da fatia, criar commit com pathspec: `git add packages/sidecar/src/core.ts packages/sidecar/test/sessionAccounting.test.ts` seguido de `git commit -m 'fix: preserve usage baseline when resuming a session'`. Não incluir outras alterações já presentes.

### Teste completo

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'

const SESSION = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const report = (input: number, output: number, cost: number) => ({
  context_window: { total_input_tokens: input, total_output_tokens: output, used_percentage: 5 },
  cost: { total_cost_usd: cost },
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-session-accounting-'))
  const old = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    GEMINI_CLI_HOME: process.env.GEMINI_CLI_HOME,
  }
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  process.env.CODEX_HOME = join(root, 'codex')
  process.env.GEMINI_CLI_HOME = join(root, 'gemini')
  const create = () => {
    const next = new OrbitCore({
      dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
      broadcast: () => {},
      run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
      agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }),
    })
    next.setEndpoint('http://127.0.0.1:1')
    return next
  }
  let core = create()
  core.handle({ type: 'workspace.open', path: root })
  const workspace = core.store.snapshot().workspaces[0]!
  core.handle({ type: 'mission.create', workspaceId: workspace.id, title: 'Accounting',
    objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  const { pane } = await core.spawnHelper(lead, {
    title: 'Synthetic worker', task: 'Read synthetic input', cli: 'claude', model: null,
  })
  core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: SESSION })
  const totals = () => ({
    mission: core.store.mission(lead.missionId)!.usage.total,
    cost: core.store.mission(lead.missionId)!.usage.costUsd,
    day: core.store.snapshot().usageDays.reduce((sum, d) => sum + d.claude, 0),
  })
  return {
    get core() { return core }, id: pane.id, totals,
    reload() { core.shutdown(); core = create() },
    close() {
      core.shutdown()
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

test('same-session resume adds only the new cumulative delta', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
    f.core.handle({ type: 'pane.restart', paneId: f.id, resume: true })
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
    f.core.statusReport(f.id, report(1200, 120, 0.012))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
  } finally { f.close() }
})

test('persisted baseline survives a core reload and resume', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    f.reload()
    f.core.handle({ type: 'pane.restart', paneId: f.id, resume: true })
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    assert.deepEqual(f.totals(), { mission: 1100, day: 1100, cost: 0.01 })
  } finally { f.close() }
})

test('a fresh conversation counts its new usage', async () => {
  const f = await fixture()
  try {
    f.core.statusReport(f.id, report(1000, 100, 0.01))
    f.core.handle({ type: 'pane.restart', paneId: f.id, resume: false })
    f.core.statusReport(f.id, report(200, 20, 0.002))
    assert.deepEqual(f.totals(), { mission: 1320, day: 1320, cost: 0.012 })
  } finally { f.close() }
})
```

### Implementação completa da mudança

Em `restartPane`, substituir:

```ts
if (resume && sessionId) this.panes.setSession(opened.id, sessionId)
```

por:

```ts
if (resume && sessionId) {
  this.panes.setSession(opened.id, sessionId)
  this.panes.setUsage(opened.id, pane.usage, pane.contextPercent)
}
```

O processo recém-criado só pode ser tratado como a mesma conversa depois de `sessionId` restaurado. O report assíncrono seguinte deve ver o baseline anterior. Nova conversa continua com uso null criado pelo PaneManager. Isso corrige a reprodução atual sem suprimir consumo legítimo.

## Revisão e limites

Este é um plano de correção pequena, não a arquitetura final de contabilização. Persistência debounced, eventos atrasados de processo morto, sessões importadas/compartilhadas e uso do decisor continuam nos gates R1/R2/R5. O teste de reload cobre shutdown com flush, não crash durante debounce. Não declarar esses cenários resolvidos por esta mudança.

A outra reprodução, progresso seguido de saída, exige contrato de obrigação separado de `isAlive`; não misturar sua máquina de estados neste commit. `progress` pode continuar sendo checkpoint que encerra um turno, desde que não conclua a atividade nem silencie sua pendência.

## Cobertura do requisito

- Baseline preservado ao retomar → teste 1.
- Somente delta novo contado → teste 1, report 1320.
- Estado persistido → teste 2.
- Nova conversa não ignora consumo → teste 3.
- Sem mudança de contrato público ou CLI real → fixture sintética e alteração em bloco existente.

A execução pode ocorrer inline como a primeira fatia do roteiro. Nenhum arquivo de produção foi alterado para aplicar este plano nesta rodada.

## Validação do próprio plano

O código completo de teste foi extraído deste documento e executado: no checkout atual, dois testes falham com missão/dia de 2.200 e custo 0,02, enquanto o teste de conversa nova passa (exit 1 esperado). Em cópia isolada de `src`/`hooks` em `/tmp`, somente a substituição proposta foi aplicada: 3/3 passaram, exit 0. Nenhum arquivo de produção foi alterado para essa validação. Ver [validation.json](validation.json).
