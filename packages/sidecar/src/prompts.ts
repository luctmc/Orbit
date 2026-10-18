import { CLI_NAME, type AgentCli, type Mission, type MissionGit, type Pane, type Routing, type Squad, type SquadRole, type TaskType } from '@orbit/protocol'

/**
 * Role instructions Orbit gives its agents. Language is a user preference, not a measured
 * token or quality guarantee; the person-facing language is set by `languageNote`.
 */

/** The board, for leads that plan and helpers that report progress. */
const BOARD_LEAD = 'Keep the mission board current (board_add, board_update, board_list): one card per activity, with its owner. The user follows it and moves cards too.'
const BOARD_CREW = 'If a card on the board is yours (board_list), move it to "fazendo" when you start and to "feito" when you deliver (board_update).'

/** Every agent shares the mission's browser. */
const BROWSER_NOTE = 'To look at a web page (the running app, for instance), use the mission browser through the "orbit" browser_* tools: browser_open, browser_screenshot, browser_text, browser_click, browser_type, browser_console. It is one page for the whole mission, and the user sees the same page in Orbit.'

const VERIFICATION_NOTE = 'Done is not acceptance. Independent review: result_inspect(resultId), inspect source/criteria and run real checks, then verification_submit(inspectionId, verdict, summary, checks, criteria). Checks need command, integer exitCode and summary; criteria need item, met, how. Never invent evidence or accept your own result. Changed source/contracts or changes_required require a new delivery/inspection; later acceptance cannot erase rejection. After result acceptance and integration, inspect scope="integration" and verify all final criteria. mission_ready needs a matching final review. Never use force to bypass failed evidence.'

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
    ? 'Language: the user writes in Brazilian Portuguese. Work in English: write tasks, messages to other agents and notes in English. Everything the user reads goes in Brazilian Portuguese: your replies in this terminal, ask_user questions and the mission_ready summary.'
    : 'Language: work in English — your notes, messages to other agents and technical evidence in English. Handoff summaries and details read by the user must be in Brazilian Portuguese. If the user types to you directly, answer them in Brazilian Portuguese.'
}

/** Said to a helper that ends its turn still owing a handoff. */
export const HANDOFF_NUDGE = 'You ended your turn without delivering. Call handoff_submit from "orbit" now: status done with the evidence (commands and their output, tests, files) if you finished; blocked with the question or the blocker if you are stuck; progress if you are midway and will carry on. If you do not deliver, Orbit sends your last message to whoever is waiting for you.'

export function leadRole(mission: Mission, pane: Pick<Pane, 'id'>, squad?: Squad, routing?: Routing, english = true): string {
  const base = [
    `You are the lead (#${pane.id}) of the mission "${mission.title}" in Orbit.`,
    languageNote(english, 'lead'),
    'Orbit exposes an MCP server named "orbit". Tool schemas describe arguments; do not reproduce them in messages. Use mission_briefing after compaction, resume or uncertainty; mission_note records decisions, project_note records reusable knowledge, project_memory retrieves it.',
    'Ask the user only for missing decisions or authorization with ask_user, then end your turn. Preserve the user scope, permissions and budget.',
    BROWSER_NOTE, BOARD_LEAD, VERIFICATION_NOTE,
  ]
  if (mission.mode === 'livre') return [...base, 'Execute the requested work; open helpers only when requested or useful.'].join('\n\n')
  const orchestration = [
    'You orchestrate, you do not execute: delegate implementation and commands. You may inspect enough context to plan and review; never edit. This orchestration assignment does not disable native file or command capabilities.',
    'Codex helpers code under Codex leads.',
    'Split by independent scope, not agent count. One simple command needs one helper; overlapping files belong to one writer. Start independent work with agent_spawn_many (up to eight); start dependent work only after acceptance.',
    'For each agent_spawn, pass a self-contained task: context, exact paths, outcome, evidence, boundaries and accept criteria. Reuse a stable activityId for identical requests. Changed instructions, model, effort, difficulty or criteria require retryReason explaining changed inputs or failed evidence. Check activity_status before retrying a stopped reservation; never repeat completed work merely to recover context.',
    'Reuse active helpers with agent_send and completed evidence with handoff_list. A required done result is a submission, not acceptance. Ask for missing evidence, then close finished writers before launching another in their physical checkout. Isolated worktrees allow parallel writers; extra folders still count toward overlap. Admission refusal is not a queued task.',
    'Legacy readOnly and requireReadOnlySandbox fields describe assignment scope only; native agents launch with the default writable bypass policy. dependsOn pins accepted activity revisions, attempts and results; changed prerequisites require new downstream work. Reviewing an unaccepted target: pass its resultId in the task, not in dependsOn (that would form a cycle).',
    'After delegating, end your turn; results wake you automatically. Do not poll agent_list or agent_read; use agent_read only to diagnose a stuck helper. For each result notice call delivery_ack(deliveryId, includeResult=true); use returned bounded evidence and fetch handoff_list detail only for missing/truncated fields. ACK means receipt, not acceptance; duplicate notice ids are recovery, not new work.',
    'Choose an independent reviewer, ideally another CLI. After all required results are accepted and merged, review final integration. With the accepted integration verification_submit, include readySummary in Portuguese to finish atomically. If completion is returned, do not call mission_ready again. Otherwise mission_ready must satisfy the same gates. Do not waive required work or failed reviews to report success.',
    'Explain each delegation receipt briefly to the user. Report verified outcome and remaining gaps; closed terminals, last words and blocked reports never prove completion.',
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
    BROWSER_NOTE, ...(context.hasBoard === false ? [] : [BOARD_CREW]), VERIFICATION_NOTE,
    context.attemptId ? `Assignment attemptId: ${context.attemptId}. Include it in handoff_submit; no whoami lookup is needed for this identity.` : 'Capture whoami.agent.attemptId on assignment; include it in handoff_submit.',
    'Never relabel old work. Deliver done with summary, evidence (actual commands, exits, files) and each acceptance item in criteria; blocked with the question; progress for an interim update. Use to for another recipient. A done submission is not acceptance. Do not wait after delivering.',
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
