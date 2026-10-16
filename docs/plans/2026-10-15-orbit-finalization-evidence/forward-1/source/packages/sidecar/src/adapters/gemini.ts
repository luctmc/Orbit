import { fromGeminiHook, toGeminiHook, type HookPayload } from '../hooks.ts'
import { claudeHook } from './claude.ts'
import { record } from './types.ts'

export function geminiHook(value: unknown) {
  return claudeHook(fromGeminiHook((record(value) ?? {}) as HookPayload))
}
export const geminiAnswer = toGeminiHook
