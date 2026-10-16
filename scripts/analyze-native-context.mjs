// Reads only sessions explicitly retained in a run. Emits sizes/counts/hashes, never transcript
// content, prompts, connection URLs, headers, credentials, or tool inputs. No CLI/model calls.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { claudeTranscript } from '../packages/sidecar/src/transcripts.ts'

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
if (!args.includes('--run') || args.includes('--help')) {
  console.log('node scripts/analyze-native-context.mjs --run RETAINED_RUN.json [--claude-dir DIRECTORY] [--out NEW_FILE.json]\nMetadata only: catalog/instruction bytes, tool counts and provider-reported response usage. No model calls or token estimates.')
  process.exit(0)
}
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null))
const hash = value => createHash('sha256').update(value).digest('hex')
const runPath = resolve(option('--run')), runRaw = readFileSync(runPath), run = JSON.parse(runRaw)
const configDir = args.includes('--claude-dir') ? resolve(option('--claude-dir')) : process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
const sessions = []
// Completed helpers may be removed from the live pane list during shutdown. Their explicitly
// retained activity attempts still identify the session; never search unrelated conversations.
const retained = [...(run.panes ?? []), ...(run.history?.attempts ?? []).map(a => ({ id: a.paneId, cli: a.cli, sessionId: a.sessionId, role: 'crew' }))]
const seenSessions = new Set()
for (const pane of retained) {
  if (pane.cli !== 'claude' || !pane.sessionId) continue
  if (seenSessions.has(pane.sessionId)) continue
  seenSessions.add(pane.sessionId)
  const path = claudeTranscript(configDir, pane.sessionId)
  if (!path || !existsSync(path)) { sessions.push({ paneId: pane.id, role: pane.role, found: false }); continue }
  const raw = readFileSync(path), rows = raw.toString('utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  const tools = {}, responseUsage = new Map(), attachments = [], externalServers = new Set(), called = new Set()
  for (const row of rows) {
    const message = row.message
    if (row.type === 'assistant' && message?.id && message.usage) responseUsage.set(message.id, {
      input: (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0), output: message.usage.output_tokens ?? null,
    })
    if (row.type === 'assistant' && Array.isArray(message?.content)) for (const block of message.content) if (block.type === 'tool_use' && typeof block.name === 'string') {
      tools[block.name] = (tools[block.name] ?? 0) + 1
      if (block.name.startsWith('mcp__') && block.name.split('__')[1] !== 'orbit') called.add(block.name.split('__')[1])
    }
    const a = row.type === 'attachment' && row.attachment
    if (!a) continue
    if (a.type === 'skill_listing') attachments.push({ type: a.type, count: a.skillCount ?? null, contentBytes: bytes(a.content ?? '') })
    if (a.type === 'agent_listing_delta') attachments.push({ type: a.type, count: a.addedTypes?.length ?? null, contentBytes: bytes(a.addedLines ?? []) })
    if (a.type === 'prompt_snapshot' && a.tools) attachments.push({ type: a.type, toolCount: a.tools.length, toolSchemaBytes: bytes(a.tools), systemPromptBytes: bytes(a.systemPrompt) })
    if (a.type === 'mcp_instructions_delta') attachments.push({ type: a.type, serverCount: a.addedNames?.length ?? 0, contentBytes: bytes(a.addedBlocks ?? []) })
    if (a.type === 'deferred_tools_delta') {
      const prefixes = {}
      for (const name of [...(a.addedNames ?? []), ...(a.surfacedNames ?? [])]) {
        if (typeof name !== 'string') continue
        const prefix = name.startsWith('mcp__') ? name.split('__')[1] : 'native'
        prefixes[prefix] = (prefixes[prefix] ?? 0) + 1
        if (prefix !== 'native' && prefix !== 'orbit') externalServers.add(prefix)
      }
      attachments.push({ type: a.type, prefixes, definitionBytes: bytes(a.surfacedDefinitions ?? []), surfacedCount: a.surfacedNames?.length ?? 0 })
    }
  }
  sessions.push({ paneId: pane.id, role: pane.role, found: true, sessionId: pane.sessionId, transcriptSha256: hash(raw), responses: responseUsage.size, responseUsage: [...responseUsage.values()], tools, externalServersDiscovered: [...externalServers].sort(), externalServersCalled: [...called].sort(), attachments })
}
const output = { version: 1, runSha256: hash(runRaw), unit: 'utf8-bytes and provider-reported tokens (separate units)', modelCalls: 0, tokenSavings: null, sessions,
  limits: ['Claude transcript attachments are provider-version-specific; absent fields remain absent', 'Attachment snapshots/deltas overlap: never sum their bytes as unique context', 'Provider usage is deduplicated by response id; this is not a counterfactual token-savings estimate', 'Codex context and external account sessions are not inferred from unrelated files'] }
if (args.includes('--out')) {
  const path = resolve(option('--out'))
  if (existsSync(path)) throw new Error('Output must be new; retain previous observations')
  writeFileSync(path, JSON.stringify(output, null, 2) + '\n', { mode: 0o600 })
} else console.log(JSON.stringify(output, null, 2))
