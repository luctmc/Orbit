// Helpers may be closed by the native leader before the supervisor's final observation.
// Retain only identities actually observed in this process, independent of mutable store rows.
export function sessionObservations() {
  const panes = new Map()
  return {
    observe(current) { for (const pane of current) panes.set(pane.id, structuredClone(pane)) },
    pane(id) { return panes.has(id) ? structuredClone(panes.get(id)) : null },
  }
}

export function auditRecovery(core, missionId, checkpoint, observations) {
  const before = structuredClone(core.store.mission(missionId)?.usage)
  const sessionRecovery = checkpoint.panes.map(old => {
    const current = core.store.pane(old.id) ?? observations.pane(old.id)
    return { paneId: old.id, priorSessionId: old.sessionId, currentSessionId: current?.sessionId ?? null, priorEpoch: old.executionEpoch, currentEpoch: current?.executionEpoch ?? null, identitySource: current ? 'observed-in-this-process' : 'missing' }
  })
  const reports = []
  for (const old of checkpoint.panes.filter(p => p.sessionId && p.usage)) {
    const current = core.store.pane(old.id) ?? observations.pane(old.id)
    if (!current?.executionEpoch || !old.executionEpoch || current.sessionId !== old.sessionId || current.executionEpoch === old.executionEpoch) {
      reports.push({ paneId: old.id, sameSession: false }); continue
    }
    const replay = core.store.accountSessionUsage(current, old.usage, old.cli === 'codex' ? 'rollout' : 'status')
    reports.push({ paneId: old.id, sameSession: true, delta: replay.delta })
  }
  const after = structuredClone(core.store.mission(missionId)?.usage)
  const accountingReplay = { before, after, reports, passed: reports.length > 0 && reports.every(r => r.sameSession && r.delta.total === 0 && (r.delta.costUsd ?? 0) === 0) && JSON.stringify(before) === JSON.stringify(after) }
  return { sessionRecovery, accountingReplay, recoveryPassed: accountingReplay.passed && sessionRecovery.every(p => p.priorSessionId && p.priorSessionId === p.currentSessionId && p.priorEpoch && p.currentEpoch && p.priorEpoch !== p.currentEpoch) }
}
