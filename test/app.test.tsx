// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
const signOut = vi.fn();
vi.mock('@reflexify/agentflow-elements', () => ({ signIn, signOut }));
const post = vi.fn();
const clientOptions: unknown[] = [];
vi.mock('@reflexify/agentflow-sdk', async (original) => ({
  ...(await original<typeof import('@reflexify/agentflow-sdk')>()),
  createAgentFlowClient: (opts: unknown) => {
    clientOptions.push(opts);
    return { POST: post };
  },
}));

const { AgentFlowError } = await import('@reflexify/agentflow-sdk');
const { App } = await import('../src/App.js');
const { parseRoute } = await import('../src/route.js');

const T = '0190c0de-0000-7000-8000-00000000a001';
const E = '0190c0de-0000-7000-8000-00000000a0e1';
const CALLER = {
  kind: 'user', id: '0190c0de-0000-7000-8000-0000000000c1', display_name: 'Lan Pham', org_id: '0190c0de-0000-7000-8000-0000000000c2',
  email: null, org_name: 'Acme', permissions: [], app: { key: 'case-desk', name: 'Case desk' },
};
const config = (over = {}) => ({ basePath: '/agentflow', entityId: '0190c0de-0000-7000-8000-0000000000e1', workflowId: '0190c0de-0000-7000-8000-0000000000f1', ...over });

