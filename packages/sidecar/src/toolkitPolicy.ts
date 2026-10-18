import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentCli } from '@orbit/protocol'
import type { ContextSection } from './contextPack.ts'

/** Adapted from Vibe Coding Toolkit, MIT © 2026 Matheus Gomes. See THIRD_PARTY_NOTICES.md. */
export const TOOLKIT_REVISION = 'de66fe371a49f5a4d3b521759e5c401f390b6424'
export const TOOLKIT_POLICY_VERSION = `orbit-vibe-1:${TOOLKIT_REVISION}`

const CORE = `[Orbit default working agreements — ${TOOLKIT_POLICY_VERSION}]
These are defaults, subordinate to system, user and applicable project instructions. Honor explicit opt-outs (including stop ponytail / stop caveman), pauses, budgets and authorization. Bypass permissions are unchanged; they do not authorize unrelated actions.
Scale process to the request: for conversation or no task, answer or await input without starting setup, planning, delegation or checks. For a simple task, execute directly with proportionate verification. For complex work, understand → design → plan as needed → implement → verify → review. Ask only for material missing decisions; do not re-request existing approval.
Before editing, read applicable project instructions and relevant code/callers; preserve stack, contracts, data, credentials and local changes. Define observable acceptance and checks. Reproduce bugs before fixing their root cause when feasible. Reuse existing/native solutions; deliver the smallest complete change without weakening security, validation, error handling or accessibility.
For nontrivial changes, run meaningful affected checks and seek independent read-only review when available. Report actual commands/results, failures, unrun checks and residual risks; a handoff or a model's claim is not proof. Use current official sources for changing APIs, without sending secrets/private code. Stay concise in the user's language, retaining exact errors, numbers, restrictions and requested detail; use normal wording in code/docs/commits.
Use the referenced workflow details only when relevant: implementation-quality for coding/review; coordination-recovery for delegation/resume; context-tools for memory/integrations. Retrieve them with context_read, not every turn. Availability does not authorize installations, provider/account/model changes, proxies, new costs, publishing or external messages. Orbit delivers these instructions; model compliance is not guaranteed.`

/** Bounded, local adaptations; no remote fetch, plugin install or executable upstream code. */
const DETAILS: Record<string, string> = {
  'implementation-quality': `Understand the product, critical flows, actual stack, instructions and baseline before selecting a solution. Separate facts, assumptions, decisions and evidence. Bounded work needs a short design; architecture or ambiguous work needs a reviewable plan with dependencies and acceptance. Already authorized execution need not repeat approvals. For bugs, inspect the error, reproduce and trace the value through callers before the smallest root-cause fix; add a regression that detects the original failure where feasible.
Prefer existing implementation, configuration, standard library, native platform and installed dependencies before new abstractions. Do not cut input validation, authorization, error handling, tests warranted by risk, or basic accessibility to save lines. Keep deliberate limitations explicit. Use the project's canonical lint/types/tests/build and relevant runtime flows; do not impose Next.js, Drizzle, ESLint, a 350-line cap or a framework migration on unrelated projects. Measure legacy issues before tightening rules; never weaken protections or delete tests for a green report.
Review the exact diff and connected callers/contracts/tests, with independent read-only review for nontrivial risk when available. Findings need location, concrete scenario and evidence; distinguish hypotheses. Resolve or explicitly disposition relevant findings and rerun affected checks. Further rounds need new evidence, unresolved risk or explicit request; respect requested counts. Report unavailable review. Security review remains private/redacted and read-only unless fixes are authorized; no finding is not a security guarantee. UI work uses the existing design system, accessible labels/focus/contrast, states and actual keyboard/runtime checks.
Continue authorized work through delivery. Answer status questions and continue; partial blockers stop only dependent work. Respect explicit pauses, stops, refusals and resource limits. Never promise background execution without an observable process. Deliver outcome, changed files, checks/exits, unrun coverage, risks and smallest remaining action.`,
  'coordination-recovery': `Choose direct execution or deterministic tools for trivial or tightly coupled work. Delegate only when authorized and useful for isolation, specialization or independent parallelism. Each brief needs objective, minimal relevant context, exact writable files, dependencies, mutable resources, acceptance, checks and return format. One writer per file; serialize shared lockfiles/configuration, Git operations, build output, ports, databases and services unless explicitly isolated. A worktree alone does not isolate those resources. Reviewers stay read-only; the coordinator validates integration.
Preserve the authorized client, authentication and main model. Follow Orbit's actual routing/catalog and explicit account/provider/model restrictions; use supported model/effort controls only. With authorized task-based selection, choose sufficient capability for risk: lightweight for inventory/mechanical work, enough reasoning for implementation, greater capability for security/data/concurrency/architecture or ambiguous diagnosis. Do not hardcode commercial model names from a guide. Investigate failed evidence before bounded retries/escalation; never silently enable another provider, proxy or API billing. Written preferences are not proof of model identity or savings.
Before recovery, transfer or reassignment, inspect the actual checkout/revision, dirty files, live processes and current assignment/result state. Old handoffs are context, not fresh proof; do not redo accepted work. Confirm a writer has stopped before takeover. Retain scope, criteria, pauses and remaining work. An unfinished-work handoff records objective/acceptance, checked revision/date, completed files, real evidence, remaining dependencies/blockers, owned resources/cleanup and stale assumptions. Reuse Orbit's mission briefing, ledger, notes and deliveries instead of creating a competing state system.`,
  'context-tools': `Read the short project instruction index first; retrieve detailed architecture/product/design/quality/setup documentation only for the current need. Preserve canonical documents and directory-specific rules instead of generating nine competing template files. Update the responsible document when behavior, schema, commands or configuration changes. Durable knowledge needs source, verification date and invalidation trigger; recheck conflicts and retire stale facts. Temporary handoffs are not permanent knowledge. Use mission_briefing after compaction and verify live state before acting.
Skills/plugins/tools are optional capabilities, not mandatory actions: discover actual names, versions, scopes and availability before relying on them. Installed/configured/discovered/executed are distinct states. Reuse existing integrations and never duplicate hooks, MCP servers or wrappers. Context7 may supply current version-specific documentation; otherwise use official sources. RTK applies only if present and supported, once per command; keep access to original output. Graphify evidence needs scope/freshness and exclusions for secrets/dependencies/generated content; no paid semantic extraction by default.
Superpowers process, Ponytail simplification and Caveman concise prose are adapted here as portable working agreements, not claimed installed plugins. stop ponytail and stop caveman override their corresponding defaults in this conversation. Do not auto-install those packages or forward requests through their proxies. Vercel/Next, PostgreSQL, shadcn, Sentry, browser tools, artifact skills, external memory/Obsidian and deployment apply only to a relevant authorized task with existing compatible access. Do not create accounts, services, schedules, credentials, databases or billing to satisfy a catalog. Never send private code/secrets/personal data to documentation, graph, review or memory services. Preserve native authentication, existing tool profile and project permissions.`,
}

