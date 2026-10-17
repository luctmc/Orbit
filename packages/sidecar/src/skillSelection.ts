// Adapted from stablyai/orca (MIT), 09f12fa6, src/main/skills/agent-skill-selection.ts.
// Copyright (c) 2026 Lovecast Inc. Full license in THIRD_PARTY_NOTICES.md.
// Orbit adds namespaced aliases and uses its mission-filtered catalog; no upstream dependencies.
import type { CatalogItem } from '@orbit/protocol'

/** Resolve explicit instructions deterministically. An ambiguous alias is not a selection. */
export function resolveSkillSelectors(items: readonly CatalogItem[], selectors: readonly string[]): CatalogItem[] {
  const selected = new Map<string, CatalogItem>()
  for (const selector of selectors) {
    const exact = items.find(item => item.id === selector)
    const matches = exact ? [exact] : items.filter(item => item.name === selector || item.name.endsWith(`:${selector}`))
    if (!matches.length) throw new Error(`Skill explícita "${selector}" indisponível nesta execução; confira catálogo, escopo e skills desativadas.`)
    if (matches.length > 1) throw new Error(`Skill "${selector}" ambígua: mais de uma correspondência. Use um id exato: ${matches.map(item => item.id).join(', ')}`)
    selected.set(matches[0]!.id, matches[0]!)
  }
  return [...selected.values()]
}
