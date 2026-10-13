import { useCallback, useEffect, useRef, useState } from 'react'

/** The parts of the Web Speech API Orbit uses (WebKit and Chromium both ship it prefixed). */
interface RecognitionResult {
  readonly isFinal: boolean
  readonly 0: { transcript: string }
}
interface RecognitionEvent {
  readonly resultIndex: number
  readonly results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionConstructor = new () => Recognition

const Recognizer = (globalThis as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition
  ?? (globalThis as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition

/** False where the webview has no speech recognition; macOS Dictation (Fn Fn) still works there. */
export const dictationAvailable = Boolean(Recognizer)

const ERRORS: Record<string, string> = {
  'not-allowed': 'O Orbit não tem permissão para o microfone ou para o reconhecimento de fala. Libere em Ajustes do Sistema › Privacidade e Segurança.',
  'service-not-allowed': 'O reconhecimento de fala está desligado. Ative a Siri ou o Ditado em Ajustes do Sistema, ou libere o Orbit em Privacidade e Segurança.',
  'audio-capture': 'Nenhum microfone encontrado.',
  network: 'O reconhecimento de fala precisa de internet.',
  'no-speech': 'Não ouvi nada. Tente de novo mais perto do microfone.',
  'language-not-supported': 'O idioma do sistema não é aceito pelo reconhecimento de fala.',
}

/**
 * Dictation into a text field: `onText` gets each finished phrase (`final`) and the phrase still
 * being heard (not final, replaced on every call). Listening stops on `stop()` or after a long pause.
 */
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const latest = useRef(onText)
  latest.current = onText

  useEffect(() => () => recognition.current?.abort(), [])

  const stop = useCallback(() => recognition.current?.stop(), [])

  const start = useCallback(() => {
    if (!Recognizer || recognition.current) return
    const r = new Recognizer()
    r.lang = navigator.language || 'pt-BR'
    r.continuous = true
    r.interimResults = true
    r.onresult = (event) => {
      let finished = ''
      let heard = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!
        if (result.isFinal) finished += result[0].transcript
        else heard += result[0].transcript
      }
      if (finished) latest.current(finished, true)
      latest.current(heard, false)
    }
    r.onerror = (event) => {
      if (event.error !== 'aborted') setError(ERRORS[event.error] ?? `O ditado parou (${event.error}).`)
    }
    r.onend = () => {
      recognition.current = null
      setListening(false)
      latest.current('', false)
    }
    setError(null)
    recognition.current = r
    try {
      r.start()
      setListening(true)
    } catch (e) {
      recognition.current = null
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  return { listening, error, start, stop, dismissError: () => setError(null) }
}

/** "texto já escrito" + "frase ditada", with one space between. */
export function joinText(before: string, phrase: string): string {
  const next = phrase.trim()
  if (!next) return before
  return before.trim() ? `${before.replace(/\s+$/, '')} ${next}` : next
}
