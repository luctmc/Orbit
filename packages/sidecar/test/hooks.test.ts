import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusFromHook } from '../src/hooks.ts'

test('tool and prompt events mean the agent is working', () => {
  assert.deepEqual(statusFromHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }), { status: 'running', attention: null })
  assert.deepEqual(statusFromHook({ hook_event_name: 'UserPromptSubmit' }), { status: 'running', attention: null })
})

test('a permission notification asks for the human', () => {
  assert.deepEqual(
    statusFromHook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }),
    { status: 'waiting', attention: 'Claude needs your permission to use Bash' },
  )
})

test('the idle reminder and Stop only end the turn', () => {
  assert.deepEqual(statusFromHook({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }), { status: 'idle', attention: null })
  assert.deepEqual(statusFromHook({ hook_event_name: 'Stop' }), { status: 'idle', attention: null })
})

test('unknown events are ignored', () => {
  assert.equal(statusFromHook({ hook_event_name: 'SessionEnd' }), null)
  assert.equal(statusFromHook({}), null)
})
