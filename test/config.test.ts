import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig, publicConfig, serverOptions } from '../server/config.js';
import { IdpUnavailable, MemorySessionStore, describeError } from '@reflexify/agentflow-sdk/server';

// The error classes the SDK's openid-client really throws, loaded from where the SDK resolves it:
// openid-client is the SDK's dependency, not Case desk's.
const sdkRequire = createRequire(new URL('../node_modules/@reflexify/agentflow-sdk/package.json', import.meta.url));
const oauth = (await import(pathToFileURL(sdkRequire.resolve('openid-client')).href)) as {
  ResponseBodyError: new (message: string, options: { cause: Record<string, unknown>; response: Response }) => Error;
  AuthorizationResponseError: new (message: string, options: { cause: URLSearchParams }) => Error;
  WWWAuthenticateChallengeError: new (message: string, options: { cause: unknown[]; response: Response }) => Error;
  ClientError: new (message: string, options?: { cause?: unknown; code?: string }) => Error;
};

let pem = '';
beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  pem = await exportPKCS8(privateKey);
});

const KEY = Buffer.alloc(32, 7).toString('base64url');
const base = () => ({
  AGENTFLOW_ISSUER: 'https://id.example',
  AGENTFLOW_PRIVATE_KEY_ID: 'k1',
  CASE_DESK_SESSION_KEY: KEY,
});
const reader = (content: string) => async () => content;

