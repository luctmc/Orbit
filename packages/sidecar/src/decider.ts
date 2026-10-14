import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskType } from '@orbit/protocol'
import type { Run } from './clis.ts'
import { shellQuote } from './command.ts'

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
    'Você classifica atividades de programação para escolher quem as faz. Responda só com o JSON pedido.',
    'Tipos (id: quando se aplica):',
    ...types.map((t) => `- ${t.id}: ${t.name}${t.description ? `. ${t.description}` : ''}`),
    '',
    'Atividade:',
    text.slice(0, 4000),
  ].join('\n')
}

export function decisionSchema(types: TaskType[]): string {
  return JSON.stringify({
    type: 'object',
    properties: { kind: { type: 'string', enum: types.map((t) => t.id) }, why: { type: 'string', description: 'Uma frase curta' } },
    required: ['kind', 'why'],
  })
}

/** The type the model chose, from Claude's `--output-format json` reply; null if unusable. */
export function parseDecision(stdout: string, types: TaskType[]): { type: TaskType; why: string } | null {
  try {
    const reply = JSON.parse(stdout)
    if (reply.is_error) return null
    const out = reply.structured_output ?? JSON.parse(String(reply.result ?? ''))
    const type = types.find((t) => t.id === out?.kind)
    return type ? { type, why: String(out.why ?? '').trim().slice(0, 200) } : null
  } catch {
    return null
  }
}

export async function decideTaskType(run: Run, dir: string, text: string, types: TaskType[]): Promise<{ type: TaskType; why: string } | null> {
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
  try {
    const { code, stdout } = await run(command, TIMEOUT_MS)
    return code === 0 ? parseDecision(stdout, types) : null
  } finally {
    rmSync(file, { force: true })
  }
}
