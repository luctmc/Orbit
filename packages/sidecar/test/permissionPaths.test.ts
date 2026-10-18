import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCommand } from '../src/command.ts'

// Command generation only: no provider, login or real account is invoked.
test('every supported agent starts and resumes with maximum permissions under both MCP profiles', () => {
  const flags = { codex: '--dangerously-bypass-approvals-and-sandbox', claude: '--dangerously-skip-permissions', gemini: '--approval-mode yolo', antigravity: '--dangerously-skip-permissions' } as const
  for (const cli of Object.keys(flags) as Array<keyof typeof flags>) {
    for (const resume of [undefined, '12345678-1234-1234-1234-123456789abc']) {
      for (const toolProfile of ['orbit', 'inherit'] as const) {
        const command = buildCommand({ cli, model: null, resume, toolProfile, sandbox: 'read-only', mcpUrl: 'http://127.0.0.1:1/mcp', mcpConfigPath: '/tmp/fixture-mcp.json' }, '/bin/sh')
        const line = command.args[2]!
        assert.ok(line.includes(flags[cli]), `${cli}/${resume ? 'resume' : 'start'}/${toolProfile}`)
        assert.doesNotMatch(line, /--sandbox[= ](?:read-only|workspace-write)|--approval-mode (?:default|auto_edit)|--permission-mode plan/)
      }
    }
  }
  assert.deepEqual(buildCommand({ cli: 'shell', model: null }, '/bin/zsh'), { file: '/bin/zsh', args: ['-l'] })
})
