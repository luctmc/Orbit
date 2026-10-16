import { useState, type ReactNode } from 'react'
import { messageBlocks, messageInline } from '../orbit/messageFormat.ts'

function Inline({ text }: { text: string }) {
  return messageInline(text).map((part, i) => part.kind === 'code' ? <code key={i}>{part.text}</code>
    : part.kind === 'strong' ? <strong key={i}>{part.text}</strong>
      : part.kind === 'link' ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a> : part.text)
}
function CodeBlock({ text, language }: { text: string; language: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  return <div className="message-code">
    <div className="message-code__head"><span>{language || 'Código'}</span><button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setError(false) }
      catch { setError(true) }
    }}>{copied ? 'Copiado' : 'Copiar código'}</button></div>
    <pre><code>{text}</code></pre>
    {error && <p role="status">Selecione o código para copiar.</p>}
  </div>
}
export function MessageText({ text }: { text: string }) {
  return <div className="message-text">{messageBlocks(text).map((block, i): ReactNode => {
    if (block.kind === 'code') return <CodeBlock key={`${i}:${block.text}`} text={block.text} language={block.language} />
    if (block.kind === 'heading') return block.level <= 2 ? <h3 key={i}><Inline text={block.text} /></h3> : <h4 key={i}><Inline text={block.text} /></h4>
    if (block.kind === 'quote') return <blockquote key={i}><Inline text={block.text} /></blockquote>
    if (block.kind === 'list') {
      const items = block.items.map((item, n) => <li key={n}><Inline text={item} /></li>)
      return block.ordered ? <ol key={i} start={block.start}>{items}</ol> : <ul key={i}>{items}</ul>
    }
    return <p key={i}><Inline text={block.text} /></p>
  })}</div>
}
