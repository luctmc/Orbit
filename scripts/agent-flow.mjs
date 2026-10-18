// Repository workflow shared by Codex and Claude. No provider credentials are read or changed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function checkBranch(branch) {
  if (!/^(feature|fix)\/orbit-[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(branch)) {
    throw new Error('Use feature/orbit-resumo_do_ajuste ou fix/orbit-resumo_do_ajuste.')
  }
  return branch
}
export function normalizeFiles(files) {
  if (!files.length) throw new Error('Declare os arquivos/pastas que pretende editar.')
  return [...new Set(files.map(file => {
    if (!file || isAbsolute(file) || file.split(/[\\/]/).includes('..') || (file === '.git' || file.startsWith('.git/'))) {
      throw new Error(`Caminho inválido: ${file}`)
    }
    const normalized = normalize(file).replace(/\/$/, '')
    if (!normalized || normalized === '.' || normalized === '.git' || normalized.startsWith('.git/')) throw new Error(`Caminho inválido: ${file}`)
    return normalized
  }))]
}
export function overlaps(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}
const git = (args, cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const gh = args => execFileSync('gh', args, { stdio: 'inherit' })

function main([op, branch, ...paths]) {
  if (op === 'check-branch') return checkBranch(branch)
  const common = resolve(git(['rev-parse', '--git-common-dir']))
  const registry = join(common, 'orbit-agent-claims.json')
  const mutex = join(common, 'orbit-agent-claims.lock')
  const read = () => existsSync(registry) ? JSON.parse(readFileSync(registry, 'utf8')) : []
  const withLock = fn => {
    try { mkdirSync(mutex) } catch { throw new Error('Outro agente está reservando arquivos. Tente novamente; não remova a trava de um agente ativo.') }
    try { return fn() } finally { rmSync(mutex, { recursive: true }) }
  }
  if (op === 'begin') {
    checkBranch(branch)
    const files = normalizeFiles(paths)
    git(['fetch', 'origin', 'main'])
    const cwd = git(['rev-parse', '--show-toplevel'])
    const target = join(dirname(cwd), `Orbit-${branch.replace('/', '-')}`)
    withLock(() => {
      const claims = read()
      for (const claim of claims) {
        if (files.some(a => claim.files.some(b => overlaps(a, b)))) throw new Error(`Arquivo reservado por ${claim.branch}: ${claim.files.join(', ')}`)
      }
      const worktrees = git(['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9))
      for (const worktree of worktrees) {
        // Git retains prunable registrations after temporary worktrees disappear.
        // They have no files to protect and must not block unrelated work with ENOENT.
        if (!existsSync(worktree)) continue
        // Include staged, unstaged, untracked and committed changes of every existing worktree.
        const changed = [git(['diff', '--name-only', '--no-renames', 'origin/main'], worktree), git(['ls-files', '--others', '--exclude-standard'], worktree)]
          .join('\n').split('\n').filter(Boolean)
        const conflict = files.find(a => changed.some(b => overlaps(a, b)))
        if (conflict) throw new Error(`${conflict} já tem mudanças em ${worktree}; coordene com o agente responsável.`)
      }
      git(['worktree', 'add', '-b', branch, target, 'origin/main'])
      claims.push({ branch, worktree: target, files, createdAt: new Date().toISOString() })
      writeFileSync(registry, `${JSON.stringify(claims, null, 2)}\n`)
    })
    console.log(`Worktree pronta: ${target}\nArquivos reservados: ${files.join(', ')}`)
  } else if (op === 'finish') {
    const current = checkBranch(git(['branch', '--show-current']))
    if (git(['status', '--porcelain'])) throw new Error('Faça commits específicos e deixe a worktree limpa antes de publicar.')
    git(['fetch', 'origin', 'main'])
    git(['rebase', 'origin/main']) // Conflict stops here; never auto-resolve or force-push.
    execFileSync('node', ['--test', ...git(['ls-files', 'scripts/*.test.mjs']).split('\n').filter(Boolean)], { stdio: 'inherit' })
    execFileSync('npm', ['run', 'typecheck'], { stdio: 'inherit' })
    execFileSync('npm', ['test'], { stdio: 'inherit' })
    git(['push', '-u', 'origin', current])
    let pr
    try { pr = execFileSync('gh', ['pr', 'view', '--json', 'number', '--jq', '.number'], { encoding: 'utf8' }).trim() }
    catch { pr = execFileSync('gh', ['pr', 'create', '--base', 'main', '--head', current, '--fill'], { encoding: 'utf8' }).trim() }
    gh(['pr', 'checks', pr, '--watch', '--fail-fast'])
    // --match-head-commit prevents merging a revision different from the one just validated.
    gh(['pr', 'merge', pr, '--squash', '--match-head-commit', git(['rev-parse', 'HEAD'])])
    withLock(() => writeFileSync(registry, `${JSON.stringify(read().filter(c => c.branch !== current), null, 2)}\n`))
    console.log('Merge concluído. Official release publicará a atualização; confira o resultado no GitHub Actions.')
  } else if (op === 'status') {
    console.log(JSON.stringify(read(), null, 2))
  } else {
    throw new Error('Uso: node scripts/agent-flow.mjs begin <feature|fix>/orbit-resumo <arquivos...> | status | finish')
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
