import { codexLastTurn, fromCodexRollout } from '../usage.ts'

export interface TurnCursor { id: string; at: number; seenIds?: string[] }
export function codexRollout(text: string) {
  const report = fromCodexRollout(text)
  const turn = codexLastTurn(text)
  return { report, turn, recognized: report.usage !== null || report.limits !== null || turn !== null }
}

/** Unknown timestamps do not authorize a turn transition in a resumed conversation. */
export function freshCodexTurn(turn: TurnCursor | null, since: number, previous?: TurnCursor): boolean {
  return !!turn && turn.at >= since && turn.at > 0 && (!previous || (turn.at >= previous.at && !(previous.seenIds ?? [previous.id]).includes(turn.id)))
}
