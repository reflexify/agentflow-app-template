import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import type { AgentFlowServer } from '@reflexify/agentflow-sdk/server';
import { HTTPException } from 'hono/http-exception';
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, missingBuild } from '../server/app.js';
import { loadConfig, type CaseDeskConfig } from '../server/config.js';

let config: CaseDeskConfig;
beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  config = await loadConfig(
    {
      AGENTFLOW_ISSUER: 'https://id.example',
      AGENTFLOW_PRIVATE_KEY_ID: 'k1',
      CASE_DESK_SESSION_KEY: Buffer.alloc(32, 1).toString('base64url'),
      CASE_DESK_WORKFLOW_ID: '0190c0de-0000-7000-8000-0000000000f1',
    },
    async () => pem,
  );
});

const get = (app: ReturnType<typeof createApp>, path: string) => app.request(`http://localhost:5173${path}`);

describe('case desk server', () => {
  it('mounts the SDK routes', async () => {
    const res = await get(createApp(config), '/agentflow/session');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false });
  });
  it('serves the browser config with ids and nothing secret', async () => {
    const res = await get(createApp(config), '/case-desk/config.json');
    expect(await res.json()).toEqual({ basePath: '/agentflow', entityId: null, workflowId: '0190c0de-0000-7000-8000-0000000000f1' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('serves the plain page and the elements bundle', async () => {
    const app = createApp(config);
    const page = await get(app, '/plain');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await page.text()).toBe(await readFile(new URL('../static/plain.html', import.meta.url), 'utf8'));
    const bundle = await get(app, '/elements/agentflow-elements.js');
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toMatch(/javascript/);
    expect(await bundle.text()).toContain('agentflow-provider');
  });
  it('proxies only published operations, so an internal route never leaves the server', async () => {
    const res = await get(createApp(config), '/agentflow/api/admin/apps');
    expect(res.status).toBe(404);
    expect((await res.json()).type).toBe('NOT_PUBLISHED');
  });
  it('answers 404 for an unknown path when no static directory is configured', async () => {
    expect((await get(createApp(config), '/nope')).status).toBe(404);
  });
});

describe('case desk server with a built app', () => {
  let dist: string;
  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'case-desk-dist-'));
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>built app</title>');
    await writeFile(join(dist, 'assets', 'app.js'), 'console.log("built");');
    // Files at the paths the app and the SDK own, which must never be the answer.
    await mkdir(join(dist, 'case-desk'));
    await writeFile(join(dist, 'case-desk', 'config.json'), '{"from":"a file"}');
    await mkdir(join(dist, 'agentflow'));
    await writeFile(join(dist, 'agentflow', 'session'), '{"from":"a file"}');
  });
  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  it('serves index.html at / and the built assets', async () => {
    const app = createApp(config, { staticDir: dist });
    const page = await get(app, '/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await page.text()).toContain('<title>built app</title>');
    const asset = await get(app, '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect(await asset.text()).toBe('console.log("built");');
  });
  it('answers the config and the SDK routes itself, never from a file', async () => {
    const app = createApp(config, { staticDir: dist });
    expect(await (await get(app, '/case-desk/config.json')).json()).toEqual({
      basePath: '/agentflow',
      entityId: null,
      workflowId: '0190c0de-0000-7000-8000-0000000000f1',
    });
    expect(await (await get(app, '/agentflow/session')).json()).toEqual({ signedIn: false });
  });
  it('answers 404 for an unknown path, a missing asset or an SDK path it does not handle', async () => {
    const app = createApp(config, { staticDir: dist });
    for (const path of ['/nope', '/assets/missing.js', '/agentflow/nope']) {
      expect((await get(app, path)).status, path).toBe(404);
    }
  });
});

describe('the production entry point', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('refuses to serve a directory with no build, and says to run pnpm build:site first', async () => {
    dir = await mkdtemp(join(tmpdir(), 'case-desk-unbuilt-'));
    expect(missingBuild(dir)).toBe(`Case desk has no build to serve (${join(dir, 'index.html')} is missing): run \`pnpm build:site\` first.`);
    expect(missingBuild(join(dir, 'dist'))).toMatch(/run `pnpm build:site` first/);
  });
  it('serves a directory holding index.html', async () => {
    dir = await mkdtemp(join(tmpdir(), 'case-desk-built-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html>');
    expect(missingBuild(dir)).toBeUndefined();
  });
});

describe('an error that escapes a route', () => {
  afterEach(() => vi.restoreAllMocks());

  const logged = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: Infinity }))).join(' ')).join('\n');

  it('answers a short bilingual 500 page and logs the path, name, message and code, never the cause or the query', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new TypeError('discovery of id.example failed'), {
      code: 'OAUTH_DISCOVERY_FAILED',
      cause: { body: { refresh_token: 'rt-secret-in-cause' } },
    });
    const agentflow: AgentFlowServer = {
      handle: async () => {
        throw error;
      },
      clientFor: async () => undefined,
    };
    const res = await get(createApp(config, { agentflow }), '/agentflow/auth/callback?code=code-secret-in-query&state=s1');

    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    const out = logged(spy);
    expect(out).toContain('/agentflow/auth/callback');
    expect(out).toContain('TypeError: discovery of id.example failed (OAUTH_DISCOVERY_FAILED)');
    expect(out).not.toContain('rt-secret-in-cause');
    expect(out).not.toContain('code-secret-in-query');
    expect(out).not.toContain('[object Object]');
    expect(out).not.toContain('\n');

    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const body = await res.text();
    expect(body).toMatch(/try again/i);
    expect(body).toMatch(/thử lại/);
    expect(body).not.toContain('discovery of id.example failed');
    expect(body).not.toContain('rt-secret-in-cause');
    expect(body).not.toContain('OAUTH_DISCOVERY_FAILED');
  });

  const throwing = (error: unknown): AgentFlowServer => ({
    handle: async () => {
      throw error;
    },
    clientFor: async () => undefined,
  });

  it('logs the path as the request wrote it, so an encoded control character never reaches the terminal', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(config, { agentflow: throwing(new Error('boom')) });
    for (const path of ['/agentflow/auth/login%1B[2K%1B[1Gforged', '/agentflow/auth/login%09forged']) {
      expect((await get(app, path)).status, path).toBe(500);
    }
    expect(spy.mock.calls).toEqual([
      ['[case-desk] /agentflow/auth/login%1B[2K%1B[1Gforged: Error: boom'],
      ['[case-desk] /agentflow/auth/login%09forged: Error: boom'],
    ]);
  });
  it('names why AgentFlow could not be reached, from the code fetch keeps in the cause', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = Object.assign(new AggregateError([], 'connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' });
    const res = await get(createApp(config, { agentflow: throwing(new TypeError('fetch failed', { cause })) }), '/agentflow/api/caller');
    expect(res.status).toBe(500);
    expect(spy.mock.calls).toEqual([['[case-desk] /agentflow/api/caller: TypeError: fetch failed (ECONNREFUSED)']]);
  });
  it('never reaches a route, and so logs nothing, for a path with an encoded newline', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(createApp(config, { agentflow: throwing(new Error('boom')) }), '/agentflow/auth/login%0A[case-desk]%20forged');
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
  it('answers an HTTPException with its own response, not the 500 page, and logs nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(createApp(config, { agentflow: throwing(new HTTPException(403, { message: 'not for you' })) }), '/agentflow/session');
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('not for you');
    expect(spy).not.toHaveBeenCalled();
  });
});