describe('loadConfig', () => {
  it('applies the defaults', async () => {
    const c = await loadConfig(base(), reader(pem));
    expect(c).toMatchObject({
      origin: 'http://localhost:5173',
      clientId: 'case-desk-dev',
      apiBaseUrl: 'http://localhost:8080/api/v1',
      resource: 'http://localhost:8080/api/v1/rest',
      allowInsecureRequests: false,
      port: 5173,
    });
  });
  it('derives the resource from a deployed API base and trims slashes', async () => {
    const c = await loadConfig({ ...base(), AGENTFLOW_API_BASE_URL: 'https://af.example/api/v1/' }, reader(pem));
    expect(c.apiBaseUrl).toBe('https://af.example/api/v1');
    expect(c.resource).toBe('https://af.example/api/v1/rest');
  });
  it('keeps a path prefix on the API base in the derived resource', async () => {
    const c = await loadConfig({ ...base(), AGENTFLOW_API_BASE_URL: 'https://x.example/af/api/v1' }, reader(pem));
    expect(c.resource).toBe('https://x.example/af/api/v1/rest');
  });
  it('takes AGENTFLOW_RESOURCE as given when it is set', async () => {
    const c = await loadConfig(
      { ...base(), AGENTFLOW_API_BASE_URL: 'https://x.example/api/v1', AGENTFLOW_RESOURCE: 'https://api.x.example/rest' },
      reader(pem),
    );
    expect(c.resource).toBe('https://api.x.example/rest');
  });
  for (const apiBase of ['af.example/api/v1', 'localhost:8080/api/v1']) {
    it(`refuses the API base ${apiBase}, which has no scheme, even with AGENTFLOW_RESOURCE set`, async () => {
      await expect(
        loadConfig({ ...base(), AGENTFLOW_API_BASE_URL: apiBase, AGENTFLOW_RESOURCE: 'https://af.example/api/v1/rest' }, reader(pem)),
      ).rejects.toThrow(/AGENTFLOW_API_BASE_URL/);
    });
  }
  it('lists every configuration problem at once', async () => {
    const err = await loadConfig(
      { CASE_DESK_ENTITY_ID: 'not-a-uuid' },
      async () => {
        throw new Error('ENOENT');
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    for (const name of ['AGENTFLOW_ISSUER', 'AGENTFLOW_PRIVATE_KEY_ID', 'CASE_DESK_SESSION_KEY', 'CASE_DESK_ENTITY_ID', 'AGENTFLOW_PRIVATE_KEY_FILE']) {
      expect(err.message).toContain(name);
    }
    expect(err.message).toContain('run `pnpm setup-keys`');
    expect(err.message).not.toMatch(/pnpm setup`/);
  });
  it('refuses a session key that is not 32 bytes', async () => {
    await expect(loadConfig({ ...base(), CASE_DESK_SESSION_KEY: 'short' }, reader(pem))).rejects.toThrow(/CASE_DESK_SESSION_KEY.*pnpm setup-keys/);
  });
  const STANDARD_BASE64 = Buffer.alloc(32, 0xfb).toString('base64');
  const refused: [string, Record<string, string>, string][] = [
    ['a padded session key', { CASE_DESK_SESSION_KEY: STANDARD_BASE64 }, 'CASE_DESK_SESSION_KEY'],
    ['a session key in the standard base64 alphabet', { CASE_DESK_SESSION_KEY: STANDARD_BASE64.slice(0, 43) }, 'CASE_DESK_SESSION_KEY'],
    ['port 0', { PORT: '0' }, 'PORT'],
    ['port 65536', { PORT: '65536' }, 'PORT'],
    ['a fractional port', { PORT: '80.5' }, 'PORT'],
    ['a port that is not a number', { PORT: 'http' }, 'PORT'],
    ['an origin with a path', { CASE_DESK_ORIGIN: 'http://localhost:5173/desk' }, 'CASE_DESK_ORIGIN'],
    ['an origin with a query', { CASE_DESK_ORIGIN: 'http://localhost:5173/?x=1' }, 'CASE_DESK_ORIGIN'],
    ['an origin without a scheme', { CASE_DESK_ORIGIN: 'localhost:5173' }, 'CASE_DESK_ORIGIN'],
    ['an origin that is not http(s)', { CASE_DESK_ORIGIN: 'ftp://desk.example' }, 'CASE_DESK_ORIGIN'],
    ['an issuer without a scheme', { AGENTFLOW_ISSUER: 'id.example' }, 'AGENTFLOW_ISSUER'],
    ['an issuer that is not http(s)', { AGENTFLOW_ISSUER: 'ftp://id.example' }, 'AGENTFLOW_ISSUER'],
    ['a resource without a scheme', { AGENTFLOW_RESOURCE: 'localhost:8080/api/v1/rest' }, 'AGENTFLOW_RESOURCE'],
    ['a resource that is not a URL', { AGENTFLOW_RESOURCE: 'http//localhost:8080/api/v1/rest' }, 'AGENTFLOW_RESOURCE'],
    ['a resource that is not http(s)', { AGENTFLOW_RESOURCE: 'urn:agentflow:rest' }, 'AGENTFLOW_RESOURCE'],
  ];
  for (const [what, override, name] of refused) {
    it(`refuses ${what}`, async () => {
      const err = await loadConfig({ ...base(), ...override }, reader(pem)).catch((e) => e);
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).toContain(name);
    });
  }
  it('accepts a port in range and an https origin with a trailing slash', async () => {
    const c = await loadConfig({ ...base(), PORT: '8080', CASE_DESK_ORIGIN: 'https://desk.example/' }, reader(pem));
    expect(c).toMatchObject({ port: 8080, origin: 'https://desk.example' });
    expect(serverOptions(c, new MemorySessionStore()).secureCookies).toBe(true);
  });
  it('normalizes the origin, so an upper-case scheme still sets secure cookies and a matching redirect URI', async () => {
    const c = await loadConfig({ ...base(), CASE_DESK_ORIGIN: 'HTTPS://Desk.Example:443/' }, reader(pem));
    expect(c.origin).toBe('https://desk.example');
    const o = serverOptions(c, new MemorySessionStore());
    expect(o.secureCookies).toBe(true);
    expect(o.redirectUri).toBe('https://desk.example/agentflow/auth/callback');
  });
  it('allows plain http only for a local identity provider', async () => {
    const c = await loadConfig({ ...base(), AGENTFLOW_ISSUER: 'http://localhost:8081' }, reader(pem));
    expect(c.allowInsecureRequests).toBe(true);
  });
  it('reads the issuer\'s scheme as a URL does, whatever its case', async () => {
    expect((await loadConfig({ ...base(), AGENTFLOW_ISSUER: 'HTTP://localhost:8081' }, reader(pem))).allowInsecureRequests).toBe(true);
    expect((await loadConfig({ ...base(), AGENTFLOW_ISSUER: 'HTTPS://id.example' }, reader(pem))).allowInsecureRequests).toBe(false);
  });
});

describe('serverOptions and publicConfig', () => {
  it('wires the SDK to this origin and exposes only ids to the browser', async () => {
    const c = await loadConfig({ ...base(), CASE_DESK_ENTITY_ID: '0190c0de-0000-7000-8000-0000000000e1' }, reader(pem));
    const o = serverOptions(c, new MemorySessionStore());
    expect(o).toMatchObject({
      redirectUri: 'http://localhost:5173/agentflow/auth/callback',
      postLogoutRedirectUri: 'http://localhost:5173/',
      basePath: '/agentflow',
      secureCookies: false,
      resource: 'http://localhost:8080/api/v1/rest',
    });
    expect(publicConfig(c)).toEqual({ basePath: '/agentflow', entityId: '0190c0de-0000-7000-8000-0000000000e1', workflowId: null });
    expect(JSON.stringify(publicConfig(c))).not.toContain(KEY);
  });
});

describe('onError', () => {
  afterEach(() => vi.restoreAllMocks());

  const logged = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: Infinity }))).join(' ')).join('\n');
  const TOKENS = { access_token: 'at-secret', refresh_token: 'rt-secret', id_token: 'idt-secret', token_type: 'Bearer' };

  it('logs the route, name, message and code but never the cause, which can hold a token response', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('unexpected ID Token "nonce" claim value'), {
      code: 'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
      cause: { claim: 'nonce', body: TOKENS },
    });
    serverOptions(await loadConfig(base(), reader(pem)), new MemorySessionStore()).onError?.(error, { route: 'callback', summary: describeError(error) });
    const out = logged(spy);
    expect(out).toContain('callback');
    expect(out).toContain('Error');
    expect(out).toContain('unexpected ID Token "nonce" claim value');
    expect(out).toContain('OAUTH_JWT_CLAIM_COMPARISON_FAILED');
    expect(out).not.toMatch(/at-secret|rt-secret|idt-secret/);
  });
  it('logs nothing of a thrown value that is not an Error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    serverOptions(await loadConfig(base(), reader(pem)), new MemorySessionStore()).onError?.(TOKENS, { route: 'refresh', summary: describeError(TOKENS) });
    const out = logged(spy);
    expect(out).toContain('refresh');
    expect(out).not.toMatch(/at-secret|rt-secret|idt-secret/);
  });
  it('names why a refresh failed, from the provider error the SDK keeps as the cause', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = new oauth.ResponseBodyError('server responded with an error in the response body', {
      cause: { error: 'invalid_target', error_description: 'description-secret', ...TOKENS },
      response: new Response(null, { status: 400 }),
    });
    const error = new IdpUnavailable('the identity provider could not refresh the session', { cause: refused });
    serverOptions(await loadConfig(base(), reader(pem)), new MemorySessionStore()).onError?.(error, { route: 'api', summary: describeError(error) });
    expect(spy.mock.calls).toEqual([['[agentflow] api: IdpUnavailable: the identity provider could not refresh the session (invalid_target)']]);
  });
  it('prints the summary the SDK hands it, never its own reading of the error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('raw\nmessage'), { cause: { body: TOKENS } });
    serverOptions(await loadConfig(base(), reader(pem)), new MemorySessionStore()).onError?.(error, { route: 'api', summary: 'SAFE' });
    expect(spy.mock.calls).toEqual([['[agentflow] api: SAFE']]);
  });
});
