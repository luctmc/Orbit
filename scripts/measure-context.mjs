// Deterministic material-size probe. No model calls or token estimates. Not an R2/R3 A/B eval.
import { createHash } from 'node:crypto'
import { buildContextPack } from '../packages/sidecar/src/contextPack.ts'
import { leadRole, projectMemoryNote, instructionsNote, crewRole } from '../packages/sidecar/src/prompts.ts'
import { DEFAULT_ROUTING } from '../packages/sidecar/src/routing.ts'
import { bundledCatalog } from '../packages/sidecar/src/skills.ts'

const mission = { title: 'Fixed context corpus', mode: 'agentica', allowedClis: ['claude', 'codex'] }
const contract = instructionsNote('Do not publish. Preserve unrelated edits. User authorization and acceptance are mandatory.')
const cases = [
  { name: 'lead-empty-memory', memory: '' },
  { name: 'lead-short-memory', memory: '- Build command: npm test.\n- Source: packages/sidecar.' },
  { name: 'lead-long-memory', memory: Array.from({ length: 80 }, (_, i) => `- Historical observation ${i}: ${'Prior mission measured a synthetic local fixture. '.repeat(4)}`).join('\n') },
  { name: 'worker-review', crew: true, memory: '' },
].map(c => {
  const sections = [
    { id: 'authorization', text: contract, required: true },
    { id: 'memory', text: projectMemoryNote(c.memory), maxBytes: 2000 },
    { id: 'role', text: c.crew ? crewRole(mission, { id: 2 }, { children: 0 }, undefined, DEFAULT_ROUTING.taskTypes.find(t => t.id === 'revisao')) : leadRole(mission, { id: 1 }, undefined, DEFAULT_ROUTING), required: true },
  ]
  const pack = buildContextPack(sections, 48000, s => ({ sha256: createHash('sha256').update(JSON.stringify({ id: s.id, text: s.text })).digest('hex'), section: s.id, bytes: Buffer.byteLength(s.text) }))
  return { name: c.name, eagerMaterialBytes: pack.sourceBytes, initialPackBytes: pack.bytes, deferredBytes: pack.references.reduce((sum, r) => sum + r.bytes, 0), initialByteReductionPercent: Number(((1 - pack.bytes / pack.sourceBytes) * 100).toFixed(2)), bytesIfEveryReferenceIsRead: pack.bytes + pack.references.reduce((sum, r) => sum + r.bytes, 0), digest: pack.sha256 }
})
const packages = bundledCatalog().filter(i => i.cli === 'codex').map(i => ({ name: i.name, bytes: i.resource.bytes, sha256: i.resource.sha256 }))
console.log(JSON.stringify({ version: 1, unit: 'utf8-bytes', comparison: 'current role with eager optional material versus current budgeted pack', exclusions: ['native CLI catalogs', 'MCP tool schemas', 'provider tokenization', 'model behavior and quality', 'extra tool calls'], realTokenSavings: null, cases, packages }, null, 2))
