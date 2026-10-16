import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalPrediction, terminalPredictionReady, type PromptCursor } from './terminalPrediction.ts'

const candidates = [{ id: 'review', text: 'Revise a entrega.', reason: 'Entrega aguardando revisão.' }]
const prompt = (before = '❯ ', row = 4, after = ''): PromptCursor => ({ before, row, after, column: Array.from(before).length })

test('Codex native focus/cursor replies and its empty placeholder do not consume the first draft', () => {
  const t = new TerminalPrediction()
  const native = prompt('› ', 7, 'Ask Codex to do anything')
  assert.equal(t.prediction(candidates, native), null, 'leave the native placeholder visible')
  for (const reply of ['\x1b[O', '\x1b[11;3R', '\x1b[I']) t.input(reply, native)
  t.input('R', native)
  t.input('e', prompt('› R', 7))
  assert.equal(t.prediction(candidates, prompt('› Re', 7))?.suffix, 'vise a entrega.')
  assert.equal(t.prediction(candidates, prompt('› Re', 8)), null)
  const menu = new TerminalPrediction()
  menu.input('Re', prompt('› ', 7, 'Allow this command?'))
  assert.equal(menu.prediction(candidates, prompt('› Re', 7)), null)
  const existing = new TerminalPrediction()
  existing.input('Re', prompt('› ', 7, 'existing draft'))
  assert.equal(existing.prediction(candidates, prompt('› Re', 7)), null)
})

test('Claude native Try placeholder anchors typing without accepting existing text or a permission choice', () => {
  const t = new TerminalPrediction()
  const native = prompt('❯ ', 4, 'Try "fix lint errors"')
  assert.equal(t.prediction(candidates, native), null)
  t.input('Re', native)
  assert.equal(t.prediction(candidates, prompt('❯ Re', 4))?.suffix, 'vise a entrega.')
  assert.equal(t.prediction(candidates, prompt('❯ Re', 4, 'Try "fix lint errors"')), null, 'existing text must disappear, not be prepended')
  const choice = new TerminalPrediction()
  choice.input('Re', prompt('❯ ', 4, 'Yes, I trust this folder'))
  assert.equal(choice.prediction(candidates, prompt('❯ Re')), null)
})

test('an empty recognized prompt offers a visual next step without owning or changing the buffer', () => {
  const t = new TerminalPrediction()
  assert.equal(t.prediction(candidates, prompt())!.suffix, 'Revise a entrega.')
  assert.equal(t.prediction(candidates, prompt('❯ ', 4, 'native placeholder')), null)
  assert.equal(t.prediction(candidates, { ...prompt(), selected: true }), null)
  assert.equal(t.prediction(candidates, prompt('Allow command? ')), null)
  t.dismiss(); assert.equal(t.prediction(candidates, prompt()), null)
  t.input('Re', prompt()); assert.equal(t.prediction(candidates, prompt('❯ Re'))!.suffix, 'vise a entrega.')
})

test('an echoed draft may mark Codex running; starting, permission and exited panes remain excluded', () => {
  assert.equal(terminalPredictionReady('idle'), true)
  assert.equal(terminalPredictionReady('running'), true)
  for (const status of ['starting', 'waiting', 'exited'] as const) assert.equal(terminalPredictionReady(status), false)
})

test('native prediction appears only after the exact draft echo and returns only a suffix', () => {
  const t = new TerminalPrediction()
  t.input('Re', prompt())
  assert.equal(t.prediction(candidates, prompt()), null, 'no speculative acceptance before echo')
  const p = t.prediction(candidates, prompt('❯ Re'))!
  assert.equal(p.value, 'Revise a entrega.')
  assert.equal(p.suffix, 'vise a entrega.')
  assert.doesNotMatch(p.suffix, /[\r\n\x1b]/)
  assert.equal(t.prediction(candidates, prompt('❯ Re', 5)), null)
  assert.equal(t.prediction(candidates, prompt('❯ Re', 4, 'native menu')), null)
  assert.equal(t.prediction(candidates, { ...prompt('❯ Re'), selected: true }), null)
})

test('unknown prompt, existing native draft and shell menus are never owned by the predictor', () => {
  for (const line of ['user@mac $ ', '❯ existing draft ', 'Allow this command? ', '❯ /']) {
    const t = new TerminalPrediction(); t.input('Re', prompt(line))
    assert.equal(t.prediction(candidates, prompt(line + 'Re')), null)
  }
})

test('cursor controls, multiline and bracketed paste suspend until a new line', () => {
  for (const control of ['\x1b[D', '\x01', '\x1b[200~Re\x1b[201~', 'Re\nnext']) {
    const t = new TerminalPrediction(); t.input('Re', prompt()); t.input(control, prompt('❯ Re')); t.input('Re', prompt())
    assert.equal(t.prediction(candidates, prompt('❯ Re')), null)
    t.input('\r', prompt('❯ Re')); t.input('Re', prompt())
    assert.ok(t.prediction(candidates, prompt('❯ Re')))
  }
})

test('dismissal, backspace and execution reset never insert or submit text', () => {
  const t = new TerminalPrediction(); t.input('Rev', prompt()); t.dismiss()
  assert.equal(t.prediction(candidates, prompt('❯ Rev')), null)
  t.input('\x7f', prompt('❯ Rev'))
  assert.equal(t.prediction(candidates, prompt('❯ Re'))!.suffix, 'vise a entrega.')
  t.reset(); assert.equal(t.prediction(candidates, prompt('❯ Re')), null)
  t.input('Re', prompt('› ')); assert.ok(t.prediction(candidates, prompt('› Re')))
})