export function toolkitSections(): ContextSection[] {
  return [
    { id: 'toolkit-defaults', text: CORE, required: true },
    ...Object.entries(DETAILS).map(([name, text]) => ({ id: `toolkit-${name}`, text, maxBytes: 0 })),
  ]
}

interface DispatchReceipt { version: string; cli: AgentCli; accountId: string | null; sessionId: string | null; executionEpoch: string }

/** Records dispatch, never provider consumption. Stored outside ephemeral pane files for app recovery. */
export class ToolkitDispatches {
  private readonly root: string
  constructor(root: string) { this.root = root }
  private path(paneId: number) {
    if (!Number.isSafeInteger(paneId) || paneId < 1) throw new Error('Agente de política inválido')
    return join(this.root, `${paneId}.json`)
  }
  inherited(paneId: number, cli: AgentCli, accountId: string | null, sessionId: string): boolean {
    try {
      const receipt = JSON.parse(readFileSync(this.path(paneId), 'utf8')) as DispatchReceipt
      return receipt.version === TOOLKIT_POLICY_VERSION && receipt.cli === cli && receipt.accountId === accountId
        && receipt.sessionId === sessionId
    } catch { return false }
  }
  private save(paneId: number, receipt: DispatchReceipt): void {
    const path = this.path(paneId)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(`${path}.tmp`, JSON.stringify(receipt), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  dispatched(paneId: number, cli: AgentCli, accountId: string | null, sessionId: string | null, executionEpoch: string): void {
    this.save(paneId, { version: TOOLKIT_POLICY_VERSION, cli, accountId, sessionId, executionEpoch })
  }
  observe(paneId: number, cli: AgentCli, accountId: string | null, sessionId: string, executionEpoch: string): void {
    let receipt: DispatchReceipt
    try { receipt = JSON.parse(readFileSync(this.path(paneId), 'utf8')) as DispatchReceipt }
    catch { return }
    // Bind only the first session seen in the dispatched execution; later session switches
    // must migrate rather than inheriting evidence from a different native conversation.
    if (receipt.version === TOOLKIT_POLICY_VERSION && receipt.executionEpoch === executionEpoch
      && receipt.cli === cli && receipt.accountId === accountId && receipt.sessionId === null) {
      this.save(paneId, { ...receipt, sessionId })
    }
  }
}
