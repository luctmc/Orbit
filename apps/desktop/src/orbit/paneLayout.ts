export type Layout = 'grade' | 'foco'
export type Columns = 'auto' | '1' | '2' | '3'

/** Compare identities, not counts: duplicate, replacements and batched spawns all reveal the crew. */
export function hasNewPanes(previous: readonly number[], next: readonly number[]): boolean {
  const known = new Set(previous)
  return next.some(id => !known.has(id))
}

export function selectedAfterRemoval(previous: readonly number[], next: readonly number[], selected: number | null): number | null {
  if (selected !== null && next.includes(selected)) return selected
  const at = selected === null ? 0 : Math.max(0, previous.indexOf(selected))
  return next[Math.min(at, next.length - 1)] ?? null
}

export function gridColumns(width: number, count: number, preference: Columns): number {
  // Available container space, including side panels, is what matters, not the viewport.
  const capacity = Math.max(1, Math.floor((width + 12) / 332))
  return Math.max(1, Math.min(count, capacity, preference === 'auto' ? 3 : Number(preference)))
}

export function trackSizes(saved: unknown, count: number): number[] {
  if (!Array.isArray(saved) || saved.length !== count || saved.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) return Array(count).fill(1)
  // Do not let stale/corrupt storage create unusably small tracks.
  const total = saved.reduce((sum, v) => sum + v, 0)
  return saved.map(v => Math.max(.25, Math.min(4, v / total * count)))
}

/** Resize only the two neighbours, retaining their combined space and a physical minimum. */
export function resizeTracks(sizes: readonly number[], index: number, delta: number, available: number, minimum: number): number[] {
  if (!sizes[index + 1] || available <= 0) return [...sizes]
  const total = sizes.reduce((sum, value) => sum + value, 0)
  const pair = sizes[index]! + sizes[index + 1]!
  const floor = Math.min(pair / 2, minimum / available * total)
  const left = Math.max(floor, Math.min(pair - floor, sizes[index]! + delta / available * total))
  return sizes.map((value, at) => at === index ? left : at === index + 1 ? pair - left : value)
}

/** Fit remembered proportions into a smaller window while keeping every terminal usable. */
export function fitTracks(sizes: readonly number[], available: number, minimum: number): number[] {
  if (available <= 0 || sizes.length < 2) return [...sizes]
  const floor = Math.min(minimum, available / sizes.length)
  const result = Array<number>(sizes.length).fill(0)
  let remaining = available
  let flexible = sizes.map((_, index) => index)
  while (flexible.length) {
    const total = flexible.reduce((sum, index) => sum + sizes[index]!, 0)
    const small = flexible.filter(index => sizes[index]! / total * remaining < floor)
    if (!small.length) {
      for (const index of flexible) result[index] = sizes[index]! / total * remaining
      break
    }
    for (const index of small) { result[index] = floor; remaining -= floor }
    flexible = flexible.filter(index => !small.includes(index))
  }
  return result.map(value => value / available * sizes.length)
}
