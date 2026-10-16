import type { Pane } from '@orbit/protocol'
import type { OrbitCore } from '../src/core.ts'

/** Synthetic reviewer evidence for lifecycle tests; never presented as a real project check. */
export function acceptSyntheticResult(core: OrbitCore, reviewer: Pane, resultId: string) {
  const inspection = core.inspectResult(reviewer, resultId)
  const record = core.verifyResult(reviewer, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Synthetic independent lifecycle review', checks: [{ command: 'synthetic lifecycle observation', exitCode: 0, summary: 'fixture state matches' }], criteria: inspection.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'synthetic fixture observation' })) })
  if (!core.pendingDeliveries(reviewer.missionId).length && core.verificationStatus(reviewer.missionId).every(v => v.valid)) {
    const integration = core.inspectResult(reviewer, resultId, 'integration')
    core.verifyResult(reviewer, { inspectionId: integration.id, verdict: 'accepted', summary: 'Synthetic final integration observation', checks: [{ command: 'synthetic integration observation', exitCode: 0, summary: 'fixture state matches' }], criteria: integration.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'synthetic fixture observation' })) })
  }
  return record
}
