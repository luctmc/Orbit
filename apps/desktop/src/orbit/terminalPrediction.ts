import { inlineSuggestion, type InputSuggestion, type InlineSuggestion } from './inputSuggestions.ts'
import type { PaneStatus } from '@orbit/protocol'

/** Codex output, including a typed character's echo, may heuristically mark the pane running. */
export const terminalPredictionReady = (status: PaneStatus) => status === 'idle' || status === 'running'

/** Only visible text preceding the cursor, not the terminal transcript or another session. */
export interface PromptCursor { row: number; column: number; before: string; after: string; selected?: boolean }
const emptyPrompt = (cursor: PromptCursor) => /^\s*[❯›>]\s*$/u.test(cursor.before) && !cursor.after.trim()
// Observed native placeholders (Codex 0.162.1 / Claude Code 2.1.296) disappear on
// the first character. Accept an anchor there, but never draw over a placeholder.
const draftStart = (cursor: PromptCursor) => emptyPrompt(cursor)
  || /^\s*›\s*$/u.test(cursor.before) && cursor.after.trim() === 'Ask Codex to do anything'
  || /^\s*❯\s*$/u.test(cursor.before) && /^Try "[^"\p{Cc}\p{Cf}]{1,120}"$/u.test(cursor.after.trim())

/** Fail closed on controls, cursor motion, multiline/paste escapes or a changed prompt. */
export class TerminalPrediction {
  private text = ''
  private anchor: PromptCursor | null = null
  private suspended = false
  private dismissed: string | null = null

  reset() { this.text = ''; this.anchor = null; this.suspended = false; this.dismissed = null }
  dismiss() { this.dismissed = this.text }

  input(data: string, cursor: PromptCursor) {
    // xterm sends focus and cursor-position replies through onData too. These are
    // transport reports, not edits or cursor movement requested by the person.
    if (/^\x1b\[(?:[IO]|\d+;\d+R)$/u.test(data)) return
    if (data === '\r' || data === '\n' || data === '\u0003') { this.reset(); return }
    if (this.suspended) return
    if (data === '\u007f' || data === '\b') {
      if (!this.text) { this.suspended = true; return }
      this.text = Array.from(this.text).slice(0, -1).join(''); this.dismissed = null
      return
    }
    if (!data || /[\p{Cc}\p{Cf}]/u.test(data) || this.text.length + data.length > 512) { this.suspended = true; return }
    if (!this.anchor) {
      if (!draftStart(cursor)) { this.suspended = true; return }
      this.anchor = { ...cursor }
    }
    this.text += data; this.dismissed = null
  }

  prediction(candidates: InputSuggestion[], cursor: PromptCursor): InlineSuggestion | null {
    if (cursor.selected || this.suspended || this.dismissed === this.text) return null
    if (!this.text) return emptyPrompt(cursor) ? inlineSuggestion('', candidates) : null
    if (!this.anchor || cursor.row !== this.anchor.row || cursor.column < this.anchor.column || cursor.before !== this.anchor.before + this.text || cursor.after.trim()) return null
    return inlineSuggestion(this.text, candidates)
  }
}
