// Reads quota only. Never creates a thread/turn or emits authentication material.
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function readCodexLimits({ file = 'codex', args = ['app-server'], timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] })
    let buffer = '', finished = false
    const kill = signal => { try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal) } catch {} }
    const done = (error, value) => {
      if (finished) return
      finished = true; clearTimeout(timer); kill('SIGTERM')
      setTimeout(() => { kill('SIGKILL'); error ? reject(error) : resolve(value) }, 250)
    }
    const timer = setTimeout(() => done(new Error('Consulta de limites do Codex excedeu o prazo.')), timeoutMs)
    const send = value => { if (!finished) child.stdin.write(JSON.stringify(value) + '\n') }
    child.stdin.on('error', () => done(new Error('Não foi possível consultar o Codex.')))
    child.on('error', () => done(new Error('Não foi possível iniciar o Codex.')))
    child.on('exit', () => done(new Error('Codex encerrou antes de informar os limites.')))
    child.stdout.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 262144) return done(new Error('Resposta de limites inválida.'))
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        let message; try { message = JSON.parse(line) } catch { continue }
        if (message.id === 0) {
          if (message.error) return done(new Error('Codex recusou a inicialização da consulta.'))
          send({ method: 'initialized', params: {} }); send({ id: 1, method: 'account/rateLimits/read' })
        }
        if (message.id === 1) {
          if (message.error || !message.result) return done(new Error('Codex não disponibilizou os limites desta conta.'))
          // Whitelist quota fields; do not forward credits, account identity or other responses.
          const clean = rate => rate ? { limitId: rate.limitId, primary: rate.primary, secondary: rate.secondary, planType: rate.planType } : null
          return done(null, { rateLimits: clean(message.result.rateLimits), rateLimitsByLimitId: message.result.rateLimitsByLimitId?.codex ? { codex: clean(message.result.rateLimitsByLimitId.codex) } : undefined })
        }
      }
    })
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'orbit_limits', version: '0.2.14' } } })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await readCodexLimits())) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
