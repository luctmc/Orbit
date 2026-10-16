import { useEffect, useRef, type ReactNode } from 'react'
import { MoreIcon } from './icons.tsx'

/** Native disclosure and ordinary buttons preserve normal Tab navigation without a fake ARIA menu. */
export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const away = (event: PointerEvent) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        event.preventDefault(); event.stopPropagation(); ref.current.open = false; ref.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape) }
  }, [])
  return <details ref={ref} className="action-menu"><summary aria-label={label}><MoreIcon size={16} /><span>{label}</span></summary><div className="action-menu__items" onClick={event => {
    if ((event.target as Element).closest('button') && ref.current) {
      ref.current.open = false
      ref.current.querySelector('summary')?.focus()
    }
  }}>{children}</div></details>
}
