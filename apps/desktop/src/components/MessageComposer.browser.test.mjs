// Opt-in real-browser regression: node --test apps/desktop/src/components/MessageComposer.browser.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { BrowserHost, findBrowser } from '../../../../packages/sidecar/src/browser.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const evidence = resolve(root, 'docs/plans/2026-10-18-orbit-compact-task-composer')
const phase = process.env.COMPOSER_QA_PHASE || 'after'
test('compact composer preserves routing, keyboard and tools in the real browser', { timeout: 120_000 }, async () => {
  const engine = findBrowser()
  assert.ok(engine, 'An installed Chromium browser is required for this opt-in check')
  const scratch = await mkdtemp(join(tmpdir(), 'orbit-composer-test-'))
  const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, esbuild: { jsx: 'automatic' } })
  const host = new BrowserHost(scratch, engine)
  await mkdir(evidence, { recursive: true })
  try {
    await server.listen()
    const address = server.httpServer.address()
    const url = `http://127.0.0.1:${address.port}/docs/plans/2026-10-18-orbit-compact-task-composer/fixture.html`
    const mission = 'composer-qa'
    const tab = () => host.tabs.get(mission)
    const evaluate = async expression => { try { return await host.evaluate(tab(), expression) } catch (cause) { throw new Error(`Browser evaluation failed: ${expression}; ${host.consoleLines(mission, 8).join(' | ')}`, {cause}) } }
    const wait = async expression => {
      for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)) }
      assert.fail(`Timed out: ${expression}; ${JSON.stringify(await evaluate('({submissions:window.qa?.submissions, text:document.querySelector("textarea")?.value, disabled:document.querySelector(".composer__send")?.disabled, errors:document.querySelector(".composer__error")?.textContent})'))}`)
    }
    const open = async (query = '') => { await host.navigate(mission, url + query, 'test'); await wait('Boolean(window.qa && document.querySelector("textarea"))') }
    const viewport = async (width, height = 900) => { await host.send(tab(), 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }) }
    const click = selector => host.click(mission, { selector }, 'test')
    const key = async (key, modifiers = 0) => { await host.send(tab(), 'Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : 27, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) }); await host.send(tab(), 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, modifiers }) }
    await open('?single&draft')
    const measurements = []
    for (const width of [1698, 1440, 1024, 768, 375]) {
      await viewport(width)
      await open('?single&draft')
      const metrics = await evaluate('window.qa.metrics()')
      measurements.push(metrics)
      await writeFile(join(evidence, `${phase}-${width}-dom.txt`), await evaluate('document.body.innerText'))
      await writeFile(join(evidence, `${phase}-${width}.png`), Buffer.from(await host.screenshot(mission), 'base64'))
      assert.equal(metrics.overflow, false, `No horizontal overflow at ${width}px`)
    }
    await writeFile(join(evidence, `${phase}-measurements.json`), JSON.stringify(measurements, null, 2) + '\n')
    if (phase === 'before') {
      assert.ok(measurements.every(m => m.height <= 150), 'Compact composer must be <=150px with a one-line draft')
      return
    }
    assert.ok(measurements.every(m => m.height <= (m.width === 375 ? 200 : 150)), 'Compact composer height budget')
    assert.ok(measurements.every(m => !m.inputClipped), 'The full writing surface remains visible, including the narrow long draft')
    for (const m of measurements) for (const control of m.controls) assert.ok(control.height >= 44, `Touch height: ${control.name}`)
    await open('?single')
    assert.ok(await evaluate('window.qa.metrics().height <= 150'), 'Empty narrow composer remains compact')
    await open('?original-draft')
    await click('.composer__language > summary')
    assert.equal(await evaluate('document.querySelector("[id^=translator-]").value'), '', 'An original-text draft cannot silently opt into translation')
    await viewport(1280, 800)
    await open()
    assert.equal(await evaluate('document.querySelector("[id^=dispatch-]").value'), 'new-task')
    await click('.composer__mode-help > summary')
    assert.match(await host.text(mission, 10000).then(r => r.text), /mesma conta do líder/)
    await key('Escape')
    assert.equal(await evaluate('document.querySelector(".composer__mode-help").open'), false)
    assert.equal(await evaluate('document.activeElement.matches(".composer__mode-help > summary")'), true)
    await click('textarea'); await host.type(mission, 'Orientação de teste', 'test')
    await key('Enter', 8) // Shift+Enter inserts a line, never sends.
    assert.equal(await evaluate('window.qa.submissions.length'), 0)
    assert.match(await evaluate('document.querySelector("textarea").value'), /\n/)
    await key('Enter')
    await wait('window.qa.submissions.length === 1')
    assert.equal(await evaluate('window.qa.submissions[0].dispatch'), 'new-task')
    assert.equal(await evaluate('window.qa.submissions[0].allowOriginal'), true)
    assert.equal(await evaluate('Boolean(window.qa.submissions[0].translationAccountId)'), false)
    await wait('document.activeElement.matches("textarea") && !document.querySelector("[id^=dispatch-]").disabled')
    await key('Tab', 8); await key('Tab', 8)
    assert.equal(await evaluate('document.activeElement.id'), 'dispatch-76', 'Mode is reachable by keyboard')
    assert.equal(await evaluate('window.qa.submissions.length'), 1, 'Keyboard mode navigation never submits')
    // The mission driver cannot select the native macOS popup reliably. Verify its unchanged
    // change boundary and payload separately; native popup selection remains an explicit QA gap.
    await evaluate('document.querySelector("[id^=dispatch-]").value = "continue"; document.querySelector("[id^=dispatch-]").dispatchEvent(new Event("change", {bubbles:true}))')
    await click('textarea'); await host.type(mission, 'Continuar no contexto', 'test')
    await click('.composer__send'); await wait('window.qa.submissions.length === 2')
    assert.equal(await evaluate('window.qa.submissions[1].dispatch'), 'continue')
    await click('.composer__language > summary')
    await evaluate('document.querySelector("[id^=translator-]").value = "codex-acc-2"; document.querySelector("[id^=translator-]").dispatchEvent(new Event("change", {bubbles:true}))')
    await key('Escape')
    assert.equal(await evaluate('document.querySelector(".composer__language").open'), false)
    await click('textarea'); await host.type(mission, 'Com tradução', 'test'); await key('Enter')
    await wait('window.qa.submissions.length === 3')
    assert.equal(await evaluate('window.qa.submissions[2].translationAccountId'), 'codex-acc-2')
    await click('.composer__language > summary'); await evaluate('document.querySelector("[id^=translator-]").value = ""; document.querySelector("[id^=translator-]").dispatchEvent(new Event("change", {bubbles:true}))'); await key('Escape')
    await evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['qa'], 'evidence.txt', {type:'text/plain'})); const el = document.querySelector('input[type=file]'); el.files = dt.files; el.dispatchEvent(new Event('change', {bubbles:true})); })()`)
    await wait('Boolean(document.querySelector(".composer__files"))')
    await click('[aria-label="Remover evidence.txt"]')
    assert.equal(await evaluate('Boolean(document.querySelector(".composer__files"))'), false)
    await evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['qa'], 'pasted.txt', {type:'text/plain'})); document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', {bubbles:true, clipboardData:dt})); })()`)
    await wait('Boolean(document.querySelector(".composer__files"))')
    await click('.composer__send'); await wait('window.qa.submissions.length === 4')
    assert.deepEqual(await evaluate('window.qa.submissions[3].attachments'), ['file-2'])
    assert.equal(await evaluate('window.qa.submissions[3].allowOriginal'), true)
    await click('[aria-label="Ditar mensagem"]')
    await wait('Boolean(window.qaSpeech)')
    await evaluate('window.qaSpeech.onresult({resultIndex:0, results:[{isFinal:true, 0:{transcript:"Texto ditado"}}]})')
    await wait('document.querySelector("textarea").value.includes("Texto ditado")')
    await click('[aria-label="Parar ditado"]')
    await evaluate('document.querySelector("[id^=recipient-]").value = "77"; document.querySelector("[id^=recipient-]").dispatchEvent(new Event("change", {bubbles:true}))')
    await wait('document.querySelector("textarea").id === "message-77"')
    assert.equal(await evaluate('Boolean(document.querySelector("[id^=dispatch-]"))'), false)
    await click('textarea'); await host.type(mission, 'Rascunho do ajudante', 'test')
    await viewport(375, 800)
    assert.equal(await evaluate('document.querySelector(".composer__leader").getBoundingClientRect().height >= 44'), true)
    await click('.composer__leader'); await wait('document.querySelector("textarea").id === "message-76"')
    await wait('document.querySelector("textarea").value.includes("Texto ditado")')
    await open('?suggest')
    await click('textarea'); await host.type(mission, 'Verifique', 'test')
    await wait('Boolean(document.querySelector(".composer__suggestion"))')
    await key('Tab')
    assert.equal(await evaluate('document.querySelector("textarea").value'), 'Verifique os testes antes de entregar.')
    assert.equal(await evaluate('window.qa.submissions.length'), 0)
    await click('.composer__toggle')
    assert.equal(await evaluate('document.querySelector(".composer__toggle").getAttribute("aria-pressed")'), 'false')
    await open('?pane=78')
    assert.equal(await evaluate('document.querySelector(".composer__actions > button").disabled'), true)
    assert.equal(await evaluate('Boolean(document.querySelector("[id^=dispatch-]"))'), false)
    await open('?pending')
    assert.equal(await evaluate('document.querySelector("textarea").disabled'), true)
    assert.equal(await evaluate('document.querySelector("[id^=dispatch-]").disabled'), true)
    assert.match(await evaluate('document.querySelector(".composer__send").textContent'), /Conferir pedido/)
    await click('.composer__send'); await wait('window.qa.submissions.length === 1')
    assert.deepEqual(await evaluate('window.qa.submissions[0]'), { checked: true })
    await evaluate('window.qa.connection("closed")')
    assert.equal(await evaluate('document.querySelector(".composer__send").disabled'), true)
    await viewport(1698, 800)
    await open('?mission')
    await wait('document.querySelector(".xterm-screen") !== null')
    assert.equal(await evaluate('Boolean(document.querySelector(".mission-attention"))'), false)
    assert.equal(await evaluate('Boolean(document.querySelector(".mission-status"))'), false)
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pane__account")].map(el => el.textContent)'), ['Conta: Codex 2', 'Conta: legacy-account-77'])
    await writeFile(join(evidence, 'mission-after-1698-dom.txt'), await evaluate('document.body.innerText'))
    await writeFile(join(evidence, 'mission-after-1698.png'), Buffer.from(await host.screenshot(mission), 'base64'))
    await viewport(1280, 800)
    await open('?mission')
    await click('[aria-label="Visualizar"]')
    assert.match(await host.text(mission, 10000).then(r => r.text), /Motor independente conectado/)
    assert.equal(await evaluate('document.querySelector(".mission-insight button").disabled'), false)
    await key('Tab')
    assert.equal(await evaluate('document.activeElement.tagName'), 'SELECT')
    for (let i = 0; i < 12 && !await evaluate('document.activeElement.matches(".mission-insight button")'); i++) await key('Tab')
    assert.equal(await evaluate('document.activeElement.matches(".mission-insight button")'), true)
    assert.ok(await evaluate('document.activeElement.getBoundingClientRect().height >= 44'))
    await click('.mission-insight button')
    assert.equal(await evaluate('document.querySelector(".mission-insight").closest("details").open'), false)
    await click('[aria-label="Visualizar"]'); await key('Escape')
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Visualizar')
    await viewport(375, 800)
    await open('?mission&focus')
    await wait('document.querySelector(".xterm-screen") !== null')
    assert.ok(await evaluate('document.querySelector(".pane__account").getBoundingClientRect().width > 44'), 'Account identity stays visible in narrow pane')
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    await writeFile(join(evidence, 'mission-after-375-dom.txt'), await evaluate('document.body.innerText'))
    await writeFile(join(evidence, 'mission-after-375.png'), Buffer.from(await host.screenshot(mission), 'base64'))
    await open('?mission&focus&waiting')
    await wait('document.querySelector(".mission-attention") !== null')
    await click('.mission-attention button')
    await wait('document.activeElement.id === "message-77"')
    await open('?mission&focus&blocked')
    await wait('document.querySelector(".mission-attention") !== null')
    await click('.mission-attention button')
    assert.equal(await evaluate('Boolean(document.querySelector(".activity-panel"))'), true)
    await writeFile(join(evidence, `${phase}-interactions.json`), JSON.stringify({ routing: true, keyboardModeFocusDoesNotSend: true, nativePopupSelection: "not verified: macOS native select did not respond through BrowserHost key driver", shiftEnter: true, enter: true, language: true, files: true, voiceBoundary: true, recipients: true, drafts: true, suggestionsTabDoesNotSend: true, shell: true, pending: true, disconnected: true, missionDetailsAndAttention: true, accountIdentityDesktopAndNarrow: true, console: host.consoleLines(mission, 100) }, null, 2) + '\n')
    console.log('Passed: widths1698/1440/1024/768/375; native controls; modes; Enter/Shift+Enter; disclosures; language opt-in; file picker/paste/remove/send; speech boundary; recipient/draft isolation; Tab suggestions; shell; pending/disconnected; real mission status/menu/attention; actual account names/ID fallback at desktop/narrow.')
  } finally { await host.close('composer-qa'); host.shutdown(); await server.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) }
})

