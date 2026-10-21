import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createAgentFlowServer, MemorySessionStore } from '@reflexify/agentflow-sdk/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, serverOptions } from '../server/config.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const tsx = join(packageDir, 'node_modules/.bin/tsx');
const script = join(packageDir, 'scripts/setup.ts');
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi'];

let dir = '';
afterEach(async () => {
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
});

// No custom origin or client id from the shell running the tests, and no tsx cache left behind.
const { CASE_DESK_ORIGIN: _origin, AGENTFLOW_CLIENT_ID: _clientId, ...inherited } = process.env;
const setup = (cwd: string, env: Record<string, string> = {}) =>
  spawnSync(tsx, [script], { cwd, encoding: 'utf8', env: { ...inherited, TSX_DISABLE_CACHE: '1', ...env } });

// A copy of the committed template, as a fresh checkout has it.
async function checkout(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'case-desk-setup-'));
  await copyFile(join(packageDir, '.env.example'), join(dir, '.env.example'));
  return dir;
}

const json = async (path: string) => JSON.parse(await readFile(join(dir, path), 'utf8'));

// The generated .env, completed as RUNBOOK.md step 5 does, loaded as `pnpm start` loads it.
async function loadGenerated(override: Record<string, string> = {}) {
  const env = { ...parseEnv(await readFile(join(dir, '.env'), 'utf8')), AGENTFLOW_ISSUER: 'https://id.example', ...override };
  return loadConfig(env, (path) => readFile(resolve(dir, path), 'utf8'));
}

it('stops with a way out when keys/private.pem has no keys/public.jwk.json beside it', async () => {
  dir = await mkdtemp(join(tmpdir(), 'case-desk-setup-'));
  await mkdir(join(dir, 'keys'));
  await writeFile(join(dir, 'keys/private.pem'), 'kept');

  const run = setup(dir);

  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('keys/public.jwk.json');
  expect(run.stderr).toContain('--force');
  expect(run.stderr).not.toContain('ENOENT');
  expect(await readFile(join(dir, 'keys/private.pem'), 'utf8')).toBe('kept');
  expect(existsSync(join(dir, '.env'))).toBe(false);
}, 30_000);

describe('a first run', () => {
  it('registers exactly the URIs the SDK uses, with the public key, and writes a .env that loads', async () => {
    await checkout();
    const run = setup(dir);
    expect(run.status, run.stderr).toBe(0);

    const registration = await json('keys/registration.json');
    const publicJwk = await json('keys/public.jwk.json');
    const config = await loadGenerated();
    const options = serverOptions(config, new MemorySessionStore());

    expect(registration.client_id).toBe(config.clientId);
    expect(registration.redirect_uris).toEqual([options.redirectUri]);
    expect(registration.post_logout_redirect_uris).toEqual([options.postLogoutRedirectUri]);
    expect(new URL(registration.backchannel_logout_uri).origin).toBe(config.origin);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const backchannel = await createAgentFlowServer(options).handle(new Request(registration.backchannel_logout_uri, { method: 'POST' }));
    expect(backchannel?.status, 'the SDK answers at the registered back-channel logout URI').toBe(400);

    expect(registration.jwks).toEqual({ keys: [publicJwk] });
    expect(publicJwk).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: config.privateKeyId });
    for (const member of PRIVATE_MEMBERS) expect(registration.jwks.keys[0]).not.toHaveProperty(member);

    expect((await stat(join(dir, '.env'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'keys/private.pem'))).mode & 0o777).toBe(0o600);
  }, 30_000);

  it('registers the origin as loadConfig normalises it, and the client id it was given', async () => {
    await checkout();
    const custom = { CASE_DESK_ORIGIN: 'HTTPS://Cases.Example.com:443/', AGENTFLOW_CLIENT_ID: 'case-desk-prod' };
    const run = setup(dir, custom);
    expect(run.status, run.stderr).toBe(0);

    const registration = await json('keys/registration.json');
    const options = serverOptions(await loadGenerated(custom), new MemorySessionStore());
    expect(registration).toMatchObject({
      client_id: 'case-desk-prod',
      redirect_uris: [options.redirectUri],
      post_logout_redirect_uris: [options.postLogoutRedirectUri],
      backchannel_logout_uri: 'https://cases.example.com/agentflow/auth/backchannel-logout',
    });
    expect(options.redirectUri).toBe('https://cases.example.com/agentflow/auth/callback');
  }, 30_000);

  it('refuses an origin loadConfig would refuse, before writing anything', async () => {
    await checkout();
    const run = setup(dir, { CASE_DESK_ORIGIN: 'cases.example.com' });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('CASE_DESK_ORIGIN must be an http(s) origin with no path');
    expect(existsSync(join(dir, 'keys'))).toBe(false);
    expect(existsSync(join(dir, '.env'))).toBe(false);
  }, 30_000);
});

describe('a rerun that keeps the key', () => {
  const RSA = { kty: 'RSA', n: 'modulus', e: 'AQAB' };

  async function kept(publicJwk: string) {
    await checkout();
    await mkdir(join(dir, 'keys'));
    await writeFile(join(dir, 'keys/private.pem'), 'kept');
    await writeFile(join(dir, 'keys/public.jwk.json'), publicJwk);
    return setup(dir);
  }

  const broken: [string, string][] = [
    ['no kid', JSON.stringify(RSA)],
    ['a kid that is not a string', JSON.stringify({ ...RSA, kid: 42 })],
    ['an empty kid', JSON.stringify({ ...RSA, kid: '' })],
    ['a kid with a line break', JSON.stringify({ ...RSA, kid: 'k1\nCASE_DESK_SESSION_KEY=x' })],
    ['no public key', JSON.stringify({ kid: 'k1' })],
    ['a file that is not JSON', '{"kid":'],
  ];
  for (const [what, file] of broken) {
    it(`stops with a way out when keys/public.jwk.json has ${what}`, async () => {
      const run = await kept(file);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('keys/public.jwk.json');
      expect(run.stderr).toContain('--force');
      expect(`${run.stdout}${run.stderr}`).not.toMatch(/undefined|SyntaxError/);
      expect(existsSync(join(dir, 'keys/registration.json'))).toBe(false);
      expect(existsSync(join(dir, '.env'))).toBe(false);
    }, 30_000);
  }

  it('registers only the public members of the kept key', async () => {
    const withPrivate = { ...RSA, kid: 'k1', d: 'private-d', p: 'private-p', q: 'private-q', dp: 'private-dp', dq: 'private-dq', qi: 'private-qi' };
    const run = await kept(JSON.stringify(withPrivate));
    expect(run.status, run.stderr).toBe(0);
    const registration = await json('keys/registration.json');
    expect(registration.jwks).toEqual({ keys: [{ ...RSA, kid: 'k1', alg: 'RS256', use: 'sig' }] });
    expect(JSON.stringify(registration)).not.toContain('private-');
    expect(parseEnv(await readFile(join(dir, '.env'), 'utf8')).AGENTFLOW_PRIVATE_KEY_ID).toBe('k1');
  }, 30_000);
});
