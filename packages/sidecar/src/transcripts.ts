import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readTail } from './usage.ts'

/** One turn of an agent's conversation, as text. */
export interface Turn {
  role: 'pessoa' | 'agente'
  text: string
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** The text parts of a message's content (a string, or a list of typed parts). */
function textOf(content: unknown, types: string[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((p) => p && types.includes(p.type) && typeof p.text === 'string').map((p) => p.text).join('\n')
}

/** Claude Code keeps a conversation in `<config>/projects/<folder>/<session>.jsonl`. */
export function claudeTranscript(configDir: string, sessionId: string): string | null {
  const root = join(configDir, 'projects')
  if (!existsSync(root)) return null
  for (const folder of readdirSync(root)) {
    const file = join(root, folder, `${sessionId}.jsonl`)
    if (existsSync(file)) return file
  }
  return null
}

/** The last turns of a Claude Code transcript: what the person (or Orbit) said and the agent's answers. */
export function claudeTurns(text: string): Turn[] {
  const turns: Turn[] = []
  for (const line of text.split('\n')) {
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === 'user' && entry.message && !entry.isMeta) {
      const said = textOf(entry.message.content, ['text'])
      if (said.trim() && !said.startsWith('<')) turns.push({ role: 'pessoa', text: said })
    } else if (entry.type === 'assistant' && entry.message) {
      const said = textOf(entry.message.content, ['text'])
      if (said.trim()) turns.push({ role: 'agente', text: said })
    }
  }
  return turns
}

/** The last turns of a Codex session file (its `response_item` messages). */
export function codexTurns(text: string): Turn[] {
  const turns: Turn[] = []
  for (const line of text.split('\n')) {
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const item = entry.type === 'response_item' ? entry.payload : null
    if (item?.type !== 'message') continue
    const said = textOf(item.content, ['input_text', 'output_text', 'text'])
    // Codex puts its own context (instructions, environment) in user messages wrapped in tags.
    if (!said.trim() || said.trimStart().startsWith('<')) continue
    turns.push({ role: item.role === 'assistant' ? 'agente' : 'pessoa', text: said })
  }
  return turns
}

/** Orbit's own role instructions and briefings, which the CLI logs as a first user message. */
const ORBIT_PREAMBLE = /Orbit exposes an MCP server named "orbit"|^# Mission briefing|^You are (the lead|a helper|the )/

/** The end of a conversation as Markdown, within a size budget (newest turns kept). */
export function turnsMarkdown(turns: Turn[], budget = 12_000, perTurn = 1_500): string {
  const out: string[] = []
  let used = 0
  for (const turn of [...turns].reverse()) {
    if (turn.role === 'pessoa' && ORBIT_PREAMBLE.test(turn.text)) continue
    const block = `**${turn.role === 'agente' ? 'Lead' : 'To the lead'}:** ${clip(turn.text.trim(), perTurn)}`
    if (used + block.length > budget) break
    out.unshift(block)
    used += block.length
  }
  return out.join('\n\n')
}

/** Deletes a Claude Code conversation: its transcript and the folder of its subagents and tool output. */
export function deleteClaudeConversation(configDir: string, sessionId: string): boolean {
  const file = claudeTranscript(configDir, sessionId)
  if (!file) return false
  rmSync(file, { force: true })
  rmSync(file.replace(/\.jsonl$/, ''), { recursive: true, force: true })
  return true
}

/** The end of a session file, read from its tail (large files are not read whole). */
export function tailTurns(path: string, parse: (text: string) => Turn[]): Turn[] {
  try {
    return parse(readTail(path, 512 * 1024))
  } catch {
    return []
  }
}
