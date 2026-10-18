import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CatalogItem } from '@orbit/protocol'
import { designSkillDelivery, projectDesignContext, selectDesignSkills } from '../src/designSkills.ts'
import { missionSkills } from '../src/skills.ts'
import { fixture } from './r2Fixture.ts'

function skill(name: string, description: string, projectRoot: string | null = null): CatalogItem {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-design-skill-')))
  const path = join(root, 'SKILL.md'), body = `---\nname: ${name}\ndescription: ${description}\n---\nUse the existing project tokens. Preserve accessible focus.\n`
  writeFileSync(path, body)
  return { id: `codex:skill:${name}`, cli: 'codex', kind: 'skill', name, description, source: 'fixture', offInCli: false, resource: { path, root, sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body), version: null, origin: projectRoot ? 'project' : 'personal', projectRoot, role: null, compatibility: ['codex'] } }
}

test('design choice follows stack, task, project scope, explicit lists and disabled resources', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-design-project-')))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': 'fixture' } }))
  mkdirSync(join(root, 'docs/design-system'), { recursive: true })
  const items = [skill('showcase', 'Product UI design dashboard'), skill('angular', 'Angular frontend design'), skill('motion', 'Motion animation'), skill('liquid-glass', 'SwiftUI iOS design'), skill('landing', 'Marketing landing design'), skill('project-ui', 'Project frontend design', root), skill('other-project', 'Frontend design', '/different')]
  const eligible = missionSkills(items, 'codex', [root], new Set(['codex:skill:showcase']))
  const stack = await projectDesignContext([root])
  assert.match(stack, /@angular\/core/)
  const selected = selectDesignSkills(eligible, 'Implemente frontend', stack, [], false)
  assert.deepEqual(selected.items.map(i => i.name), ['project-ui', 'angular'])
  assert.equal(selectDesignSkills(eligible, 'Frontend React', 'react', [], false).items.some(i => i.name === 'angular' || i.name === 'liquid-glass'), false)
  assert.equal(selectDesignSkills(eligible, 'Motion transitions', 'react', [], false).items[0]?.name, 'project-ui')
  assert.equal(selectDesignSkills(eligible, 'Design a marketing landing', 'react', [], false).items.some(i => i.name === 'landing'), true)
  assert.deepEqual(selectDesignSkills(eligible, 'frontend', stack, ['human-skill'], false).items, [])
  assert.deepEqual(selectDesignSkills(eligible, 'frontend', stack, [], true).items, [])
  assert.match(designSkillDelivery([], [], selectDesignSkills([], 'motion', '', [], false).missing).text, /nenhuma skill local compatível/)
  assert.match(designSkillDelivery([], ['missing']).text, /skill explícita indisponível/)
  const changed = skill('changed', 'Frontend design'); writeFileSync(changed.resource!.path, 'altered')
  assert.equal(designSkillDelivery([changed], []).delivered.length, 0)
})

test('Codex under a Codex lead receives real design skill bodies and a writable implementation sandbox', async () => {
  const f = await fixture()
  try {
    f.core.handle({ type: 'pane.close', paneId: f.pane.id })
    await new Promise(r => setTimeout(r, 100))
    f.core.handle({ type: 'mission.create', workspaceId: f.core.store.snapshot().workspaces[0]!.id, title: 'Codex lead', objective: '', mode: 'agentica', lead: { cli: 'codex', model: null, title: 'Codex' } })
    const lead = f.core.store.snapshot().panes.find(p => p.role === 'lead' && p.cli === 'codex')!
    const item = skill('project-design', 'Frontend design', realpathSync(f.root))
    const internal = f.core as any
    internal.catalogItems = [item]
    const { CLAUDE_FIXTURE: CLAUDE_CATALOG } = await import('./catalogFixture.ts')
    internal.catalog = { claude: CLAUDE_CATALOG, codex: { source: 'cli', efforts: ['medium','high'], models: [{ id: 'gpt-6.1-sol', label: 'Sol', description: '', efforts: ['medium','high'], defaultEffort: 'medium' }] }, gemini: { source: 'builtin', efforts: [], models: [] }, antigravity: { source: 'builtin', efforts: [], models: [] } }
    const { pane } = await f.core.spawnHelper(lead, { title: 'Frontend', task: 'Implemente frontend no projeto', cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium' })
    const context = JSON.parse(readFileSync(join(f.root, 'data/panes', String(pane.id), 'context.json'), 'utf8'))
    assert.match(context.role.text, /Use the existing project tokens/)
    assert.match(context.role.text, /Project instructions, existing design system/)
    assert.equal(f.core.skillCatalog(pane).items.find((i: any) => i.name === item.name)?.loaded?.sha256, item.resource!.sha256)
    assert.equal(f.core.store.executionPolicy(pane.id)?.readOnly, false)
    assert.equal(f.core.store.executionPolicy(lead.id)?.readOnly, true)
    await assert.rejects(f.core.spawnHelper(lead, { title: 'Motion', task: 'Crie animações', cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }), /conflita com a política motion/)
    await assert.rejects(f.core.spawnHelper(lead, { title: 'Visual', task: 'Implemente design', cli: 'claude', model: 'claude-haiku-5-5', effort: 'low' }), /conflita com a política frontend/)
  } finally { await f.core.shutdown() }
})
