import type { FormError } from '@reflexify/agentflow-elements/kit';
import { useEffect, useId, useRef, useState } from 'react';
import type { Case, CasesApi } from './cases-api.js';
import { DateInput, Dialog, type ThemeMode } from './kit.js';
import { errorText, TEXT, type Lang } from './text.js';

/** Today in the viewer's own calendar, `yyyy-mm-dd`. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface Props {
  open: boolean;
  api: CasesApi;
  lang: Lang;
  locale: string;
  theme: ThemeMode;
  onCreated(made: Case): void;
  onClose(): void;
}

/** The "New case" dialog: the create form's three fields. A failed create keeps what was typed and says why. */
export function NewCaseDialog({ open, api, lang, locale, theme, onCreated, onClose }: Props) {
  const t = TEXT[lang];
  const ids = useId();
  const [title, setTitle] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [openedOn, setOpenedOn] = useState<string | null>(todayIso);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `af-form` turns the form's submit into `af-submit`, and sends no other while its `busy` is set.
  const form = useRef<(HTMLElement & { busy: boolean; errors: FormError[] }) | null>(null);
  // Counts closings: a create that answers after its dialog closed must not write into the next one.
  const session = useRef(0);
  const titleInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle('');
    setUrgent(false);
    setOpenedOn(todayIso());
    setFailure(null);
    setBusy(false);
    if (form.current) {
      form.current.busy = false;
      form.current.errors = [];
    }
  };

  useEffect(() => {
    if (!open) return;
    reset();
    // The dialog puts focus on its close button as it opens; the title is where the person starts.
    const timer = setTimeout(() => titleInput.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const close = () => {
    session.current += 1;
    reset();
    onClose();
  };

  // Read when `af-submit` fires, so the listener added once sees this render's values.
  const submit = useRef<() => void>(() => undefined);
  submit.current = () => {
    const el = form.current!;
    if (!title.trim()) {
      // The field named `title` shows it, and the form moves focus there.
      el.errors = [{ path: '/title', message: t.titleMissing }];
      return;
    }
    const mine = session.current;
    el.busy = true; // set here, in the handler: a second press now sends nothing
    el.errors = [];
    setBusy(true);
    setFailure(null);
    api.create({ title: title.trim(), urgent, openedOn })
      .then((made) => {
        if (mine === session.current) close();
        // The case exists even when the dialog was closed meanwhile, so the list still shows it.
        onCreated(made);
      })
      .catch((error: unknown) => {
        if (mine === session.current) setFailure(errorText(error, t, t.createFailed));
      })
      .finally(() => {
        if (mine === session.current) {
          el.busy = false;
          setBusy(false);
        }
      });
  };
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    const listener = () => submit.current();
    el.addEventListener('af-submit', listener);
    return () => el.removeEventListener('af-submit', listener);
  }, []);

  const formId = `${ids}form`;
  return (
    <Dialog open={open} heading={t.newCase} locale={locale} theme={theme} onClose={close}
      actions={<>
        <button type="button" className="af-button secondary" onClick={close}>{t.cancel}</button>
        <button type="submit" form={formId} className="af-button primary" aria-disabled={busy || undefined}>
          {busy ? t.creating : t.create}
        </button>
      </>}>
      <af-form ref={form} locale={locale}>
        <form id={formId} className="form" noValidate>
          {failure && <div className="af-banner danger" role="alert">{failure}</div>}
          <af-field label={t.title} required>
            <input ref={titleInput} className="af-input" name="title" value={title} placeholder={t.titlePlaceholder} autoComplete="off"
              onChange={(e) => {
                setTitle(e.target.value);
                if (e.target.value.trim() && form.current) form.current.errors = [];
              }} />
          </af-field>
          <af-field label={t.urgentLabel} description={t.urgentHelp}>
            <input type="checkbox" className="af-checkbox" name="urgent" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          </af-field>
          <af-field label={t.openedOn}>
            <DateInput value={openedOn} label={t.openedOn} locale={locale} theme={theme} onChange={setOpenedOn} />
          </af-field>
        </form>
      </af-form>
    </Dialog>
  );
}
