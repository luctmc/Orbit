import { catalogRevision as revisionOf } from './catalogRevision.ts'
import { ACCOUNT_FULL_PERCENT, AGENT_CLIS, type Account, type AccountLimits, type AccountStatus, type Catalog, type CliStatus, type HarnessCandidate } from '@orbit/protocol'
import { adapterCapabilities } from './adapters/types.ts'

/** A measured seat may only use a freshly observed subscription; unknown is not spare capacity. */
export function harnessAccounts(accounts: Account[], statuses: AccountStatus[], limits: AccountLimits[], now = Date.now()): Account[] {
  return accounts.filter(a => {
    const status = statuses.find(s => s.accountId === a.id)
    const limit = limits.find(l => l.accountId === a.id && l.cli === a.cli)
    if (!a.auto || a.kind !== 'assinatura' || status?.loggedIn !== true || status.busy || !status.checkedAt || status.checkedAt > now || now - status.checkedAt > 300000) return false
    if (!limit || limit.source !== 'provider' || limit.refreshError || limit.updatedAt > now || now - limit.updatedAt > 90000) return false
    const windows = [limit.fiveHour, limit.weekly].filter(w => w !== null)
    return windows.length > 0 && windows.every(w => w && Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent < ACCOUNT_FULL_PERCENT && Number.isFinite(w.resetsAt) && w.resetsAt > now)
  })
}
export function harnessCandidates(catalog: Catalog | null, clis: CliStatus[], accounts: Account[], allowed: readonly string[], sandbox: boolean, catalogForAccount?: (account:Account)=>import('@orbit/protocol').CliCatalog, revision?:string): HarnessCandidate[] {
  if (!catalog) return []
  const catalogRevision = revision ?? revisionOf(catalog)
  return AGENT_CLIS.flatMap(cli => {
    const status = clis.find(s => s.cli === cli)
    if (!allowed.includes(cli) || !accounts.some(a => a.cli === cli) || !status?.installed || !status.version || status.busy || sandbox && !adapterCapabilities(cli).supports.readOnlySandbox) return []
    // Built-in catalogs are useful fallback hints, not confirmed native model/effort availability.
    const catalogs = catalogForAccount ? accounts.filter(a=>a.cli===cli).map(catalogForAccount) : [catalog[cli]]
    const seen=new Set<string>()
    return catalogs.filter(current=>current.source==='cli').flatMap(current=>current.models.flatMap(model=>model.efforts.flatMap(effort=>{const key=model.id+'\0'+effort;if(seen.has(key))return [];seen.add(key);return [{cli,model:model.id,effort,cliVersion:status.version!,catalogRevision}]})))
  })
}
