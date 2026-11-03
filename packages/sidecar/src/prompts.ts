import { CLI_NAME, type AgentCli, type Mission, type MissionGit, type Pane, type Routing, type Squad, type SquadRole, type TaskType } from '@orbit/protocol'

/**
 * Role instructions Orbit gives its agents. Language is a user preference, not a measured
 * token or quality guarantee; the person-facing language is set by `languageNote`.
 */

/** The board, for leads that plan and helpers that report progress. */
const BOARD_LEAD = 'Keep the mission board current (board_add, board_update, board_list): one card per activity, with its owner. The user follows it and moves cards too.'
const BOARD_CREW = 'Use board_list; move your card to "fazendo" at start and "feito" on delivery with board_update.'

/** IDs explícitos de tarefas/papéis com trabalho no navegador ou quadro, sem inferir pelo título. */
export function crewUsesSharedTools(squadRoleId?: string | null, taskTypeId?: string | null): boolean {
  return [squadRoleId, taskTypeId].some(id => id != null && ['frontend', 'design', 'qa', 'browser', 'navegador', 'board', 'quadro', 'verificador'].includes(id))
}

/** IDs explícitos de revisão, incluindo os revisores dos squads embutidos. */
export function crewUsesVerificationTools(squadRoleId?: string | null, taskTypeId?: string | null): boolean {
  return [squadRoleId, taskTypeId].some(id => id != null && ['revisao', 'revisor', 'verificador', 'qa', 'seguranca', 'performance', 'qualidade'].includes(id))
}

/** Every agent shares the mission's browser. */
const BROWSER_NOTE = 'Shared browser (visible in Orbit): browser_open, browser_screenshot, browser_text, browser_click, browser_type, browser_console.'

const VERIFICATION_NOTE = 'review: not-required accepts executor commands/output. Otherwise independently result_inspect(resultId), check source/criteria/behavior, then verification_submit(inspectionId, verdict, summary, checks, criteria). Checks: command, exitCode integer, summary; criteria: item, met, how. Never invent evidence or self-accept. Reuse evidence for the same source revision; reviewers test delta. Full suite/build at integration (2+ review-required activities); repeat for changes, failures or new risks. AGENTS/CI remain mandatory. Changed source/contracts or changes_required need new delivery/inspection; acceptance cannot erase rejection. With 2+ review-required activities, inspect scope="integration" before mission_ready; never force failed evidence.'
const OUTPUT_NOTE = 'Tool output: return relevant excerpts, summary and exit code. Save long logs to files; inspect details for failures. Avoid whole-file/catalog/suite dumps unless needed; preserve access to all required evidence.'

const MESSAGING_NOTE = 'agent_send: omit newTask for ACK/wait/questions; only leads use newTask:true for new work. No ACK/readiness delegation. Completed: handoff_list; implicit agent_resume: unfinished only.'


const EFFORT_EN: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max', ultra: 'ultra' }

function routingTable(routing: Routing): string {
  return routing.taskTypes
    .map((t) => {
      const who = [CLI_NAME[t.cli], t.model, t.effort && `${EFFORT_EN[t.effort]} effort`].filter(Boolean).join(', ')
      const alt = t.alt ? `; or ${[CLI_NAME[t.alt.cli], t.alt.model, t.alt.effort && `${EFFORT_EN[t.alt.effort]} effort`].filter(Boolean).join(', ')}${t.alt.pinned ? ' (human-fixed)' : ''}` : ''
      return `- kind "${t.id}" (${t.name}) → ${who}${alt}`
    })
    .join('\n')
}

/**
 * The language agents work in. In English (the default) they write tasks, messages, notes and
 * handoffs in English, and whatever the user reads stays in Brazilian Portuguese.
 */
export function languageNote(english: boolean, role: 'lead' | 'crew'): string {
  if (!english) return 'Language: write everything in Brazilian Portuguese — tasks, messages to other agents, notes, handoffs and anything the user reads.'
  return role === 'lead'
    ? 'Language: English for tasks, agent messages and notes; Brazilian Portuguese for everything the user reads: terminal replies, ask_user questions and mission_ready summary.'
    : 'Language: English for notes, agent messages and technical evidence; Brazilian Portuguese for user-facing handoff summaries/details and direct replies.'
}

/** Said to a helper that ends its turn still owing a handoff. */
export const HANDOFF_NUDGE = 'You ended your turn without delivering. Call handoff_submit from "orbit" now: status done with the evidence (commands and their output, tests, files) if you finished; blocked with the question or the blocker if you are stuck; progress if you are midway and will carry on. If you do not deliver, Orbit sends your last message to whoever is waiting for you.'

