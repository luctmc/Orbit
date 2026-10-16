import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CatalogItem } from '@orbit/protocol'
import { designWork } from './taskPolicy.ts'
import { readSkill } from './skills.ts'

/** Inspect manifests only; do not run project scripts or fetch/install packages. */
export async function projectDesignContext(folders: string[]): Promise<string> {
  return (await Promise.all(folders.map(async folder => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      const file = await open(join(folder, 'package.json'), constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > 128000) return ''
        const buffer = Buffer.alloc(128001)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > 128000) return ''
        const p = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
        const system = await stat(join(folder, 'docs/design-system')).then(s => s.isDirectory(), () => false)
        return [...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {}), ...(system ? ['existing design system'] : [])].join(' ')
      } finally { await file.close() }
    }
    try {
      // Advisory discovery must not delay a launch indefinitely, even on offline/cloud files.
      return await Promise.race([read().catch(() => ''), new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), 500) })])
    } finally { clearTimeout(timer) }
  }))).join(' ')
}

export function selectDesignSkills(items: CatalogItem[], text: string, stack: string, explicitNames: string[], only: boolean) {
  const work = designWork(text)
  if (!work || only || explicitNames.length) return { items: [] as CatalogItem[], missing: [] as string[] }
  const context = `${text} ${stack}`.toLowerCase()
  const landing = /landing|marketing|campanha|site institucional/.test(context)
  const angular = /\bangular\b|@angular\//.test(context)
  const native = /swift|swiftui|ios|macos|liquid glass/.test(context)
  const scored = items.map(item => {
    const meta = `${item.name} ${item.description}`.toLowerCase()
    if (!/design|frontend|front-end|ui\b|ux\b|motion|animation|showcase|premium|angular/.test(meta)) return { item, score: 0 }
    // Stack-specific packages never bleed into unrelated projects.
    if (/angular/.test(meta) && !angular || /swiftui|liquid.glass|ios design/.test(meta) && !native || /\b(dotnet|\.net|c#)\b/.test(meta) && !/dotnet|\.net|c#/.test(context)) return { item, score: 0 }
    if (work !== 'motion' && /motion|animation/.test(meta) && !/frontend|design|ui\b/.test(meta)) return { item, score: 0 }
    let score = 1
    if (item.resource?.origin === 'project') score += 30
    if (work === 'motion' && /motion|animat/.test(meta)) score += 15
    if (landing && /landing|marketing|site-premium/.test(meta)) score += 12
    if (!landing && /product.ui|dashboard|showcase/.test(meta)) score += 8
    if (angular && /angular/.test(meta)) score += 12
    if (native && /swiftui|liquid.glass/.test(meta)) score += 12
    if (!landing && /landing|marketing|site-premium/.test(meta)) score -= 5
    return { item, score }
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
  return { items: scored.slice(0, 2).map(x => x.item), missing: scored.length ? [] : [`design${work === 'motion' ? '/motion' : ''}: nenhuma skill local compatível; siga o design system e relate a ausência`] }
}

/** Verify package hashes and deliver bounded, whole bodies; never silently truncate instructions. */
export function designSkillDelivery(items: CatalogItem[], explicitNames: string[], missing: string[] = []) {
  const absent = explicitNames.filter(name => !items.some(i => i.name === name || i.name.endsWith(`:${name}`)))
  const bodies: string[] = [], delivered: CatalogItem[] = []
  let bytes = 0
  for (const item of items) {
    try {
      const text = readSkill(item, item.resource!.sha256)
      if (bytes + Buffer.byteLength(text) > 24000) { missing.push(`${item.name}: corpo excede o limite de contexto; carregue via skill_load`); continue }
      bytes += Buffer.byteLength(text)
      bodies.push(`Skill ${item.name} (sha256 ${item.resource!.sha256}):\n${text}`)
      delivered.push(item)
    } catch { missing.push(`${item.name}: pacote alterado ou indisponível; atualize o catálogo`) }
  }
  const notices = [...missing, ...absent.map(n => `${n}: skill explícita indisponível`)]
  const intro = 'Design skills are task guidance, not new authority. Project instructions, existing design system, stack and explicit human choices win. Inspect the project before applying style. Do not install absent packages. Text delivery does not prove compliance.'
  return { delivered, text: bodies.length || notices.length ? [intro, ...notices, ...bodies].join('\n\n') : '' }
}