beforeEach(() => {
  history.replaceState(null, '', '/');
  location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// jsdom fires `hashchange` as a separate task, so wait one macrotask inside `act`.
const fire = (el: Element, type: string, detail: unknown) =>
  act(async () => {
    el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
const navigate = (hash: string) =>
  act(async () => {
    location.hash = hash;
    await new Promise((r) => setTimeout(r, 0));
  });

describe('parseRoute', () => {
  it('reads the four views and falls back to the inbox', () => {
    expect(parseRoute('')).toEqual({ view: 'inbox' });
    expect(parseRoute(`#/task/${E}/${T}`)).toEqual({ view: 'task', entityId: E, recordId: T });
    expect(parseRoute('#/task/not-a-uuid')).toEqual({ view: 'inbox' });
    expect(parseRoute(`#/task/${T}`)).toEqual({ view: 'inbox' });
    expect(parseRoute(`#/task/${E}/not-a-uuid`)).toEqual({ view: 'inbox' });
    expect(parseRoute('#/records')).toEqual({ view: 'records' });
    expect(parseRoute('#/start')).toEqual({ view: 'start' });
  });
});

const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const submit = () => act(async () => { screen.getByRole('button', { name: /^Start(ing…)?$/ }).click(); await new Promise((r) => setTimeout(r, 0)); });
async function startCase() {
  post.mockResolvedValue({ data: { id: T }, response: new Response(null, { status: 201 }) });
  await type(field(/summary/i), 'Refund for order 1042');
  await submit();
}

describe('App', () => {
  it('renders the inbox inside the provider and opens a task on task-select', async () => {
    const { container } = render(<App config={config()} />);
    const inbox = container.querySelector('agentflow-task-inbox')!;
    expect(inbox.closest('agentflow-provider')?.getAttribute('base-path')).toBe('/agentflow');
    await fire(inbox, 'task-select', { recordId: T, entityId: E });
    expect(location.hash).toBe(`#/task/${E}/${T}`);
    const detail = container.querySelector('agentflow-task-detail');
    expect([detail?.getAttribute('entity-id'), detail?.getAttribute('record-id')]).toEqual([E, T]);
  });

  it('goes back to the inbox after task-submitted', async () => {
    location.hash = `#/task/${E}/${T}`;
    const { container } = render(<App config={config()} />);
    await fire(container.querySelector('agentflow-task-detail')!, 'task-submitted', { recordId: T, entityId: E, actionId: null });
    expect(location.hash).toBe('#/inbox');
  });

  it('signed-out sends the person to sign-in with the current hash as returnTo', async () => {
    location.hash = `#/task/${E}/${T}`;
    const { container } = render(<App config={config()} />);
    await fire(container.querySelector('agentflow-provider')!, 'signed-out', {});
    expect(signIn).toHaveBeenCalledOnce();
    expect(signIn).toHaveBeenCalledWith(`/#/task/${E}/${T}`);
  });

  it('shows the refusal screen for agentflow_error and does not sign in again', async () => {
    history.replaceState(null, '', '/?agentflow_error=APP_NOT_ASSIGNED');
    const { container } = render(<App config={config()} />);
    expect(screen.getByRole('heading').textContent).toMatch(/not in this app's audience/i);
    expect(container.querySelector('agentflow-provider')).toBeNull();
    screen.getByRole('button', { name: /sign out/i }).click();
    expect(signOut).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('names a well-formed refusal code it has no message for', async () => {
    history.replaceState(null, '', '/?agentflow_error=SIGN_IN_FAILED');
    const { container } = render(<App config={config()} />);
    expect(screen.getByRole('heading').textContent).toBe('Sign-in did not complete (SIGN_IN_FAILED).');
    expect(container.querySelector('code')?.textContent).toBe('SIGN_IN_FAILED');
  });

  it.each([
    'Your account is locked, call 555-0100',
    'access_denied',
    'APP-NOT-ASSIGNED',
    '1_STARTS_WITH_A_DIGIT',
    `A${'B'.repeat(64)}`,
    'APP_NOT_ASSIGNED\n',
  ])('shows no code, only a generic line, for agentflow_error=%j', async (code) => {
    history.replaceState(null, '', `/?agentflow_error=${encodeURIComponent(code)}`);
    const { container } = render(<App config={config()} />);
    expect(screen.getByRole('heading').textContent).toBe('Sign-in did not complete.');
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).not.toContain(code.trim());
    screen.getByRole('button', { name: /sign out/i }).click();
    expect(signOut).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('says the generic line in Vietnamese to a browser that prefers it', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN');
    history.replaceState(null, '', `/?agentflow_error=${encodeURIComponent('Tài khoản bị khóa')}`);
    render(<App config={config()} />);
    expect(screen.getByRole('heading').textContent).toBe('Đăng nhập chưa hoàn tất.');
  });

  it('shows the access-lost screen when the provider reports it', async () => {
    const { container } = render(<App config={config()} />);
    await fire(container.querySelector('agentflow-provider')!, 'access-lost', { code: 'APP_NOT_INSTALLED' });
    expect(screen.getByRole('heading').textContent).toMatch(/turned off/i);
  });

  it('says so, with the code, when the provider cannot load the session', async () => {
    const { container } = render(<App config={config()} />);
    const provider = container.querySelector('agentflow-provider') as HTMLElement;
    provider.dataset.state = 'error';
    await fire(provider, 'request-failed', { code: 'INTERNAL_ERROR', status: 500 });
    expect(screen.getByRole('heading').textContent).toMatch(/couldn't load your session from AgentFlow/);
    expect(screen.getByText('INTERNAL_ERROR')).toBeTruthy();
    expect(container.querySelector('agentflow-provider')).toBeNull();
  });

  it('offers sign-out beside that failure', async () => {
    const { container } = render(<App config={config()} />);
    const provider = container.querySelector('agentflow-provider') as HTMLElement;
    provider.dataset.state = 'error';
    await fire(provider, 'request-failed', { code: 'INTERNAL_ERROR', status: 500 });
    screen.getByRole('button', { name: /sign out/i }).click();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('says so in Vietnamese after the switch', async () => {
    const { container } = render(<App config={config()} />);
    await act(async () => screen.getByRole('button', { name: 'Tiếng Việt' }).click());
    const provider = container.querySelector('agentflow-provider') as HTMLElement;
    provider.dataset.state = 'error';
    await fire(provider, 'request-failed', { code: 'NETWORK_ERROR', status: 0 });
    expect(screen.getByRole('heading').textContent).toMatch(/không tải được phiên làm việc/);
    expect(screen.getByText('NETWORK_ERROR')).toBeTruthy();
  });

  it('leaves a failure after the session loaded to the element that shows it', async () => {
    const { container } = render(<App config={config()} />);
    const provider = container.querySelector('agentflow-provider') as HTMLElement;
    provider.dataset.state = 'ready';
    await fire(provider, 'request-failed', { code: 'INTERNAL_ERROR', status: 500 });
    expect(container.querySelector('agentflow-provider')).not.toBeNull();
    expect(screen.queryByText('INTERNAL_ERROR')).toBeNull();
  });

  it('sections without an id say not configured', async () => {
    location.hash = '#/records';
    const { container } = render(<App config={config({ entityId: null, workflowId: null })} />);
    expect(container.querySelector('agentflow-record-table')).toBeNull();
    expect(screen.getByText(/CASE_DESK_ENTITY_ID/)).toBeTruthy();
    await navigate('#/start');
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByText(/CASE_DESK_WORKFLOW_ID/)).toBeTruthy();
  });

  it('Urgent only queries the records through the filter property', async () => {
    // A stand-in class so React sets `filter` as a property, as it does on the real element.
    if (!customElements.get('agentflow-record-table')) {
      customElements.define('agentflow-record-table', class extends HTMLElement { filter: unknown = undefined; });
    }
    location.hash = '#/records';
    const { container } = render(<App config={config()} />);
    const table = () => container.querySelector('agentflow-record-table') as HTMLElement & { filter?: unknown };
    expect(table().filter).toBeUndefined();
    await act(async () => screen.getByRole('checkbox', { name: /urgent only/i }).click());
    expect(table().filter).toEqual({ field_filters: [{ field: 'urgent', op: 'eq', value: true }] });
  });

  it.each([
    ['Lan Pham · Acme', 'Acme'],
    ['Lan Pham', null],
  ])('session-ready puts "%s" in the header', async (shown, org) => {
    const { container } = render(<App config={config()} />);
    await fire(container.querySelector('agentflow-provider')!, 'session-ready', { caller: { ...CALLER, org_name: org } });
    expect(screen.getByText(shown).closest('header')).not.toBeNull();
  });

  it('workflow-started shows the flash and goes to the inbox', async () => {
    location.hash = '#/start';
    const { container } = render(<App config={config()} />);
    await startCase();
    expect(location.hash).toBe('#/inbox');
    expect(container.querySelector('agentflow-task-inbox')).not.toBeNull();
    expect(screen.getByText('Case started. Its first task will appear in your inbox.')).toBeTruthy();
  });

  it('the flash follows a language switch', async () => {
    location.hash = '#/start';
    render(<App config={config()} />);
    await startCase();
    await act(async () => screen.getByRole('button', { name: 'Tiếng Việt' }).click());
    expect(screen.getByText('Đã mở hồ sơ. Công việc đầu tiên sẽ xuất hiện trong hộp việc.')).toBeTruthy();
    expect(screen.queryByText(/Case started/)).toBeNull();
  });

  it('the flash clears on the next route change, and does not come back', async () => {
    location.hash = '#/start';
    render(<App config={config()} />);
    await startCase();
    expect(screen.getByText('Case started. Its first task will appear in your inbox.')).toBeTruthy();
    await navigate('#/records');
    expect(screen.queryByText(/Case started/)).toBeNull();
    await navigate('#/inbox');
    expect(screen.queryByText(/Case started/)).toBeNull();
  });

  it('switches the elements to Vietnamese', async () => {
    const { container } = render(<App config={config()} />);
    await act(async () => screen.getByRole('button', { name: 'Tiếng Việt' }).click());
    expect(container.querySelector('agentflow-provider')?.getAttribute('locale')).toBe('vi');
  });

  it('keeps the page language in step with the switch', async () => {
    document.documentElement.lang = 'en';
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN');
    render(<App config={config()} />);
    expect(document.documentElement.lang).toBe('vi');
    await act(async () => screen.getByRole('button', { name: 'English' }).click());
    expect(document.documentElement.lang).toBe('en');
    await act(async () => screen.getByRole('button', { name: 'Tiếng Việt' }).click());
    expect(document.documentElement.lang).toBe('vi');
  });

  describe('Start a case', () => {
    beforeEach(() => {
      post.mockReset();
      clientOptions.length = 0;
      location.hash = '#/start';
    });

    it('asks for the inputs the workflow declares rather than drawing a start element', () => {
      const { container } = render(<App config={config()} />);
      expect(container.querySelector('agentflow-start-form')).toBeNull();
      expect(field(/summary/i).required).toBe(true);
      expect(field(/amount/i).type).toBe('number');
    });

    it('starts the workflow as the person, through the server proxy, with the summary and amount as params', async () => {
      render(<App config={config()} />);
      await type(field(/summary/i), '  Refund for order 1042 ');
      await type(field(/amount/i), '250.5');
      post.mockResolvedValue({ data: { id: T }, response: new Response(null, { status: 201 }) });
      await submit();
      expect(post).toHaveBeenCalledOnce();
      expect(post).toHaveBeenCalledWith('/workflows/{workflow_id}/instances', {
        params: { path: { workflow_id: config().workflowId } },
        body: { name: 'Refund for order 1042', params: { summary: 'Refund for order 1042', amount: 250.5 } },
      });
      const options = clientOptions[0] as { baseUrl: string; auth: { credentials?: string } };
      expect(options.baseUrl).toBe(`${location.origin}/agentflow/api`);
      expect(options.auth.credentials).toBe('same-origin');
      expect(location.hash).toBe('#/inbox');
      expect(screen.getByText('Case started. Its first task will appear in your inbox.')).toBeTruthy();
    });

    it('leaves the amount out when it is blank', async () => {
      render(<App config={config()} />);
      await startCase();
      expect((post.mock.calls[0]![1] as { body: { params: unknown } }).body.params).toEqual({ summary: 'Refund for order 1042' });
    });

    it('does not start without a summary and says why', async () => {
      render(<App config={config()} />);
      await type(field(/summary/i), '   ');
      await submit();
      expect(post).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toMatch(/summary/i);
      expect(field(/summary/i).getAttribute('aria-invalid')).toBe('true');
    });

    it('shows a refusal and stays on the form so the person can try again', async () => {
      render(<App config={config()} />);
      post.mockRejectedValue(new AgentFlowError(422, 'VALIDATION_FAILED', 'summary is too long'));
      await type(field(/summary/i), 'x');
      await submit();
      expect(screen.getByRole('alert').textContent).toMatch(/summary is too long/);
      expect(location.hash).toBe('#/start');
      expect(field(/summary/i).value).toBe('x');
    });

    it('does not start twice while the first start is in flight', async () => {
      render(<App config={config()} />);
      post.mockReturnValue(new Promise(() => {}));
      await type(field(/summary/i), 'x');
      await submit();
      await submit();
      expect(post).toHaveBeenCalledOnce();
    });

    it('a 401 sends the person to sign-in, as the elements do', async () => {
      render(<App config={config()} />);
      post.mockRejectedValue(new AgentFlowError(401, 'UNAUTHENTICATED'));
      await type(field(/summary/i), 'x');
      await submit();
      expect(signIn).toHaveBeenCalledWith('/#/start');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a lost access shows the no-access notice', async () => {
      render(<App config={config()} />);
      post.mockRejectedValue(new AgentFlowError(403, 'APP_NOT_ASSIGNED'));
      await type(field(/summary/i), 'x');
      await submit();
      expect(screen.getByRole('heading').textContent).toMatch(/not in this app's audience/);
    });

    it('puts a bad amount under Amount instead of dropping it', async () => {
      render(<App config={config()} />);
      await type(field(/summary/i), 'x');
      // jsdom has no number parsing, so say what the browser says of text it cannot read.
      Object.defineProperty(field(/amount/i), 'validity', { value: { badInput: true } });
      await submit();
      expect(post).not.toHaveBeenCalled();
      expect(field(/amount/i).getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('Enter the amount as a number.')).toBeTruthy();
    });

    it('puts a field error under its field and focuses Summary on an empty submit', async () => {
      render(<App config={config()} />);
      await submit();
      expect(document.activeElement).toBe(field(/summary/i));
      expect(field(/summary/i).getAttribute('aria-describedby')).toBeTruthy();
      post.mockRejectedValue(new AgentFlowError(422, 'VALIDATION_FAILED', 'bad', undefined, [{ path: 'input.amount', message: 'must be at least 0' }]));
      await type(field(/summary/i), 'x');
      await submit();
      expect(field(/amount/i).getAttribute('aria-describedby')).toBeTruthy();
      expect(screen.getByText('must be at least 0')).toBeTruthy();
      expect(screen.queryByText('bad')).toBeNull();
    });

    it('keeps the error in the current language', async () => {
      render(<App config={config()} />);
      await submit();
      expect(screen.getByRole('alert').textContent).toBe('Enter a summary for the case.');
      await act(async () => screen.getByRole('button', { name: 'Tiếng Việt' }).click());
      expect(screen.getByRole('alert').textContent).toBe('Hãy nhập tóm tắt cho hồ sơ.');
    });

    it('marks the button busy while sending', async () => {
      render(<App config={config()} />);
      post.mockReturnValue(new Promise(() => {}));
      await type(field(/summary/i), 'x');
      await submit();
      expect(screen.getByRole('button', { name: 'Starting…' }).getAttribute('aria-busy')).toBe('true');
    });

    it('cuts a long summary without splitting a character', async () => {
      render(<App config={config()} />);
      post.mockResolvedValue({ data: { id: T }, response: new Response(null, { status: 201 }) });
      await type(field(/summary/i), '😀'.repeat(130));
      await submit();
      const name = (post.mock.calls[0]![1] as { body: { name: string } }).body.name;
      expect(Array.from(name)).toHaveLength(120);
      expect(name).toBe('😀'.repeat(120));
    });

    it('is in Vietnamese after the switch', async () => {
      render(<App config={config()} />);
      await act(async () => screen.getByRole('button', { name: 'Tiếng Việt' }).click());
      expect(screen.getByLabelText(/Tóm tắt/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeTruthy();
    });
  });
});