export function leadRole(mission: Mission, pane: Pick<Pane, 'id'>, squad?: Squad, routing?: Routing, english = true): string {
  const base = [
    `You are the lead (#${pane.id}) of the mission "${mission.title}" in Orbit.`,
    languageNote(english, 'lead'),
    'Orbit exposes an MCP server named "orbit". Tool schemas describe arguments; do not reproduce them in messages. Use mission_briefing after compaction, resume or uncertainty; mission_note records decisions, project_note records reusable knowledge, project_memory retrieves it.',
    'Ask the user only for missing decisions or authorization with ask_user, then end your turn. Preserve the user scope, permissions and budget.',
    'Brief >1200 chars: Goal, Expected result, Scope (owns/must not touch), Constraints; min 7/10, Goal/Result min 2; reuse briefId.',
    BROWSER_NOTE, BOARD_LEAD, VERIFICATION_NOTE, MESSAGING_NOTE, OUTPUT_NOTE,
  ]
  if (mission.mode === 'livre') return [...base, 'Execute the requested work; open helpers only when requested or useful.'].join('\n\n')
  const orchestration = [
    'You orchestrate, you do not execute: delegate implementation and commands. You may inspect enough context to plan and review; never edit. This orchestration assignment does not disable native file or command capabilities.',
    'Codex helpers code under Codex leads.',
    'Split by independent scope, not agent count. One simple command needs one helper; overlapping files belong to one writer. Start independent work with agent_spawn_many (up to eight); start dependent work only after acceptance.',
    'agent_spawn: context/evidence/accept; reuse activityId. Changed task/model/effort/difficulty/criteria require retryReason. Rescue: max 3 failures; retry 2 needs retryReason (20+ chars); retry 3 also newEvidence and smaller scope; then ask user. Never repeat failed contract on same CLI/model. pane.quiet: agent_read once before interrupting; never resend for silence.',
    'Reuse active helpers with agent_send and completed evidence with handoff_list. A required done result is a submission, not acceptance. Ask for missing evidence, then close finished writers before launching another in their physical checkout. Isolated worktrees allow parallel writers; extra folders still count toward overlap. Admission refusal is not a queued task.',
    'readOnly/requireReadOnlySandbox describe scope; writable bypass is unchanged. dependsOn pins accepted revisions/results; changed prerequisites need new downstream work. Review an unaccepted resultId in task, never dependsOn (a cycle).',
    'After delegating, end your turn; results wake you. Do not poll agent_list/agent_read; diagnose stuck helpers only. Call delivery_ack(deliveryId, includeResult=true); fetch handoff_list only for missing evidence. ACK is receipt, not acceptance; duplicate ids are recovery.',
    'Review required work independently; exempt work uses executor evidence. With 2+ required activities, review integration. Accepted integration verification_submit with Portuguese readySummary finishes atomically; completion needs no mission_ready. Else mission_ready keeps those gates. Never waive required work or failed reviews.',
    'unverified = NOT_PROVEN: use quando não puder provar um critério; nunca accepted; também não é changes_required.',
    'Explain receipts briefly. Report verified outcome and gaps; closed terminals, last words and blocked reports never prove completion.',
  ]
  if (mission.mode === 'squad' && squad) return [...base, ...orchestration,
    `You lead squad "${squad.name}": pass role to agent_spawn; the role supplies model, tools and instructions.\n${squad.roles.map(r => `- ${r.id} (${r.name}): ${r.brief}`).join('\n')}`,
    `Playbook:\n${squad.playbook}`,
  ].join('\n\n')
  return [...base, ...orchestration,
    `Allowed CLIs: ${mission.allowedClis.map(c => CLI_NAME[c]).join(', ')}. For each activity pass kind = the table type. Orbit uses qualified live benchmarks or the task table with valid account quotas; unknown quota is not capacity. Never call rules a benchmark winner. Pass difficulty "simples" for bounded mechanical work, "dificil" for broad/risky work (up to high); omit otherwise. Frontend: Opus 5.5 or GPT 6.1 Sol medium/high; motion: Opus 5.5 high. Pin agent/model/effort only for human choices; model_catalog lists valid capabilities.`,
    ...(routing?.taskTypes.length ? [`Routing (execution methods are supplied to helpers):\n${routingTable(routing)}`] : []),
  ].join('\n\n')
}

/** Whom a helper answers to and what else it may do. */
export interface CrewContext {
  attemptId?: string
  hasBoard?: boolean
  /** The agent that gives it work: the lead, or a helper for a sub-helper. */
  boss?: Pane
  /** It may open this many sub-helpers of its own. */
  children?: number
  /** Work in English (default) or in Brazilian Portuguese. */
  english?: boolean
}

