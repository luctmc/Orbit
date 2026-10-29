/** Deterministic brief admission; no model calls or filesystem effects. */
export function scoreBrief(text: string) {
  const sections = { goal: '', result: '', scope: '', constraints: '' }
  const present = new Set<keyof typeof sections>()
  const names: Record<string, keyof typeof sections> = { goal: 'goal', objetivo: 'goal', 'expected result': 'result', 'resultado esperado': 'result', scope: 'scope', escopo: 'scope', constraints: 'constraints', restrições: 'constraints', restricoes: 'constraints' }
  let current: keyof typeof sections | undefined
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/^\s*#{1,6}\s+/, '').replaceAll('**', '').replace(/\s+#+\s*$/, '').trim()
    const match = /^(goal|objetivo|expected result|resultado esperado|scope|escopo|constraints|restrições|restricoes)(?:\s*\([0-3]\))?\s*(?::\s*(.*)|$)/i.exec(clean)
    if (match) {
      current = names[match[1]!.toLowerCase()]!
      present.add(current)
      sections[current] += '\n' + (match[2] ?? '')
    } else if (/^\s*#{1,6}\s+/.test(line)) current = undefined
    else if (current) sections[current] += '\n' + line
  }
  const points = Object.fromEntries(Object.entries(sections).map(([key, content]) => {
    if (!present.has(key as keyof typeof sections)) return [key, 0]
    const useful = content.match(/[\p{L}\p{N}]/gu)?.length ?? 0
    if (useful === 0) return [key, 0]
    if (useful < 20) return [key, 1]
    if (key === 'scope') return [key, /\bowns\b|pode(?:m)? alterar|arquivos? permitidos?/i.test(content) && /must not touch|do not touch|não (?:tocar|alterar)|nao (?:tocar|alterar)|fora d[eo] escopo/i.test(content) ? 2 : 1]
    if (key === 'constraints') return [key, 2]
    return [key, /(?:^|\n)\s*\d+[.)]\s|(?:^|[\s`])(?:npm|npx|node|pytest|cargo|git|make)\s+|(?:[\w.-]+\/)+[\w.-]+/m.test(content) ? 3 : 2]
  })) as Record<keyof typeof sections, number>
  const score = Object.values(points).reduce((sum, value) => sum + value, 0)
  const accepted = score >= 7 && points.goal >= 2 && points.result >= 2 && points.scope > 0 && points.constraints > 0
  const labels = { goal: 'Objetivo', result: 'Resultado esperado', scope: 'Escopo', constraints: 'Restrições' }
  const weak = (Object.keys(points) as Array<keyof typeof points>).filter(key => points[key] < 2).map(key => `${labels[key]} ${points[key] === 0 ? 'ausente' : 'fraco'}`)
  return { score, accepted, sections: points, error: accepted ? null : `Brief recusado (${score}/10): ${weak.join('; ') || 'inclua comando, caminho ou critério numerado'}. Mínimo 7/10; Objetivo e Resultado esperado ≥2. Modelo:\nGoal: objetivo claro (20+ caracteres)\nExpected result: 1. resultado verificável\nScope: pode alterar X; não tocar Y\nConstraints: restrições concretas (20+ caracteres)` }
}
