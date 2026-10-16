import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Difficulty, TaskType } from '@orbit/protocol'
import type { Run } from './clis.ts'
import { shellQuote } from './command.ts'
import { performance } from 'node:perf_hooks'
import { headlessUsage, unknownUsage, type AuxiliaryObservation } from './measurements.ts'

/**
 * The maestro's second opinion: when no keyword says what kind of work an activity is, a small
 * model reads it against the table. It runs Claude headless with nothing of the person's setup
 * (no hooks, no MCP servers, no tools, no saved session), answers in a fixed JSON shape, and on
 * any failure the rule's default stands.
 */

export const DECIDER_MODEL = 'claude-haiku-5-5'
const TIMEOUT_MS = 30_000

export function decisionPrompt(text: string, types: TaskType[]): string {
  return [
    'You classify programming activities to choose who does them. Reply with the requested JSON only.',
    'difficulty: simples (small, obvious change), normal, or dificil (long reasoning, many files, unknown cause, high risk).',
    'Kinds (id: when it applies):',
    ...types.map((t) => `- ${t.id}: ${t.name}${t.description ? `. ${t.description}` : ''}`),
    '',
    'Activity:',
    text.slice(0, 4000),
  ].join('\n')
}

export function decisionSchema(types: TaskType[]): string {
  return JSON.stringify({
    type: 'object',
    properties: { kind: { type: 'string', enum: types.map((t) => t.id) }, difficulty: { type: 'string', enum: ['simples', 'normal', 'dificil'] }, why: { type: 'string', description: 'One short sentence, in Brazilian Portuguese' } },
    required: ['kind', 'difficulty', 'why'],
  })
}

/** The type the model chose, from Claude's `--output-format json` reply; null if unusable. */
export function parseDecision(stdout: string, types: TaskType[]): { type: TaskType; why: string; difficulty: Difficulty } | null {
  try {
    const reply = JSON.parse(stdout)
    if (reply.is_error) return null
    const out = reply.structured_output ?? JSON.parse(String(reply.result ?? ''))
    const type = types.find((t) => t.id === out?.kind)
    const difficulty: Difficulty = out.difficulty === 'simples' || out.difficulty === 'dificil' ? out.difficulty : 'normal'
    return type ? { type, why: String(out.why ?? '').trim().slice(0, 200), difficulty } : null
  } catch {
    return null
  }
}

export async function decideTaskType(run: Run, dir: string, text: string, types: TaskType[], observe?: (value: AuxiliaryObservation) => void): Promise<{ type: TaskType; why: string; difficulty: Difficulty } | null> {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `decisao-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
  writeFileSync(file, decisionPrompt(text, types))
  const command = [
    'claude -p',
    '--model', DECIDER_MODEL,
    '--settings', shellQuote('{"disableAllHooks":true}'),
    '--strict-mcp-config',
    '--tools', '""',
    '--no-session-persistence',
    '--output-format json',
    '--json-schema', shellQuote(decisionSchema(types)),
    `"$(cat ${shellQuote(file)})"`,
    '< /dev/null',
  ].join(' ')
  const started = performance.now()
  let observation: AuxiliaryObservation = { exitCode: null, durationMs: 0, usage: unknownUsage(), reportedModels: [], outcome: 'error' }
  try {
    const { code, stdout } = await run(command, TIMEOUT_MS)
    const parsed = code === 0 ? parseDecision(stdout, types) : null
    const measured = headlessUsage(stdout)
    observation = { ...observation, exitCode: code, usage: measured.usage, reportedModels: measured.models, outcome: code !== 0 ? 'error' : parsed ? 'classified' : 'invalid' }
    return parsed
  } finally {
    rmSync(file, { force: true })
    observe?.({ ...observation, durationMs: performance.now() - started })
  }
}
