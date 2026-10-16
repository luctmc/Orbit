import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { UpdateStatus } from '@orbit/protocol'
import { shellQuote } from './command.ts'
import type { Run } from './clis.ts'

/** Where Orbit's releases are published; private, so they are read with the person's `gh` login. */
export const UPDATE_REPO = process.env.ORBIT_UPDATE_REPO ?? 'luctmc/Orbit'
/** A folder with a release made by `npm run release` (latest.json + archive), to try it unpublished. */
export const UPDATE_DIR = process.env.ORBIT_UPDATE_DIR ?? null

const REPO = /^[\w.-]+\/[\w.-]+$/
const TAG = /^[\w][\w.-]{0,40}$/
const ASSET = /^[\w][\w.-]{0,120}$/

interface Release {
  tag: string
  assets: string[]
}

/**
 * Reads the latest release with `gh` and serves it to the updater plugin on loopback: the
 * manifest (latest.json) with its download links pointing back here, and the files themselves.
 * The plugin verifies each file's signature with the public key built into the app.
 */
export class Updates {
  private readonly run: Run
  private readonly cacheDir: string
  private readonly repo: string
  private readonly localDir: string | null
  private release: Release | null = null
  status: UpdateStatus = { repo: UPDATE_REPO, checkedAt: null, latest: null, error: null }

  constructor(run: Run, cacheDir: string, repo = UPDATE_REPO, localDir = UPDATE_DIR) {
    if (!REPO.test(repo)) throw new Error(`Repositório de atualizações inválido: ${repo}`)
    this.run = run
    this.cacheDir = cacheDir
    this.repo = repo
    this.localDir = localDir
    this.status.repo = localDir ? `pasta ${localDir}` : repo
  }

  /** The update manifest, or null when there is no release with one. */
  async manifest(base: string): Promise<Record<string, any> | null> {
    try {
      const release = await this.latest()
      if (!release || !release.assets.includes('latest.json')) {
        this.status = { ...this.status, checkedAt: Date.now(), latest: release?.tag ?? null, error: null }
        return null
      }
      const manifest = JSON.parse(readFileSync(await this.download(release, 'latest.json'), 'utf8')) as { platforms?: Record<string, { url?: string }> }
      for (const platform of Object.values(manifest.platforms ?? {})) {
        const name = basename(String(platform.url ?? ''))
        if (!ASSET.test(name) || !release.assets.includes(name)) throw new Error(`O latest.json aponta para um arquivo que não está na release: ${name}`)
        platform.url = `${base}/update/files/${encodeURIComponent(release.tag)}/${encodeURIComponent(name)}`
      }
      this.status = { ...this.status, checkedAt: Date.now(), latest: release.tag, error: null }
      return manifest
    } catch (error) {
      this.status = { ...this.status, checkedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }
      throw error
    }
  }

  /** A file of the release the manifest came from, downloaded once into the cache. */
  async file(tag: string, name: string): Promise<{ path: string; size: number }> {
    const release = this.release
    if (!release || release.tag !== tag || !ASSET.test(name) || !release.assets.includes(name)) throw new Error('Arquivo de atualização desconhecido')
    const path = await this.download(release, name)
    return { path, size: statSync(path).size }
  }

  private async latest(): Promise<Release | null> {
    if (this.localDir) {
      const manifest = join(this.localDir, 'latest.json')
      if (!existsSync(manifest)) return (this.release = null)
      const version = String((JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }).version ?? 'local')
      return (this.release = { tag: TAG.test(`v${version}`) ? `v${version}` : 'local', assets: readdirSync(this.localDir).filter((n) => ASSET.test(n)) })
    }
    const result = await this.run(`gh release view --repo ${this.repo} --json tagName,assets`, 30_000)
    if (result.code !== 0) {
      const text = `${result.stderr}\n${result.stdout}`
      if (/release not found|no releases? found|could not find any release/i.test(text)) return (this.release = null)
      if (/command not found|not found: gh/i.test(text)) throw new Error('O GitHub CLI (gh) não está instalado: o Orbit busca as versões com ele.')
      if (/auth login|not logged|authentication/i.test(text)) throw new Error('Entre no GitHub CLI (gh auth login) para o Orbit buscar novas versões.')
      throw new Error(text.trim().slice(-300) || 'O gh não respondeu.')
    }
    const data = JSON.parse(result.stdout) as { tagName?: string; assets?: Array<{ name?: string }> }
    if (!data.tagName || !TAG.test(data.tagName)) throw new Error('Release sem tag válida')
    return (this.release = { tag: data.tagName, assets: (data.assets ?? []).map((a) => String(a.name ?? '')).filter((n) => ASSET.test(n)) })
  }

  private async download(release: Release, name: string): Promise<string> {
    if (this.localDir) return join(this.localDir, name)
    const dir = join(this.cacheDir, release.tag)
    const path = join(dir, name)
    if (name !== 'latest.json' && existsSync(path)) return path
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const result = await this.run(`gh release download ${shellQuote(release.tag)} --repo ${this.repo} --pattern ${shellQuote(name)} --dir ${shellQuote(dir)} --clobber`, 15 * 60_000)
    if (result.code !== 0 || !existsSync(path)) throw new Error(`Não consegui baixar ${name}: ${(result.stderr || result.stdout).trim().slice(-200)}`)
    return path
  }
}
