import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileDiff, folderStatus, folderTree, insideFolder, parseNumstat, parseStatus, readFile } from '../src/files.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Teste', '-c', 'user.email=teste@exemplo.dev', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8' })

/** A repository with one commit and then every kind of change. */
function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-repo-')))
  git(dir, 'init', '-q')
  writeFileSync(join(dir, 'app.js'), 'linha 1\nlinha 2\nlinha 3\n')
  writeFileSync(join(dir, 'velho.txt'), 'some\n')
  writeFileSync(join(dir, 'nome.txt'), 'renomeia\n')
  writeFileSync(join(dir, '.gitignore'), 'segredo.env\n')
  mkdirSync(join(dir, 'web'))
  writeFileSync(join(dir, 'web', 'index.html'), '<p>oi</p>\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'início')
  writeFileSync(join(dir, 'app.js'), 'linha 1\nlinha dois\nlinha 3\nlinha 4\n')
  rmSync(join(dir, 'velho.txt'))
  renameSync(join(dir, 'nome.txt'), join(dir, 'novo nome.txt'))
  git(dir, 'add', '-A', 'nome.txt', 'novo nome.txt')
  writeFileSync(join(dir, 'novo.md'), '# a\nb\n')
  writeFileSync(join(dir, 'segredo.env'), 'TOKEN=x\n')
  writeFileSync(join(dir, 'web', 'logo.bin'), Buffer.from([0, 1, 2, 3]))
  return dir
}

test('porcelain v2 and numstat are read as git writes them', () => {
  const status = parseStatus(['# branch.oid abc', '# branch.head main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b src/a b.js', '2 R. N... 100644 100644 100644 a b R100 novo.txt', 'velho.txt', '? solto.md', ''].join('\0'))
  assert.deepEqual([status.branch, status.ahead, status.behind], ['main', 2, 1])
  assert.deepEqual(status.changes, [
    { path: 'src/a b.js', from: null, kind: 'modificado', staged: false },
    { path: 'novo.txt', from: 'velho.txt', kind: 'renomeado', staged: true },
    { path: 'solto.md', from: null, kind: 'novo', staged: false },
  ])
  const counts = parseNumstat(['3\t1\tsrc/a b.js', '-\t-\tlogo.png', '0\t0\t', 'velho.txt', 'novo.txt', ''].join('\0'))
  assert.deepEqual(counts.get('src/a b.js'), { added: 3, removed: 1 })
  assert.deepEqual(counts.get('logo.png'), { added: null, removed: null })
  assert.deepEqual(counts.get('novo.txt'), { added: 0, removed: 0 })
})

test('a folder: changes with line counts, diffs, the tree and file contents', async () => {
  const dir = repo()
  const status = await folderStatus(dir, (path) => (path.endsWith('app.js') ? [7] : []))
  assert.equal(status.git, true)
  assert.equal(status.branch, 'main')
  const by = Object.fromEntries(status.changes.map((c) => [c.path, c]))
  assert.deepEqual(Object.keys(by).sort(), ['app.js', 'novo nome.txt', 'novo.md', 'velho.txt', 'web/logo.bin'])
  assert.deepEqual([by['app.js']!.kind, by['app.js']!.added, by['app.js']!.removed, by['app.js']!.by], ['modificado', 2, 1, [7]])
  assert.deepEqual([by['velho.txt']!.kind, by['velho.txt']!.removed], ['apagado', 1])
  assert.deepEqual([by['novo nome.txt']!.kind, by['novo nome.txt']!.from, by['novo nome.txt']!.staged], ['renomeado', 'nome.txt', true])
  assert.deepEqual([by['novo.md']!.kind, by['novo.md']!.added], ['novo', 2])
  assert.equal(by['web/logo.bin']!.added, null, 'no line count for binaries')

  assert.match((await fileDiff(dir, 'app.js')).diff, /-linha 2\n\+linha dois\n linha 3\n\+linha 4/)
  assert.match((await fileDiff(dir, 'novo.md')).diff, /\+# a\n\+b/)

  const tree = await folderTree(dir)
  assert.ok(tree.files.includes('web/index.html') && tree.files.includes('novo.md'))
  assert.ok(!tree.files.includes('segredo.env'), '.gitignore is respected')

  assert.equal(readFile(dir, 'web/index.html').text, '<p>oi</p>\n')
  assert.equal(readFile(dir, 'web/logo.bin').reason, 'Arquivo binário.')

  // A subfolder of a repository shows its own changes, with its own relative paths.
  const sub = await folderStatus(join(dir, 'web'))
  assert.deepEqual(sub.changes.map((c) => c.path), ['logo.bin'])

  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-plain-')))
  writeFileSync(join(plain, 'a.txt'), 'a')
  mkdirSync(join(plain, 'node_modules'))
  writeFileSync(join(plain, 'node_modules', 'x.js'), 'x')
  assert.equal((await folderStatus(plain)).git, false)
  assert.deepEqual((await folderTree(plain)).files, ['a.txt'], 'without git the walk skips node_modules')
})

test('nothing outside the folder can be read', () => {
  const dir = repo()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-out-')))
  writeFileSync(join(outside, 'senha.txt'), 'x')
  symlinkSync(join(outside, 'senha.txt'), join(dir, 'atalho.txt'))
  for (const bad of ['../senha.txt', '/etc/hosts', 'web/../../senha.txt', 'atalho.txt', '']) assert.throws(() => insideFolder(dir, bad), /Caminho/, bad)
  assert.throws(() => readFile(dir, 'atalho.txt'), /fora da pasta/)
})

test('the UI asks about a workspace and only the asking window gets the answer', async () => {
  const dir = repo()
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, browser: null })
  const ui = connect(server.port)
  const other = connect(server.port)
  try {
    await Promise.all([ui.opened, other.opened])
    ui.send({ type: 'workspace.create', name: 'repo', folders: [dir, join(dir, 'web')] })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Arquivos', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: '' } })
    const { pane } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')

    // Claude reports an edit through its hook: the change is credited to that agent.
    ui.send({ type: 'pane.input', paneId: pane.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === pane.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    const hook = await fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(dir, 'app.js') } }) })
    assert.equal(hook.status, 204)

    ui.send({ type: 'files.status', workspaceId: workspace.id, missionId: pane.missionId })
    const { folders } = await ui.next('files.status')
    assert.equal(folders.length, 2)
    assert.deepEqual(folders[0]!.changes.find((c) => c.path === 'app.js')!.by, [pane.id])
    assert.deepEqual(folders[1]!.changes.map((c) => c.path), ['logo.bin'])

    ui.send({ type: 'files.diff', workspaceId: workspace.id, folder: dir, path: 'app.js' })
    assert.match((await ui.next('files.diff')).diff, /\+linha dois/)
    ui.send({ type: 'files.read', workspaceId: workspace.id, folder: dir, path: '../../etc/hosts' })
    assert.match((await ui.next('files.error')).message, /Caminho/)
    ui.send({ type: 'files.tree', workspaceId: workspace.id, folder: '/etc' })
    assert.match((await ui.next('files.error', (m) => /pasta não é do workspace/.test(m.message))).message, /workspace/)

    await new Promise((r) => setTimeout(r, 200))
    assert.ok(!other.inbox.some((m) => m.type.startsWith('files.')), 'answers go to the window that asked')
  } finally {
    ui.ws.close()
    other.ws.close()
    await server.close()
  }
})
