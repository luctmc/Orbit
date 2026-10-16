import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '@orbit/protocol'

/**
 * Every test runs with the CLIs pointed at empty folders, never at the person's real Claude,
 * Codex or Gemini data (Orbit reads limits and conversations from there).
 */
export const HOMES = {
  claude: mkdtempSync(join(tmpdir(), 'claude-home-')),
  codex: mkdtempSync(join(tmpdir(), 'codex-home-')),
  gemini: mkdtempSync(join(tmpdir(), 'gemini-home-')),
}
process.env.CLAUDE_CONFIG_DIR = HOMES.claude
process.env.CODEX_HOME = HOMES.codex
process.env.GEMINI_CLI_HOME = HOMES.gemini

export const ORIGIN = 'http://localhost:5273'
export const TOKEN = 'test-token-0123456789'

/** A UI client: collects every server message and waits for matching ones. */
export function connect(port: number, token = TOKEN, origin = ORIGIN) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, { origin })
  const inbox: ServerMessage[] = []
  const waiters: Array<() => void> = []
  ws.on('message', (raw) => {
    inbox.push(JSON.parse(String(raw)) as ServerMessage)
    for (const wake of waiters.splice(0)) wake()
  })
  const next = async <T extends ServerMessage['type']>(type: T, match: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = inbox.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && match(m as Extract<ServerMessage, { type: T }>))
      if (found) return found
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${type}`)
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }
  const send = (message: ClientMessage) => ws.send(JSON.stringify(message))
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  return { ws, inbox, next, send, opened }
}

/** Stand-in for the login shell: no CLI probes or updates leave the test. */
export const offline = async () => ({ code: 127, stdout: '', stderr: 'offline' })

/** Fresh synthetic provider observations; never contact or read the user's accounts. */
export async function seedRoutingQuota(core: import('../src/core.ts').OrbitCore) {
  await core.checkAccounts()
  const now = Date.now()
  const privateCore = core as unknown as { accountStatus: Map<string, import('@orbit/protocol').AccountStatus> }
  for (const a of core.store.accounts()) privateCore.accountStatus.set(a.id, { accountId: a.id, loggedIn: true, checkedAt: now, busy: null, email: null, method: 'synthetic', plan: null, loginPaneId: null, message: null })
  for (const account of core.store.accounts()) core.store.setLimits({ accountId: account.id, cli: account.cli, source: 'provider', fiveHour: { usedPercent: 0, resetsAt: now + 3600000, windowMinutes: 300 }, weekly: null, updatedAt: now, plan: null })
  const state = core as unknown as { catalog: import('@orbit/protocol').Catalog }
  const { CLAUDE_CATALOG } = await import('../src/clis.ts')
  const efforts = ['low', 'medium', 'high'] as const
  state.catalog = { claude: CLAUDE_CATALOG, codex: { source: 'cli', efforts: [...efforts], models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'].map(id => ({ id, label: id, description: '', efforts: [...efforts], defaultEffort: 'medium' })) }, gemini: { source: 'builtin', efforts: [], models: [] }, antigravity: { source: 'builtin', efforts: [], models: [] } }
}
