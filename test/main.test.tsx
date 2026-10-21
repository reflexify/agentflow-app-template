// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@reflexify/agentflow-elements', () => ({ signIn: vi.fn(), signOut: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const start = async (answer: () => Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn(answer));
  await import('../src/main.js');
  return document.getElementById('root')!;
};

describe('main', () => {
  it.each([
    ['answers 500', async () => Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 })],
    ['cannot be reached', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('says so when config.json %s', async (_, answer) => {
    const root = await start(answer);
    await vi.waitFor(() => expect(root.textContent).toBe("Case desk can't load its configuration."));
  });

  it('says so in Vietnamese to a browser that prefers it', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN');
    const root = await start(async () => Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 }));
    await vi.waitFor(() => expect(root.textContent).toBe('Case desk không tải được cấu hình.'));
  });

  it('renders the app with the configuration it fetched', async () => {
    const root = await start(async () => Response.json({ basePath: '/agentflow', entityId: null, workflowId: null }));
    await vi.waitFor(() => expect(root.querySelector('agentflow-provider')?.getAttribute('base-path')).toBe('/agentflow'));
  });
});
