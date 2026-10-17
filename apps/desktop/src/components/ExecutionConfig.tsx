import type { Pane } from '@orbit/protocol'
import { CLI_LABEL, EFFORT_LABEL } from '../orbit/labels.ts'

const selection = (model: string | null, effort: string | null) => `${model ?? 'Padrão da CLI'} · esforço ${effort ? EFFORT_LABEL[effort as keyof typeof EFFORT_LABEL] ?? effort : 'da CLI'}`

/** A command-line flag is evidence of application, never evidence of a provider's response. */
export function ExecutionConfig({ pane }: { pane: Pane }) {
  const config = pane.executionConfig
  return <details className="execution-config">
    <summary>Modelo e esforço · rastrear decisão</summary>
    <dl>
      <div><dt>Solicitado</dt><dd>{config ? `${config.decision.requested.cli ? CLI_LABEL[config.decision.requested.cli] : 'Roteamento automático'} · ${selection(config.decision.requested.model, config.decision.requested.effort)}` : 'Execução histórica sem recibo'}</dd></div>
      <div><dt>Resolvido</dt><dd>{config ? `${CLI_LABEL[config.decision.effective.cli]} · ${selection(config.decision.effective.model, config.decision.effective.effort)}` : selection(pane.model, pane.effort)}</dd></div>
      <div><dt>Aplicado na CLI</dt><dd>{config ? selection(config.applied.model, config.applied.effort) : 'Sem registro dos argumentos desta execução'}</dd></div>
      <div><dt>Observado</dt><dd>{pane.reportedModels?.length ? pane.reportedModels.join(', ') : 'Modelo ainda não observado na sessão'}<br />{pane.reportedEfforts?.length ? `Esforço ${pane.reportedEfforts.map(e => EFFORT_LABEL[e]).join(', ')}` : 'Esforço ainda não observado na sessão'}</dd></div>
    </dl>
    {pane.identityObservedAt && <p>Fonte da observação: {pane.identityEvidence === 'response' ? 'resposta do provedor' : pane.identityEvidence === 'execution-context' ? 'contexto de execução da CLI' : 'sessão (origem não certificada)'}. Contexto da CLI não certifica o roteamento interno do provedor.</p>}
    {config && <><p>Origem: {config.decision.source} · política {config.decision.policyRevision}</p>{config.decision.reasons.length > 0 && <ul>{config.decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}</>}
    <p className="muted">Os argumentos de abertura e o relato do provedor são evidências independentes. {pane.executionEpoch && `Execução ${pane.executionEpoch.slice(0, 8)}.`}</p>
  </details>
}
