import { exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runChecks, type Check } from '../server/checks.js';
import { loadConfig } from '../server/config.js';

let pem = '';
beforeAll(async () => {
  pem = await exportPKCS8((await generateKeyPair('RS256', { extractable: true })).privateKey);
});
const env = {
  AGENTFLOW_ISSUER: 'https://id.example',
  AGENTFLOW_PRIVATE_KEY_ID: 'k1',
  CASE_DESK_SESSION_KEY: Buffer.alloc(32, 2).toString('base64url'),
};
const discovery = {
  issuer: 'https://id.example',
  authorization_endpoint: 'https://id.example/authorize',
  token_endpoint: 'https://id.example/token',
  jwks_uri: 'https://id.example/jwks',
  token_endpoint_auth_methods_supported: ['private_key_jwt'],
};
const fakeFetch = (routes: Record<string, () => Response>) =>
  (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const hit = routes[url];
    if (!hit) throw new TypeError(`fetch failed: ${url}`);
    return hit();
  }) as typeof fetch;

describe('doctor checks', () => {
  it('passes when the provider and AgentFlow answer as expected', async () => {
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json(discovery),
      'http://localhost:8080/api/v1/caller': () => new Response(null, { status: 401 }),
    }), async () => pem);
    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ['configuration', true], ['identity provider', true], ['private_key_jwt', true], ['AgentFlow API', true], ['demo data', true],
    ]);
    expect(checks.at(-1)!.detail).toMatch(/not set/);
  });
  it('doctor names each failing check', async () => {
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json({ ...discovery, issuer: 'https://other.example', token_endpoint_auth_methods_supported: ['client_secret_basic'] }),
    }), async () => pem);
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(['identity provider', 'private_key_jwt', 'AgentFlow API']);
    expect(checks.find((c) => c.name === 'AgentFlow API')!.detail).toMatch(/fetch failed/);
  });
  it('does not vouch for private_key_jwt when discovery does not answer 200', async () => {
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => new Response('not found', { status: 404 }),
      'http://localhost:8080/api/v1/caller': () => new Response(null, { status: 401 }),
    }), async () => pem);
    expect(checks.slice(1, 3)).toEqual([
      { name: 'identity provider', ok: false, detail: 'discovery answered 404' },
      { name: 'private_key_jwt', ok: false, detail: 'not checked: discovery answered 404' },
    ]);
  });
  it('passes a provider that does not list its token endpoint auth methods, and names the OIDC default', async () => {
    const bare: Record<string, unknown> = { ...discovery };
    delete bare.token_endpoint_auth_methods_supported;
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json(bare),
      'http://localhost:8080/api/v1/caller': () => new Response(null, { status: 401 }),
    }), async () => pem);
    expect(checks.find((c) => c.name === 'private_key_jwt')).toEqual({
      name: 'private_key_jwt',
      ok: true,
      detail: "provider does not list its methods; OIDC's default is client_secret_basic, so sign-in may fail if private_key_jwt is not accepted",
    });
  });
  it('names why a host could not be reached, with the code fetch keeps in the cause, as the server log does', async () => {
    const refused = (async () => {
      const cause = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
      throw new TypeError('fetch failed', { cause });
    }) as typeof fetch;
    const notFound = (async () => {
      const cause = Object.assign(new Error('getaddrinfo ENOTFOUND id.example'), { code: 'ENOTFOUND' });
      throw new TypeError('fetch failed', { cause });
    }) as typeof fetch;
    const api = (await runChecks(env, refused, async () => pem)).find((c) => c.name === 'AgentFlow API')!;
    expect(api).toEqual({ name: 'AgentFlow API', ok: false, detail: 'TypeError: fetch failed (ECONNREFUSED)' });
    const idp = (await runChecks(env, notFound, async () => pem)).find((c) => c.name === 'identity provider')!;
    expect(idp.detail).toBe('TypeError: fetch failed (ENOTFOUND)');
  });
  it('drops a cause code outside RFC 6749\'s error charset, as the server log does', async () => {
    const hostile = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(''), { code: 'E\u001b[2KFORGED' }) });
    }) as typeof fetch;
    const api = (await runChecks(env, hostile, async () => pem)).find((c) => c.name === 'AgentFlow API')!;
    expect(api.detail).toBe('TypeError: fetch failed');
  });
  it('fails the configuration for a mistyped AGENTFLOW_RESOURCE, before the provider sees it', async () => {
    const checks = await runChecks({ ...env, AGENTFLOW_RESOURCE: 'http//localhost:8080/api/v1/rest' }, fakeFetch({}), async () => pem);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: 'configuration', ok: false });
    expect(checks[0]!.detail).toContain('AGENTFLOW_RESOURCE must be an absolute http(s) URL');
  });
  it('stops after a configuration failure, with loadConfig\'s own message', async () => {
    const checks = await runChecks({}, fakeFetch({}), async () => pem);
    expect(checks).toHaveLength(1);
    const message = await loadConfig({}, async () => pem).then(
      () => 'loaded',
      (error: Error) => error.message,
    );
    expect(checks[0]).toEqual({ name: 'configuration', ok: false, detail: message });
  });
});

