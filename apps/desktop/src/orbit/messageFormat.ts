/** Small, deliberately text-only Markdown subset. No HTML, images, autolinks or executable URLs. */
export type MessageBlock =
  | { kind: 'paragraph' | 'quote'; text: string }
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
export type MessageInline = { kind: 'text' | 'strong' | 'code'; text: string } | { kind: 'link'; text: string; href: string }

export function messageBlocks(text: string): MessageBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MessageBlock[] = []
  const list = /^(?:\s{0,3})(?:(\d+)\.|([-*+]))\s+(.+)$/
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }
    const fence = /^\s{0,3}(`{3,}|~{3,})([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const content: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`).test(lines[i]!)) content.push(lines[i++]!)
      if (i < lines.length) i++
      blocks.push({ kind: 'code', text: content.join('\n'), language: fence[2] ?? '' }); continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! }); i++; continue }
    const item = list.exec(line)
    if (item) {
      const ordered = !!item[1], items: string[] = []
      while (i < lines.length) {
        const next = list.exec(lines[i]!)
        if (!next || !!next[1] !== ordered) break
        items.push(next[3]!); i++
      }
      blocks.push({ kind: 'list', ordered, start: item[1] ? Number(item[1]) : 1, items }); continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^>\s?/, ''))
      blocks.push({ kind: 'quote', text: quote.join('\n') }); continue
    }
    const content = [line]; i++
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s{0,3}(?:`{3,}|~{3,})|>\s?)/.test(lines[i]!) && !list.test(lines[i]!)) content.push(lines[i++]!)
    blocks.push({ kind: 'paragraph', text: content.join('\n') })
  }
  return blocks
}

export function messageInline(text: string): MessageInline[] {
  const out: MessageInline[] = []
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g
  let at = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > at) out.push({ kind: 'text', text: text.slice(at, match.index) })
    const value = match[0]
    if (value.startsWith('`')) out.push({ kind: 'code', text: value.slice(1, -1) })
    else if (value.startsWith('**')) out.push({ kind: 'strong', text: value.slice(2, -2) })
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value)!
      try {
        const url = new URL(link[2]!)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported link')
        out.push({ kind: 'link', text: link[1]!, href: url.href })
      } catch { out.push({ kind: 'text', text: value }) }
    }
    at = match.index! + value.length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}
