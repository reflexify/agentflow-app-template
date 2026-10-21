// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(join(import.meta.dirname, '..', 'static', 'plain.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const inline = [...doc.querySelectorAll('script:not([src])')].map((s) => s.textContent).join('\n');

const ENTITY = '0190c0de-0000-7000-8000-0000000000e1';
const TASK = '0190c0de-0000-7000-8000-00000000a001';
const TASK_ENTITY = '0190c0de-0000-7000-8000-00000000a0e1';
const config = (over = {}) => ({ basePath: '/agentflow', entityId: null, workflowId: null, ...over });

// jsdom runs no module scripts, so this runs the page's own script against a copy of its body.
// `state` is one the provider reached before the script ran.
async function openPage({ answer = async () => Response.json(config()), state }: { answer?: () => Promise<Response>; state?: string } = {}) {
  document.body.innerHTML = doc.body.innerHTML;
  const provider = document.querySelector('agentflow-provider') as HTMLElement;
  if (state) provider.dataset.state = state;
  vi.stubGlobal('fetch', vi.fn(answer));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (body: string) => () => Promise<void>;
  await new AsyncFunction(inline)();
  return provider;
}

const fire = (el: Element, type: string, detail: unknown) =>
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
const shown = (id: string) => {
  const el = document.getElementById(id)!;
  return el.hidden ? null : el.textContent;
};

// The page lives at /plain. From / its jump to /#/task/… is a hash change, which jsdom follows; from /plain it would be a page load.
beforeEach(() => {
  history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the plain page', () => {
  it('loads only the elements bundle: no framework, no bundler', () => {
    const scripts = [...doc.querySelectorAll('script')];
    const external = scripts.filter((s) => s.src).map((s) => new URL(s.getAttribute('src')!, 'http://x').pathname);
    expect(external).toEqual(['/elements/agentflow-elements.js']);
    expect(scripts.every((s) => s.type === 'module')).toBe(true);
    expect(html).not.toMatch(/react|vue|svelte/i);
  });
  it('shows the inbox and the record table inside one provider', () => {
    const provider = doc.querySelector('agentflow-provider');
    expect(provider?.getAttribute('base-path')).toBe('/agentflow');
    expect(provider?.querySelector('agentflow-task-inbox')).not.toBeNull();
    expect(doc.querySelector('agentflow-record-table')?.closest('agentflow-provider')).toBe(provider);
  });
  it('the plain page offers sign-in when the provider reports signed-out', () => {
    expect(inline).toContain("addEventListener('signed-out'");
    expect(doc.querySelector('#signed-out a')?.getAttribute('href')).toBe('/agentflow/auth/login?returnTo=%2Fplain');
  });
  it('shows the records of the configured entity', async () => {
    await openPage({ answer: async () => Response.json(config({ entityId: ENTITY })) });
    expect(document.querySelector('agentflow-record-table')?.getAttribute('entity-id')).toBe(ENTITY);
    expect(shown('records')).not.toBeNull();
    expect(shown('config-failed')).toBeNull();
  });
  it('says access ended, with the code, when the provider loses access', async () => {
    const provider = await openPage();
    fire(provider, 'access-lost', { code: 'APP_NOT_INSTALLED' });
    expect(shown('lost')).toBe('Access to Case desk ended (APP_NOT_INSTALLED).');
  });
  it('says so, with the code, when the provider cannot load the session', async () => {
    const provider = await openPage();
    provider.dataset.state = 'error';
    fire(provider, 'request-failed', { code: 'INTERNAL_ERROR', status: 500 });
    const failed = document.getElementById('failed')!;
    expect(failed.hidden).toBe(false);
    expect(failed.textContent).toMatch(/couldn't load your session from AgentFlow \(INTERNAL_ERROR\)/);
  });
  it('leaves a later failure to the element that shows it', async () => {
    const provider = await openPage();
    provider.dataset.state = 'ready';
    fire(provider, 'request-failed', { code: 'INTERNAL_ERROR', status: 500 });
    expect(document.getElementById('failed')?.hidden).toBe(true);
  });
  it('still opens a task, and says the configuration failed, when config.json cannot be reached', async () => {
    await openPage({ answer: () => Promise.reject(new TypeError('Failed to fetch')) });
    fire(document.querySelector('agentflow-task-inbox')!, 'task-select', { recordId: TASK, entityId: TASK_ENTITY });
    expect(location.hash).toBe(`#/task/${TASK_ENTITY}/${TASK}`);
    expect(shown('config-failed')).toMatch(/can't load its configuration/);
    expect(shown('records')).toBeNull();
  });
  it('never takes the body of a 500 for the configuration', async () => {
    await openPage({ answer: async () => Response.json({ code: 'INTERNAL_ERROR', entityId: ENTITY }, { status: 500 }) });
    expect(shown('records')).toBeNull();
    expect(document.querySelector('agentflow-record-table')!.hasAttribute('entity-id')).toBe(false);
    expect(shown('config-failed')).toMatch(/can't load its configuration/);
  });
  it.each([
    ['signed-out', 'signed-out', /Sign in to see your work/],
    ['access-lost', 'lost', /Access to Case desk ended/],
    ['error', 'failed', /couldn't load your session from AgentFlow/],
  ])('applies the state %s, reached before the page listened', async (state, line, text) => {
    await openPage({ state });
    expect(shown(line), `#${line} is hidden`).not.toBeNull();
    expect(shown(line)).toMatch(text);
  });
});