const API = 'http://localhost:8080/api/v1/caller';
const wants401 = () => new Response(null, { status: 401 });
const find = (checks: Check[], name: string) => checks.find((c) => c.name === name);

describe('the issuer, as the SDK compares it', () => {
  const PATH_DISCOVERY = 'https://host.example/realms/x/.well-known/openid-configuration';
  const pathDiscovery = { ...discovery, issuer: 'https://host.example/realms/x' };

  it('fails a path issuer that differs from discovery only by a trailing slash, and names both', async () => {
    const checks = await runChecks({ ...env, AGENTFLOW_ISSUER: 'https://host.example/realms/x/' }, fakeFetch({
      [PATH_DISCOVERY]: () => Response.json(pathDiscovery),
      [API]: wants401,
    }), async () => pem);
    expect(find(checks, 'identity provider')).toEqual({
      name: 'identity provider',
      ok: false,
      detail: 'discovery reports issuer "https://host.example/realms/x", but AGENTFLOW_ISSUER is "https://host.example/realms/x/"; the SDK requires them to match exactly',
    });
  });
  it('passes the same path issuer written exactly as discovery reports it', async () => {
    const checks = await runChecks({ ...env, AGENTFLOW_ISSUER: 'https://host.example/realms/x' }, fakeFetch({
      [PATH_DISCOVERY]: () => Response.json(pathDiscovery),
      [API]: wants401,
    }), async () => pem);
    expect(find(checks, 'identity provider')).toEqual({ name: 'identity provider', ok: true, detail: 'discovery ok' });
  });
  it('passes an origin-only issuer whether or not either side writes the slash, as the parsed URLs are equal', async () => {
    for (const [configured, reported] of [['https://id.example', 'https://id.example/'], ['https://id.example/', 'HTTPS://ID.example']]) {
      const checks = await runChecks({ ...env, AGENTFLOW_ISSUER: configured }, fakeFetch({
        'https://id.example/.well-known/openid-configuration': () => Response.json({ ...discovery, issuer: reported }),
        [API]: wants401,
      }), async () => pem);
      expect(find(checks, 'identity provider'), `${configured} vs ${reported}`).toEqual({ name: 'identity provider', ok: true, detail: 'discovery ok' });
    }
  });
  it('treats an issuer that is not a URL as a mismatch rather than throwing', async () => {
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json({ ...discovery, issuer: 'not a url' }),
      [API]: wants401,
    }), async () => pem);
    expect(find(checks, 'identity provider')).toEqual({
      name: 'identity provider',
      ok: false,
      detail: 'discovery reports issuer "not a url", but AGENTFLOW_ISSUER is "https://id.example"; the SDK requires them to match exactly',
    });
  });
  it('says so when discovery reports no issuer at all', async () => {
    const { issuer: _issuer, ...noIssuer } = discovery;
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json(noIssuer),
      [API]: wants401,
    }), async () => pem);
    expect(find(checks, 'identity provider')!.detail).toBe(
      'discovery reports no issuer, but AGENTFLOW_ISSUER is "https://id.example"; the SDK requires them to match exactly',
    );
  });
  it('fetches an issuer that already names a discovery document as it is, and, like the SDK, compares no issuer', async () => {
    const checks = await runChecks({ ...env, AGENTFLOW_ISSUER: 'https://id.example/.well-known/openid-configuration' }, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json(discovery),
      [API]: wants401,
    }), async () => pem);
    expect(find(checks, 'identity provider')).toMatchObject({ ok: true });
  });
  for (const [what, issuer] of [['no issuer', undefined], ['an empty issuer', ''], ['an issuer that is not a string', 42]] as const) {
    it(`fails an issuer that names a discovery document reporting ${what}, which the SDK refuses too`, async () => {
      const checks = await runChecks({ ...env, AGENTFLOW_ISSUER: 'https://id.example/.well-known/openid-configuration' }, fakeFetch({
        'https://id.example/.well-known/openid-configuration': () => Response.json({ ...discovery, issuer }),
        [API]: wants401,
      }), async () => pem);
      expect(find(checks, 'identity provider')).toEqual({
        name: 'identity provider',
        ok: false,
        detail: 'discovery reports no issuer; the SDK requires one',
      });
    });
  }
  it('asks for JSON without following a redirect, and fails a discovery that answers anything but 200', async () => {
    const seen: RequestInit[] = [];
    const redirecting = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === API) return wants401();
      seen.push(init ?? {});
      return init?.redirect === 'manual'
        ? new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/openid-configuration' } })
        : Response.json(discovery);
    }) as typeof fetch;
    const checks = await runChecks(env, redirecting, async () => pem);
    expect(seen).toHaveLength(1);
    expect(new Headers(seen[0]!.headers).get('accept')).toBe('application/json');
    expect(checks.slice(1, 3)).toEqual([
      { name: 'identity provider', ok: false, detail: 'discovery answered 302' },
      { name: 'private_key_jwt', ok: false, detail: 'not checked: discovery answered 302' },
    ]);
  });
});

