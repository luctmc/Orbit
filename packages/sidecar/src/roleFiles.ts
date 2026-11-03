import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, statSync, type Stats } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { AGENT_CLIS, MODEL_ID, ROUTING_LIMITS, SLUG, SQUAD_LIMITS, type SquadRole } from '@orbit/protocol'

export interface RoleFiles {
  roles: SquadRole[]
  ignored: { dir: string; reason: string }[]
}

// Bound directory traversal as well as file reads, including malformed repository content.
const MAX_ENTRIES = 256
export const MAX_ROLE_CANDIDATES = 64
export const MAX_ROLE_FOLDERS = 32
export interface RoleFilesBudget {
  candidates: number
  acceptedIds: Set<string>
}
const METADATA_BYTES = 16_384
const BRIEF_BYTES = SQUAD_LIMITS.brief * 4
const FIELDS = new Set(['id', 'name', 'cli', 'model', 'skills', 'onlySkills', 'readOnly'])

function directory(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error('link simbólico não permitido')
  if (!stat.isDirectory()) throw new Error('caminho não é um diretório')
}

function sameIdentity(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

function readLimited(path: string, max: number, physicalDir: string, verifyDirectory: () => void): Buffer {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`${path.split(sep).at(-1)} ausente`)
    if (code === 'ELOOP') throw new Error('link simbólico não permitido')
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('arquivo regular obrigatório; link simbólico não permitido')
    if (stat.size > max) throw new Error('arquivo acima do limite de tamanho')
    try {
      verifyDirectory()
      const physicalPath = realpathSync(path)
      if (!physicalPath.startsWith(physicalDir + sep)) throw new Error('caminho mudou durante a leitura')
      const current = statSync(physicalPath)
      if (!sameIdentity(current, stat)) throw new Error('caminho mudou durante a leitura')
    } catch { throw new Error('caminho mudou durante a leitura') }
    const buffer = Buffer.alloc(max + 1)
    let size = 0
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    if (size > max) throw new Error('arquivo acima do limite de tamanho')
    return buffer.subarray(0, size)
  } finally { closeSync(fd) }
}

/** Imports repository instructions as text only; invalid entries never abort other roles. */
export function loadRoleFiles(root: string, budget: RoleFilesBudget = { candidates: 0, acceptedIds: new Set() }): RoleFiles {
  const result: RoleFiles = { roles: [], ignored: [] }
  const parent = resolve(root, '.maestri')
  const base = join(parent, 'roles')
  const ignore = (dir: string, reason: string) => { result.ignored.push({ dir, reason }) }
  try {
    directory(parent)
    directory(base)
    const physicalBase = realpathSync(base)
    const entries: string[] = []
    const stream = opendirSync(base)
    try {
      for (let count = 0; count <= MAX_ENTRIES; count++) {
        const entry = stream.readSync()
        if (!entry) break
        if (count === MAX_ENTRIES) { ignore(base, `limite de leitura de ${MAX_ENTRIES} entradas atingido`); break }
        if (entry.isDirectory() || entry.isSymbolicLink()) entries.push(entry.name)
      }
    } finally { stream.closeSync() }
    for (const entry of entries.sort()) {
      const dir = join(base, entry)
      if (budget.acceptedIds.size >= SQUAD_LIMITS.roles) { ignore(base, `limite de ${SQUAD_LIMITS.roles} roles excedido`); break }
      if (budget.candidates >= MAX_ROLE_CANDIDATES) { ignore(base, `limite de leitura de ${MAX_ROLE_CANDIDATES} candidatos atingido`); break }
      budget.candidates++
      try {
        directory(parent)
        directory(base)
        directory(dir)
        if (realpathSync(base) !== physicalBase || !realpathSync(dir).startsWith(physicalBase + sep)) throw new Error('caminho fora do diretório de roles')
        const originalDirectory = lstatSync(dir)
        const physicalDir = join(physicalBase, entry)
        const verifyDirectory = () => {
          directory(parent)
          directory(base)
          directory(dir)
          if (realpathSync(base) !== physicalBase || realpathSync(dir) !== physicalDir) throw new Error('caminho mudou durante a leitura')
          const current = statSync(physicalDir)
          if (!sameIdentity(originalDirectory, current)) throw new Error('caminho mudou durante a leitura')
        }
        let value: unknown
        const bytes = readLimited(join(dir, 'role.json'), METADATA_BYTES, physicalDir, verifyDirectory)
        try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('role.json com JSON inválido') }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('role.json deve ser um objeto')
        const role = value as Record<string, unknown>
        if (Object.keys(role).some(key => !FIELDS.has(key))) throw new Error('role.json contém campos extras')
        if (typeof role.id !== 'string' || !SLUG.test(role.id)) throw new Error('id fora do padrão de slug')
        if (role.id !== entry) throw new Error('id diferente do diretório')
        if (typeof role.name !== 'string' || !role.name.trim() || role.name.length > SQUAD_LIMITS.name) throw new Error('nome inválido')
        if (!AGENT_CLIS.includes(role.cli as SquadRole['cli'])) throw new Error('cli inválida')
        if (role.model !== undefined && role.model !== null && (typeof role.model !== 'string' || !MODEL_ID.test(role.model))) throw new Error('modelo inválido')
        for (const field of ['onlySkills', 'readOnly']) if (role[field] !== undefined && typeof role[field] !== 'boolean') throw new Error(`${field} deve ser booleano`)
        if (role.skills !== undefined && (!Array.isArray(role.skills) || role.skills.length > ROUTING_LIMITS.skills || role.skills.some(skill => typeof skill !== 'string' || !skill || skill.length > ROUTING_LIMITS.skill || /\s/.test(skill)))) throw new Error('skills inválidas')
        if (budget.acceptedIds.has(role.id)) throw new Error(`id duplicado: ${role.id}`)
        const claude = readLimited(join(dir, 'CLAUDE.md'), BRIEF_BYTES, physicalDir, verifyDirectory)
        const agents = readLimited(join(dir, 'AGENTS.md'), BRIEF_BYTES, physicalDir, verifyDirectory)
        if (!claude.equals(agents)) throw new Error('CLAUDE.md e AGENTS.md diferentes')
        let brief: string
        try { brief = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(claude) } catch { throw new Error('brief deve conter UTF-8 válido') }
        if (!brief.trim()) throw new Error('brief vazio')
        if (brief.length > SQUAD_LIMITS.brief) throw new Error(`brief acima do limite de ${SQUAD_LIMITS.brief} caracteres`)
        budget.acceptedIds.add(role.id)
        result.roles.push({ id: role.id, name: role.name, cli: role.cli as SquadRole['cli'], model: role.model as string | null ?? null, brief, skills: role.skills as string[] ?? [], onlySkills: role.onlySkills === true, readOnly: role.readOnly !== false })
      } catch (error) {
        ignore(dir, reason(error))
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ignore(base, reason(error))
  }
  return result
}

function reason(error: unknown): string {
  if (error instanceof Error && !('code' in error)) return error.message
  return 'não foi possível ler o role'
}
