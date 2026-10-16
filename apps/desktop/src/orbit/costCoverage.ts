/** Keep the known subtotal without claiming coverage for unreported cost. */
export function sumCost(entries: Array<{ costUsd: number | null; costComplete?: boolean }>) {
  const known = entries.filter(e => e.costUsd !== null)
  return {
    costUsd: known.length ? Math.round(known.reduce((sum, e) => sum + e.costUsd!, 0) * 1e6) / 1e6 : null,
    costComplete: entries.length > 0 && entries.every(e => e.costUsd !== null && e.costComplete === true),
  }
}