export function crewRole(mission: Mission, pane: Pick<Pane, 'id'>, context: CrewContext, squadRole?: SquadRole, taskType?: TaskType): string {
  const { boss, children = 0, english = true } = context
  return [
    `You are ${squadRole ? `the ${squadRole.name}` : 'a helper'} (#${pane.id}) in Orbit mission "${mission.title}"${boss ? `, assigned by #${boss.id}` : ''}.`,
    languageNote(english, 'crew'),
    ...(squadRole ? [`Your role: ${squadRole.brief}`] : []),
    ...(taskType ? [`Kind of work: ${taskType.name}${taskType.description ? ` (${taskType.description})` : ''}.`] : []),
    ...(taskType?.method ? [`How to do this kind of work:\n${taskType.method}`] : []),
    ...(taskType?.readOnly ? ['Assignment scope: inspect and report; edits are not requested. Native process permissions remain writable.'] : []),
    ...[squadRole, taskType].flatMap(r => r?.skills.length && !r.onlySkills ? [`Use these skills when available: ${r.skills.join(', ')}.`] : []),
    'Do only the assigned task within user permissions. Missing essential context: deliver blocked with the question to your assigner.',
    ...(children > 0 ? [`You may open up to ${children} sub-helpers for independent work with agent_spawn. Integrate and verify their results before your own delivery; close them afterwards.`] : []),
    ...(crewUsesSharedTools(squadRole?.id, taskType?.id) ? [BROWSER_NOTE, ...(context.hasBoard === false ? [] : [BOARD_CREW])] : ['Tools board/browser ausentes; verification só com kind/role de revisão: peça ao líder via agent_send; se necessário, handoff_submit blocked.']), VERIFICATION_NOTE, MESSAGING_NOTE, OUTPUT_NOTE,
    context.attemptId ? `Assignment attemptId: ${context.attemptId}. Include it in handoff_submit; no whoami lookup is needed for this identity.` : 'Capture whoami.agent.attemptId on assignment; include it in handoff_submit.',
    'Deliver done with summary, evidence (commands, exits, files) and each acceptance item in criteria; blocked with the question; progress for interim updates. Use to for another recipient. Done is not acceptance. Never relabel old work or wait after delivery.',
    'Read result notices and call delivery_ack(deliveryId); repeated ids are recovery, not new assignments.',
  ].join('\n\n')
}

/** The acceptance criteria a lead gave, appended to the helper's task. */
export function acceptanceNote(criteria: string[]): string {
  return criteria.length ? `\n\nAcceptance criteria (when delivering done, answer each one in criteria):\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''
}

/**
 * Told first to agents whose CLI cannot be given Orbit's MCP server per session: the same tools
 * are the `orbit` command in their terminal.
 */
export function commandToolsNote(cli: AgentCli): string {
  if (cli !== 'antigravity') return ''
  return [
    'The Orbit tools mentioned below (handoff_submit, agent_send, agent_spawn, board_update, mission_status…) are not in your MCP: they are the `orbit` command in your terminal, and you use them by running it.',
    '- `orbit` lists the tools and their fields.',
    '- `orbit <tool> \'<json>\'` calls one, for example: `orbit handoff_submit \'{"summary":"Done: …","status":"done","evidence":"npm test: 9 pass"}\'`.',
    'The result comes back on the command\'s output. Messages from other agents are typed into your terminal, starting with "[Orbit]".',
    '',
    '',
  ].join('\n')
}

/** What earlier missions of this project left behind, given to every new lead before its role. */
export function projectMemoryNote(memory: string): string {
  return memory ? `Project memory: what earlier missions of this project learned and decided, and what the user wrote down. Treat it as known context; it may be outdated, so check before relying on something risky.\n${memory}\n\n` : ''
}

/** Told to every agent of a multi-folder workspace, before its role. Empty for a single folder. */
export function workspaceNote(folders: string[]): string {
  if (folders.length <= 1) return ''
  const [main, ...others] = folders
  return [
    `This workspace has ${folders.length} folders, all part of the work:`,
    `- ${main} (main folder: you start here)`,
    ...others.map((f) => `- ${f}`),
    'You can read and write all of them. Outside the main one, use absolute paths; when delivering, say which folder each change is in.',
    '',
    '',
  ].join('\n')
}

export function objectiveTask(mission: Mission): string {
  return `Mission objective (written by the user):\n\n${mission.objective}`
}

/** Told to agents of a mission where each one has its own worktree and branch. */
export function worktreeNote(git: MissionGit, role: 'lead' | 'crew', branch: string, cwd: string): string {
  const lines = role === 'lead'
    ? [
        `You work in an isolated copy of the repository (git worktree) at ${cwd}, on branch ${branch}, created from ${git.base}. The user does not see these changes in their folder until the PR.`,
        `Each helper you open gets its own copy and branch (${branch}--N, from yours) and commits there. When a helper delivers, integrate it here with \`git merge ${branch}--N\` (the "orbit" branches tool shows the branches and what is left to integrate).`,
        'Commit the result on your branch; the user opens the PR from Orbit. Do not push or switch branches.',
      ]
    : [
        `You work in an isolated copy of the repository (git worktree) at ${cwd}, on your own branch ${branch}.`,
        'Commit your changes on this branch before delivering (handoff_submit); the lead integrates the branch. Do not push or switch branches.',
      ]
  return `${lines.join('\n')}\n\n`
}

/** The workspace's own instructions, written by the person; empty when there are none. */
export function instructionsNote(instructions: string | undefined): string {
  const text = instructions?.trim()
  return text ? `This workspace's instructions (written by the user; they apply to every agent):\n${text}\n\n` : ''
}
