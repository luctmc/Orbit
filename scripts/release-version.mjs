import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const valid = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export function nextVersion(current, tags) {
  if (!valid.test(current)) throw new Error(`Versão inválida: ${current}`)
  const versions = [current, ...tags.map(t => t.replace(/^v/, '')).filter(t => valid.test(t))]
  versions.sort((a, b) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number)
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  })
  const [major, minor, patch] = versions.at(-1).split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8')).version
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).trim().split('\n')
  console.log(nextVersion(current, tags))
}