describe('a discovery document that is not a JSON object', () => {
  const bodies: [string, () => Response][] = [
    ['an HTML page', () => new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['JSON null', () => Response.json(null)],
    ['a JSON array', () => Response.json([discovery])],
    ['a JSON string', () => Response.json('https://id.example')],
  ];
  for (const [what, body] of bodies) {
    it(`fails the provider and leaves private_key_jwt unchecked for ${what}`, async () => {
      const checks = await runChecks(env, fakeFetch({
        'https://id.example/.well-known/openid-configuration': body,
        [API]: wants401,
      }), async () => pem);
      expect(checks.slice(1, 3)).toEqual([
        { name: 'identity provider', ok: false, detail: 'discovery document is not a JSON object' },
        { name: 'private_key_jwt', ok: false, detail: 'not checked: discovery document is not a JSON object' },
      ]);
    });
  }
});

describe('timeouts', () => {
  afterEach(() => vi.restoreAllMocks());

  const silent = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as typeof fetch;

  it('gives up on a host that never answers, and says it timed out', async () => {
    const checks = await runChecks(env, silent, async () => pem, { timeoutMs: 20 });
    expect(checks.slice(1, 4)).toEqual([
      { name: 'identity provider', ok: false, detail: 'timed out: no answer within 20 ms' },
      { name: 'private_key_jwt', ok: false, detail: 'not checked: discovery unreachable' },
      { name: 'AgentFlow API', ok: false, detail: 'timed out: no answer within 20 ms' },
    ]);
  });
  it('gives every request ten seconds by default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const signals: (AbortSignal | null | undefined)[] = [];
    const checks = await runChecks(env, (async (input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return String(input) === API ? wants401() : Response.json(discovery);
    }) as typeof fetch, async () => pem);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(timeout.mock.calls).toEqual([[10_000], [10_000]]);
    expect(signals).toEqual(timeout.mock.results.map((r) => r.value));
  });
});

describe('the other branches', () => {
  it('names the endpoints discovery lacks', async () => {
    const { authorization_endpoint: _a, jwks_uri: _j, ...partial } = discovery;
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json(partial),
      [API]: wants401,
    }), async () => pem);
    expect(find(checks, 'identity provider')).toEqual({
      name: 'identity provider',
      ok: false,
      detail: 'discovery lacks authorization_endpoint, jwks_uri',
    });
  });
  it('fails an API that answers anything but 401 without a token', async () => {
    const checks = await runChecks(env, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json(discovery),
      [API]: () => Response.json({ kind: 'user' }),
    }), async () => pem);
    expect(find(checks, 'AgentFlow API')).toEqual({
      name: 'AgentFlow API',
      ok: false,
      detail: 'GET /caller without a token answered 200, expected 401',
    });
  });
  it('reports the demo ids as set when both are', async () => {
    const checks = await runChecks({
      ...env,
      CASE_DESK_ENTITY_ID: '0190c0de-0000-7000-8000-0000000000e1',
      CASE_DESK_WORKFLOW_ID: '0190c0de-0000-7000-8000-0000000000f1',
    }, fakeFetch({
      'https://id.example/.well-known/openid-configuration': () => Response.json(discovery),
      [API]: wants401,
    }), async () => pem);
    expect(checks.at(-1)).toEqual({ name: 'demo data', ok: true, detail: 'ids set' });
  });
  it('describes a thrown value that is not an Error without printing it', async () => {
    const throwsObject = (async () => {
      throw { token: 'not-for-the-terminal' };
    }) as typeof fetch;
    const checks = await runChecks(env, throwsObject, async () => pem);
    expect(find(checks, 'identity provider')).toEqual({ name: 'identity provider', ok: false, detail: 'a thrown object' });
    expect(find(checks, 'AgentFlow API')).toEqual({ name: 'AgentFlow API', ok: false, detail: 'a thrown object' });
  });
});