test('review-required mission states remain visible and actionable while valid current review stays compact', { timeout: 120_000 }, async () => {
  const engine = findBrowser()
  assert.ok(engine, 'An installed Chromium browser is required for this opt-in check')
  const scratch = await mkdtemp(join(tmpdir(), 'orbit-review-alert-test-'))
  const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, esbuild: { jsx: 'automatic' } })
  const host = new BrowserHost(scratch, engine)
  const stage = process.env.COMPOSER_REVIEW_PHASE || 'after'
  const checks = []
  const mission = 'review-alert-qa'
  try {
    await server.listen()
    const address = server.httpServer.address()
    const evaluate = expression => host.evaluate(host.tabs.get(mission), expression)
    const wait = async expression => {
      for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)) }
      assert.fail(`Timed out: ${expression}`)
    }
    const cases = [
      ['stale', 'Revisão final precisa ser conferida', true],
      ['unknown', 'Revisão final precisa ser conferida', true],
      ['awaiting-validation', 'Entrega aguardando revisão', true],
      ['unverified-accepted', 'Entrega aguardando revisão', true],
      ['invalid-accepted', 'Entrega aguardando revisão', true],
      ['valid-current', 'Revisada, aguardando conclusão', false],
    ]
    for (const width of [1280, 375]) {
      for (const [state, title, required] of cases) {
        await host.navigate(mission, `http://127.0.0.1:${address.port}/docs/plans/2026-10-18-orbit-compact-task-composer/fixture.html?mission&focus&review=${state}`, 'test')
        await host.send(host.tabs.get(mission), 'Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
        await wait(`document.querySelector('.mission-insight > strong')?.textContent === ${JSON.stringify(title)}`)
        const result = await evaluate(`({
          attentionVisible: Boolean(document.querySelector('.mission-attention')?.checkVisibility()),
          detailsOpen: document.querySelector('.mission-insight').closest('details').open,
          status: document.querySelector('.mission-insight > strong').textContent,
          reason: document.querySelector('.mission-insight > p').textContent,
          overflow: document.documentElement.scrollWidth > innerWidth,
          dom: document.body.innerText,
        })`)
        if (state === 'stale') {
          await writeFile(join(evidence, `review-${stage}-${width}-dom.txt`), result.dom)
          await writeFile(join(evidence, `review-${stage}-${width}.png`), Buffer.from(await host.screenshot(mission), 'base64'))
        }
        let actionOpensActivities = false
        if (result.attentionVisible) {
          await host.click(mission, { selector: '.mission-attention button' }, 'test')
          actionOpensActivities = await evaluate('Boolean(document.querySelector(".activity-panel"))')
        }
        checks.push({ width, state, required, ...result, actionOpensActivities })
      }
    }
    await writeFile(join(evidence, `review-${stage}-checks.json`), JSON.stringify(checks, null, 2) + '\n')
    for (const check of checks) {
      assert.equal(check.attentionVisible, check.required, `${check.state} at ${check.width}px must ${check.required ? '' : 'not '}show inline attention`)
      assert.equal(check.detailsOpen, false, 'A closed menu must not hide required attention')
      assert.equal(check.overflow, false, 'Review attention must not add horizontal overflow')
      if (check.required) assert.equal(check.actionOpensActivities, true, `${check.state} has a useful action to open activities`)
    }
    console.log('Passed: stale, unknown, awaiting validation, missing/invalid required validation stay visible/actionable at1280/375; valid current review remains compact.')
  } finally { await host.close(mission); host.shutdown(); await server.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) }
})
