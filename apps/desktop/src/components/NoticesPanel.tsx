import { useState } from 'react'
import { showNotice, useNoticePrefs } from '../orbit/notify.ts'
import type { NoticePrefs } from '../orbit/notices.ts'

const EVENTS: Array<[keyof NoticePrefs, string, string]> = [
  ['waiting', 'Um agente espera você', 'Pedido de permissão ou pergunta no terminal dele.'],
  ['handoff', 'Um ajudante entregou o retorno', 'O resumo que chegou ao líder.'],
  ['finished', 'Um agente terminou', 'Um agente do Claude parou depois de trabalhar mais de 30 s.'],
  ['exited', 'Um agente encerrou', 'O processo do agente terminou (inclusive com erro).'],
  ['scheduled', 'Uma missão agendada começou', 'Uma missão da agenda foi iniciada sozinha.'],
]

/** Settings › Avisos: which moments become a macOS notification. */
export function NoticesPanel() {
  const [prefs, setPrefs] = useNoticePrefs()
  const [tested, setTested] = useState<string | null>(null)
  const toggle = (key: keyof NoticePrefs) => (e: React.ChangeEvent<HTMLInputElement>) => setPrefs({ ...prefs, [key]: e.target.checked })

  return (
    <div className="dialog__body clis notices">
      <p className="muted notices__intro">
        Avisos do macOS para deixar as missões rodando e cuidar de outra coisa. Clicar no aviso volta para o Orbit no agente certo; o ícone no Dock mostra quantos agentes esperam você.
      </p>
      <fieldset className="notices__group">
        <legend className="eyebrow">Avisar quando</legend>
        {EVENTS.map(([key, label, hint]) => (
          <label key={key} className="notices__row">
            <input type="checkbox" checked={prefs[key]} onChange={toggle(key)} />
            <span><strong>{label}</strong><span className="muted">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      <fieldset className="notices__group">
        <legend className="eyebrow">Como</legend>
        <label className="notices__row">
          <input type="checkbox" checked={prefs.onlyInBackground} onChange={toggle('onlyInBackground')} />
          <span><strong>Só com o Orbit em segundo plano</strong><span className="muted">Com o Orbit na frente, você já vê o que acontece.</span></span>
        </label>
        <label className="notices__row">
          <input type="checkbox" checked={prefs.sound} onChange={toggle('sound')} />
          <span><strong>Com som</strong></span>
        </label>
      </fieldset>
      <div className="notices__test">
        <button className="btn btn--ghost btn--sm" onClick={() => {
          void showNotice({ title: 'Orbit', body: 'Assim chegam os avisos das suas missões.' }, prefs.sound)
            .then((ok) => setTested(ok ? 'Aviso enviado.' : 'O macOS não deixou: libere as notificações do Orbit em Ajustes do Sistema › Notificações.'))
            .catch((e: unknown) => setTested(String(e)))
        }}>Enviar um aviso de teste</button>
        {tested && <span className="muted" role="status">{tested}</span>}
      </div>
    </div>
  )
}
