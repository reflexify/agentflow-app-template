import { AgentFlowError, createAgentFlowClient, ok, proxyAdapter } from '@reflexify/agentflow-sdk';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { TEXT, type Lang } from './text.js';

// A run needs a name; the summary is what people recognise a case by, so it names the run.
const RUN_NAME_MAX = 120;

// The codes AgentFlow answers 403 with when the person's access to this app is gone; the elements treat them alike.
const ACCESS_LOST = new Set(['APP_NOT_ASSIGNED', 'APP_NOT_INSTALLED', 'USER_NOT_PROJECTED']);

type Failure = { banner: string | null; summary?: string; amount?: string } | 'generic';

/** A refusal split into what belongs under a field and what names none; a detail starts with its code, which people do not read. */
function refusal(error: AgentFlowError): Failure {
  const out: { banner: string | null; summary?: string; amount?: string } = { banner: null };
  for (const e of error.fieldErrors ?? []) {
    const { path, message } = (e ?? {}) as { path?: unknown; message?: unknown };
    if (typeof message !== 'string') continue;
    const key = typeof path === 'string' ? path.split('.').pop() : undefined;
    if (key === 'summary' || key === 'amount') out[key] ??= message;
    else out.banner ??= message;
  }
  if (!out.summary && !out.amount && !out.banner) out.banner = error.detail?.replace(/^[A-Z][A-Z0-9_]+:\s*/, '') || null;
  return out.banner || out.summary || out.amount ? out : 'generic';
}

/**
 * Collects the inputs the "Open a case" workflow declares (`summary`, `amount`) and starts it with them as `params`.
 * The workflow takes its input from a schema, so AgentFlow has no launch form for `<agentflow-start-form>` to draw:
 * the site asks for the inputs itself and starts the run as the signed-in person, through its own proxy.
 */
export function StartCase({ basePath, workflowId, lang, onStarted, onSignedOut, onAccessLost }: {
  basePath: string;
  workflowId: string;
  lang: Lang;
  onStarted: () => void;
  onSignedOut: () => void;
  onAccessLost: (code: string) => void;
}) {
  const t = TEXT[lang].startForm;
  const ids = useId();
  const client = useMemo(
    () => createAgentFlowClient({ baseUrl: `${location.origin}${basePath.replace(/\/+$/, '')}/api`, auth: proxyAdapter() }),
    [basePath],
  );
  const [summary, setSummary] = useState('');
  const [amount, setAmount] = useState('');
  // What is wrong is kept as a state, not as text, so a change of language re-renders it.
  const [summaryMissing, setSummaryMissing] = useState(false);
  const [amountBad, setAmountBad] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const summaryInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const text = summary.trim();
    const typed = amount.trim();
    const number = typed === '' ? undefined : Number(typed);
    const bad = amountInput.current?.validity.badInput === true || (number !== undefined && !Number.isFinite(number));
    setSummaryMissing(!text);
    setAmountBad(bad);
    setFailure(null);
    if (!text || bad) {
      (!text ? summaryInput : amountInput).current?.focus();
      return;
    }
    const params: { summary: string; amount?: number } = { summary: text };
    if (number !== undefined) params.amount = number;
    sending.current = true;
    setBusy(true);
    try {
      await ok(client.POST('/workflows/{workflow_id}/instances', {
        params: { path: { workflow_id: workflowId } },
        body: { name: Array.from(text).slice(0, RUN_NAME_MAX).join(''), params },
      }));
    } catch (error) {
      sending.current = false;
      setBusy(false);
      if (error instanceof AgentFlowError && error.status === 401) return onSignedOut();
      if (error instanceof AgentFlowError && error.status === 403 && ACCESS_LOST.has(error.code)) return onAccessLost(error.code);
      setFailure(error instanceof AgentFlowError ? refusal(error) : 'generic');
      return;
    }
    onStarted();
  };

  const summaryId = `${ids}summary`;
  const amountId = `${ids}amount`;
  const summaryError = summaryMissing ? t.summaryMissing : typeof failure === 'object' && failure ? failure.summary : undefined;
  const amountError = amountBad ? t.amountInvalid : typeof failure === 'object' && failure ? failure.amount : undefined;
  const banner = failure === 'generic' ? t.failed : failure?.banner;
  return (
    <form className="start-form" noValidate onSubmit={submit}>
      <h1>{t.heading}</h1>
      <p className="hint">{t.intro}</p>
      {banner && <p className="form-error" role="alert">{banner}</p>}
      <div className="field">
        <label htmlFor={summaryId}>{t.summary}</label>
        <input id={summaryId} ref={summaryInput} className="input" value={summary} required autoComplete="off" placeholder={t.summaryPlaceholder}
          aria-invalid={summaryError ? true : undefined} aria-describedby={summaryError ? `${summaryId}-error` : undefined}
          onChange={(e) => {
            setSummary(e.target.value);
            if (e.target.value.trim()) setSummaryMissing(false);
          }} />
        {summaryError && <p className="field-error" id={`${summaryId}-error`} role="alert">{summaryError}</p>}
      </div>
      <div className="field">
        <label htmlFor={amountId}>{t.amount} <span className="optional">{t.optional}</span></label>
        <input id={amountId} ref={amountInput} className="input" type="number" inputMode="decimal" step="any" value={amount}
          aria-invalid={amountError ? true : undefined} aria-describedby={amountError ? `${amountId}-error` : undefined}
          onChange={(e) => {
            setAmount(e.target.value);
            setAmountBad(false);
          }} />
        {amountError && <p className="field-error" id={`${amountId}-error`} role="alert">{amountError}</p>}
      </div>
      <button type="submit" className="primary" aria-disabled={busy || undefined} aria-busy={busy || undefined}>{busy ? t.starting : t.submit}</button>
    </form>
  );
}
