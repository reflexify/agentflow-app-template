import { describeError } from '@reflexify/agentflow-sdk/server';
import { ConfigError, loadConfig, type CaseDeskConfig } from './config.js';

export interface Check { name: string; ok: boolean; detail: string }

export interface CheckOptions { timeoutMs?: number }

const isTimeout = (error: unknown) => error instanceof Error && error.name === 'TimeoutError';

// fetch reports every network failure as "TypeError: fetch failed" and keeps the reason in the
// cause's code, which describeError names as the server's log does.
function explain(error: unknown, timeoutMs: number): string {
  return isTimeout(error) ? `timed out: no answer within ${timeoutMs} ms` : describeError(error);
}

// The URL the SDK's discovery fetches: an issuer that already names a /.well-known/ document is
// fetched as it is and its issuer is taken as given; any other gets the OIDC suffix on its path.
function discoveryUrl(issuer: string): { url: string; direct: boolean } {
  const url = new URL(issuer);
  if (url.href.includes('/.well-known/')) return { url: url.href, direct: true };
  url.pathname = `${url.pathname}/.well-known/openid-configuration`.replace('//', '/');
  return { url: url.href, direct: false };
}

// The SDK compares the two as parsed URLs and nothing looser, so a trailing slash is a mismatch.
function sameIssuer(reported: unknown, configured: string): boolean {
  if (typeof reported !== 'string') return false;
  try {
    return new URL(reported).href === new URL(configured).href;
  } catch {
    return false;
  }
}

function jsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function checkProvider(config: CaseDeskConfig, fetchImpl: typeof fetch, timeoutMs: number): Promise<Check[]> {
  const provider = (ok: boolean, detail: string): Check => ({ name: 'identity provider', ok, detail });
  const notChecked = (why: string): Check => ({ name: 'private_key_jwt', ok: false, detail: `not checked: ${why}` });

  const { url, direct } = discoveryUrl(config.issuer);
  let res: Response;
  let text: string;
  try {
    res = await fetchImpl(url, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (error) {
    return [provider(false, explain(error, timeoutMs)), notChecked('discovery unreachable')];
  }
  if (res.status !== 200) return [provider(false, `discovery answered ${res.status}`), notChecked(`discovery answered ${res.status}`)];
  const doc = jsonObject(text);
  if (!doc) return [provider(false, 'discovery document is not a JSON object'), notChecked('discovery document is not a JSON object')];

  const missing = ['authorization_endpoint', 'token_endpoint', 'jwks_uri'].filter((k) => typeof doc[k] !== 'string');
  const reported = typeof doc.issuer === 'string' ? `issuer ${JSON.stringify(doc.issuer)}` : 'no issuer';
  // Direct mode takes the issuer as given, but the SDK still refuses a document without one.
  const issuerProblem = direct
    ? typeof doc.issuer === 'string' && doc.issuer !== '' ? undefined : 'discovery reports no issuer; the SDK requires one'
    : sameIssuer(doc.issuer, config.issuer)
      ? undefined
      : `discovery reports ${reported}, but AGENTFLOW_ISSUER is ${JSON.stringify(config.issuer)}; the SDK requires them to match exactly`;
  const checks = [
    issuerProblem
      ? provider(false, issuerProblem)
      : missing.length
        ? provider(false, `discovery lacks ${missing.join(', ')}`)
        : provider(true, 'discovery ok'),
  ];

  const methods = doc.token_endpoint_auth_methods_supported;
  if (!Array.isArray(methods)) {
    checks.push({
      name: 'private_key_jwt',
      ok: true,
      detail: "provider does not list its methods; OIDC's default is client_secret_basic, so sign-in may fail if private_key_jwt is not accepted",
    });
  } else {
    const supportsJwt = methods.includes('private_key_jwt');
    checks.push({ name: 'private_key_jwt', ok: supportsJwt, detail: supportsJwt ? 'supported' : `provider offers ${JSON.stringify(methods)}` });
  }
  return checks;
}

async function checkApi(config: CaseDeskConfig, fetchImpl: typeof fetch, timeoutMs: number): Promise<Check> {
  try {
    const res = await fetchImpl(`${config.apiBaseUrl}/caller`, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      name: 'AgentFlow API',
      ok: res.status === 401,
      detail: res.status === 401 ? 'reachable, wants a token' : `GET /caller without a token answered ${res.status}, expected 401`,
    };
  } catch (error) {
    return { name: 'AgentFlow API', ok: false, detail: explain(error, timeoutMs) };
  }
}

export async function runChecks(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  readKey?: (path: string) => Promise<string>,
  { timeoutMs = 10_000 }: CheckOptions = {},
): Promise<Check[]> {
  let config: CaseDeskConfig;
  try {
    config = await loadConfig(env, readKey);
  } catch (error) {
    return [{ name: 'configuration', ok: false, detail: error instanceof ConfigError ? error.message : describeError(error) }];
  }

  const unset = [!config.entityId && 'CASE_DESK_ENTITY_ID', !config.workflowId && 'CASE_DESK_WORKFLOW_ID'].filter(Boolean);
  return [
    { name: 'configuration', ok: true, detail: `client ${config.clientId}, origin ${config.origin}` },
    ...(await checkProvider(config, fetchImpl, timeoutMs)),
    await checkApi(config, fetchImpl, timeoutMs),
    { name: 'demo data', ok: true, detail: unset.length ? `not set: ${unset.join(', ')} (see RUNBOOK.md step 4)` : 'ids set' },
  ];
}
