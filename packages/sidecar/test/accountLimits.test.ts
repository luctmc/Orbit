import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCodexAccountLimits, LimitRefreshGate } from '../src/accountLimits.ts'
import { readCodexLimits } from '../hooks/read-codex-limits.mjs'

const rate = (usedPercent: number) => ({ primary: { usedPercent, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: null, planType: 'plus' })
test('current Codex quota prefers its own bucket, preserves zero and rejects invalid windows', () => {
  const result = parseCodexAccountLimits({ rateLimits: { ...rate(9), limitId: 'other' }, rateLimitsByLimitId: { codex: rate(53), other: rate(1) } }, 1000)!
  assert.equal(result.fiveHour?.usedPercent, 53)
  assert.equal(result.fiveHour?.resetsAt, 2000000000000)
  assert.equal(result.source, 'provider')
  assert.equal(parseCodexAccountLimits({ rateLimits: rate(0) })?.fiveHour?.usedPercent, 0)
  assert.equal(parseCodexAccountLimits({ rateLimits: { ...rate(9), limitId: 'other' } }), null)
  for (const n of [NaN, Infinity, -1, 101]) assert.equal(parseCodexAccountLimits({ rateLimits: rate(n) }), null)
})

test('quota reads deduplicate per account, throttle success and back off failures independently', async () => {
  let now = 1000, calls = 0, release!: (ok: boolean) => void
  const gate = new LimitRefreshGate(() => now)
  const read = () => { calls++; return new Promise<boolean>(r => { release = r }) }
  const first = gate.run('a', read), same = gate.run('a', read)
  assert.equal(first, same)
  await Promise.resolve(); assert.equal(calls, 1); release(true); await first
  await gate.run('a', async () => { calls++; return true }); assert.equal(calls, 1)
  await gate.run('b', async () => { calls++; return false }); assert.equal(calls, 2)
  now += 15000
  await gate.run('a', async () => { calls++; return true }); assert.equal(calls, 3)
  await gate.run('b', async () => { calls++; return false }); assert.equal(calls, 3)
  now += 15000
  await gate.run('b', async () => { calls++; return false }); assert.equal(calls, 4)
  now += 30000
  await gate.run('b', async () => { calls++; return false }); assert.equal(calls, 4)
})

test('Codex quota transport only initializes and reads limits, strips unrelated fields and terminates', async () => {
  const temp = mkdtempSync('/private/tmp/orbit-quota-transport-'), log = join(temp, 'requests.jsonl'), server = join(temp, 'server.mjs')
  writeFileSync(server, `import{appendFileSync}from'node:fs';let b='';process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const m=JSON.parse(b.slice(0,i));b=b.slice(i+1);appendFileSync(${JSON.stringify(log)},JSON.stringify({method:m.method,pid:process.pid})+'\\n');if(m.id===0)console.log(JSON.stringify({id:0,result:{}}));if(m.id===1)console.log(JSON.stringify({id:1,result:{rateLimits:${JSON.stringify({ ...rate(53), limitId: 'codex', credits: { secret: 'not forwarded' } })}}}));}})`)
  const result = await readCodexLimits({ file: process.execPath, args: [server], timeoutMs: 2000 }) as any
  assert.equal(result.rateLimits.primary.usedPercent, 53)
  assert.equal(result.rateLimits.credits, undefined)
  const requests = readFileSync(log, 'utf8').trim().split('\n').map(s => JSON.parse(s))
  assert.deepEqual(requests.map(r => r.method), ['initialize', 'initialized', 'account/rateLimits/read'])
  assert.throws(() => process.kill(requests[0].pid, 0), { code: 'ESRCH' })
  await assert.rejects(readCodexLimits({ file: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 50 }), /prazo/)
})
