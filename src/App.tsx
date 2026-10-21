import { signIn, signOut } from '@reflexify/agentflow-elements';
import type {} from '@reflexify/agentflow-elements/jsx';
import { useEffect, useState } from 'react';
import { StartCase } from './StartCase.js';
import { go, parseRoute, type Route } from './route.js';
import { initialLang, TEXT, type Lang } from './text.js';

export interface PublicConfig { basePath: string; entityId: string | null; workflowId: string | null }

// The demo entity's `urgent` field (RUNBOOK.md step 4).
const URGENT = { field_filters: [{ field: 'urgent', op: 'eq', value: true }] };

// A code as AgentFlow and the SDK write them. `agentflow_error` arrives in the address, which anyone
// can write, so nothing else is shown.
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

const here = () => `${location.pathname}${location.search}${location.hash}`;

// `changes` counts changes of view, so a view can tell one visit from the next. A `hashchange` that
// lands on the view already shown is not one.
function useRoute(): { route: Route; changes: number } {
  const [state, setState] = useState(() => ({ route: parseRoute(location.hash), changes: 0 }));
  useEffect(() => {
    const onHash = () =>
      setState((s) => {
        const route = parseRoute(location.hash);
        return JSON.stringify(route) === JSON.stringify(s.route) ? s : { route, changes: s.changes + 1 };
      });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return state;
}

function refusedMessage(code: string, lang: Lang): string {
  const t = TEXT[lang];
  if (!CODE.test(code)) return t.refused.unnamed;
  const known: Record<string, unknown> = t.refused;
  const entry = known[code];
  return typeof entry === 'string' ? entry : t.refused.other(code);
}

function Notice({ message, code, lang }: { message: string; code: string; lang: Lang }) {
  return (
    <main className="notice">
      <h1>{message}</h1>
      {CODE.test(code) && <p><code>{code}</code></p>}
      <button type="button" onClick={() => signOut()}>{TEXT[lang].signOut}</button>
    </main>
  );
}

export function App({ config }: { config: PublicConfig }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [lost, setLost] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [caller, setCaller] = useState<{ display_name: string; org_name: string | null; app: { name: string } | null } | null>(null);
  const [flashAt, setFlashAt] = useState<number | null>(null);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const { route, changes } = useRoute();
  const t = TEXT[lang];
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const refusal = new URLSearchParams(location.search).get('agentflow_error');

  if (refusal) return <Notice message={refusedMessage(refusal, lang)} code={refusal} lang={lang} />;
  if (lost) return <Notice message={refusedMessage(lost, lang)} code={lost} lang={lang} />;
  if (failed) return <Notice message={t.failed} code={failed} lang={lang} />;

  return (
    <agentflow-provider
      base-path={config.basePath}
      locale={lang}
      onsession-ready={(e) => setCaller(e.detail.caller)}
      onsigned-out={() => signIn(here())}
      onaccess-lost={(e) => setLost(e.detail.code)}
      onrequest-failed={(e) => {
        // Only the provider's own load leaves it in `error`; a later failure is shown by the element that made it.
        if ((e.currentTarget as HTMLElement).dataset.state === 'error') setFailed(e.detail.code);
      }}
    >
      <header className="bar">
        <strong>{caller?.app?.name ?? 'Case desk'}</strong>
        <nav>
          <a href="#/inbox">{t.inbox}</a>
          <a href="#/records">{t.records}</a>
          <a href="#/start">{t.start}</a>
        </nav>
        <span className="who">{caller ? `${caller.display_name}${caller.org_name ? ` · ${caller.org_name}` : ''}` : ''}</span>
        <button type="button" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}>{lang === 'vi' ? 'English' : 'Tiếng Việt'}</button>
        <button type="button" onClick={() => signOut()}>{t.signOut}</button>
      </header>
      {flashAt === changes && <p className="flash">{t.started}</p>}
      <main>
        {route.view === 'inbox' && <agentflow-task-inbox ontask-select={(e) => go(`#/task/${e.detail.entityId}/${e.detail.recordId}`)} />}
        {route.view === 'task' && (
          <>
            <a href="#/inbox">{t.back}</a>
            <agentflow-task-detail key={`${route.entityId}/${route.recordId}`} entity-id={route.entityId} record-id={route.recordId} ontask-submitted={() => go('#/inbox')} />
          </>
        )}
        {route.view === 'records' &&
          (config.entityId ? (
            <>
              <label className="toggle">
                <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.currentTarget.checked)} /> {t.urgentOnly}
              </label>
              {/* With a filter the element queries through POST …/records/query; without one it lists and searches. */}
              <agentflow-record-table entity-id={config.entityId} filter={urgentOnly ? URGENT : undefined} />
            </>
          ) : (
            <p>{t.notConfigured('CASE_DESK_ENTITY_ID')}</p>
          ))}
        {route.view === 'start' &&
          (config.workflowId ? (
            <StartCase
              basePath={config.basePath}
              workflowId={config.workflowId}
              lang={lang}
              onSignedOut={() => signIn(here())}
              onAccessLost={setLost}
              onStarted={() => {
                // Shown on the inbox this start goes to, and gone at the next change of view.
                setFlashAt(changes + 1);
                go('#/inbox');
              }}
            />
          ) : (
            <p>{t.notConfigured('CASE_DESK_WORKFLOW_ID')}</p>
          ))}
      </main>
    </agentflow-provider>
  );
}
