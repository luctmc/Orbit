// Report evaluation or an isolated two-task offline producer. No CLI/model calls or report import.
import { readFileSync, statSync } from 'node:fs'
import { evaluateHarnessMatrix } from '../packages/sidecar/src/benchmarks/harnessMatrix.ts'
const args = process.argv.slice(2)
if (args.length === 3 && args[0] === '--native-pilot' && args[1] === '--cli' && ['codex','claude'].includes(args[2])) {
  const { runNativeHarnessPilot } = await import('../packages/sidecar/src/benchmarks/harnessNative.ts')
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort())
  const result = await runNativeHarnessPilot({ cli: args[2], signal: controller.signal, onProgress: message => console.error(JSON.stringify(message)) })
  console.log(JSON.stringify(result, null, 2))
  if (result.accepted !== 2 || result.promotedObservations !== 0) process.exitCode = 1
} else if (args.length === 1 && args[0] === '--offline-pilot') {
  const { runOfflineHarnessPilot } = await import('../packages/sidecar/src/benchmarks/harnessOffline.ts')
  const result = await runOfflineHarnessPilot()
  console.log(JSON.stringify(result, null, 2))
  if (result.accepted !== 2 || result.promotedObservations !== 0) process.exitCode = 1
} else if (args.length !== 2 || args[0] !== '--report') {
  console.log('Usage: node scripts/bench-routing.mjs --report matrix.json | --offline-pilot | --native-pilot --cli codex|claude\nNative is opt-in: two public tasks, fresh subscription limits, temporary Orbit profile, no automatic permission confirmations or policy promotion.')
  process.exitCode = args.includes('--help') ? 0 : 1
} else {
  const path = args[1]
  if (statSync(path).size > 16 * 1024 * 1024) throw new Error('Matrix exceeds 16 MiB')
  const result = evaluateHarnessMatrix(JSON.parse(readFileSync(path, 'utf8')))
  console.log(JSON.stringify(result, null, 2))
  if (result.issues.length) process.exitCode = 1
}
