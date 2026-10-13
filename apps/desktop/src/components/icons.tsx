import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function stroke({ size = 16, ...props }: IconProps) {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...props }
}

export function OrbitMark({ size = 18 }: { size?: number }) {
  return (
    <svg className="orbit-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="5" />
    </svg>
  )
}

export const HomeIcon = (p: IconProps) => <svg {...stroke(p)}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
export const PlusIcon = (p: IconProps) => <svg {...stroke(p)}><path d="M12 5v14M5 12h14" /></svg>
export const CloseIcon = (p: IconProps) => <svg {...stroke(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const ChevronIcon = (p: IconProps) => <svg {...stroke(p)}><path d="M9 6l6 6-6 6" /></svg>
export const FolderIcon = (p: IconProps) => <svg {...stroke(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
export const SearchIcon = (p: IconProps) => <svg {...stroke(p)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
export const SendIcon = (p: IconProps) => <svg {...stroke(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
export const ArchiveIcon = (p: IconProps) => <svg {...stroke(p)}><path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 4h18v3H3zM10 11h4" /></svg>

export function MissionGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="13" r="10" stroke="var(--line-strong)" strokeWidth="1.5" />
      <circle cx="13" cy="13" r="3.2" fill="var(--accent)" />
      <circle cx="22.5" cy="10" r="2" fill="var(--text-2)" />
    </svg>
  )
}
