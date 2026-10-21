import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { exportJWK, exportPKCS8, generateKeyPair, type JWK } from 'jose';
import { DEFAULT_ORIGIN, ORIGIN_RULE, originOf } from '../server/config.js';

const force = process.argv.includes('--force');
const origin = originOf(process.env.CASE_DESK_ORIGIN?.trim() || DEFAULT_ORIGIN);
const clientId = process.env.AGENTFLOW_CLIENT_ID?.trim() || 'case-desk-dev';
if (!origin) {
  console.error(ORIGIN_RULE);
  process.exit(1);
}

// It goes into .env and every client assertion's header, so nothing that could break a line.
const KID = /^[\x21-\x7E]+$/;

// Built member by member, so no private member (d, p, q, dp, dq, qi) can reach the registration.
function publicKeyOf(value: unknown): JWK | undefined {
  const { kty, n, e, kid } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (kty !== 'RSA' || typeof n !== 'string' || typeof e !== 'string' || typeof kid !== 'string' || !KID.test(kid)) return undefined;
  return { kty, n, e, kid, alg: 'RS256', use: 'sig' };
}

async function keptPublicKey(): Promise<JWK | undefined> {
  try {
    return publicKeyOf(JSON.parse(await readFile('keys/public.jwk.json', 'utf8')));
  } catch {
    return undefined;
  }
}

await mkdir('keys', { recursive: true });
let jwk: JWK;
if (existsSync('keys/private.pem') && !force) {
  if (!existsSync('keys/public.jwk.json')) {
    console.error(
      'keys/private.pem exists but keys/public.jwk.json does not, so the key id is unknown.\n' +
        'Rerun with --force to make a new key pair: pnpm setup-keys --force',
    );
    process.exit(1);
  }
  const kept = await keptPublicKey();
  if (!kept) {
    console.error(
      'keys/public.jwk.json is not the public half of an RSA key with a key id (kid), so it cannot be registered.\n' +
        'Rerun with --force to make a new key pair: pnpm setup-keys --force',
    );
    process.exit(1);
  }
  jwk = kept;
  console.log(`keys/private.pem exists; keeping it (kid ${jwk.kid}). Pass --force to replace it.`);
} else {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  await writeFile('keys/private.pem', await exportPKCS8(privateKey), { mode: 0o600 });
  jwk = publicKeyOf({
    ...(await exportJWK(publicKey)),
    kid: `case-desk-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`,
  })!;
  await writeFile('keys/public.jwk.json', `${JSON.stringify(jwk, null, 2)}\n`);
  console.log(`wrote keys/private.pem and keys/public.jwk.json (kid ${jwk.kid})`);
}
const kid = jwk.kid!;

const registration = {
  client_id: clientId,
  display_name: 'Case desk (AgentFlow sample)',
  client_type: 'confidential',
  auth_method: 'private_key_jwt',
  redirect_uris: [`${origin}/agentflow/auth/callback`],
  post_logout_redirect_uris: [`${origin}/`],
  backchannel_logout_uri: `${origin}/agentflow/auth/backchannel-logout`,
  grant_types: ['authorization_code', 'refresh_token'],
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  jwks: { keys: [jwk] },
};
await writeFile('keys/registration.json', `${JSON.stringify(registration, null, 2)}\n`);
console.log('wrote keys/registration.json (the body for POST /api/admin/oauth_clients, public key included; see RUNBOOK.md step 2)');

if (existsSync('.env') && !force) {
  console.log('.env exists; left unchanged. Set AGENTFLOW_PRIVATE_KEY_ID to', kid);
} else {
  const template = await readFile('.env.example', 'utf8');
  const env = template
    .replace(/^CASE_DESK_SESSION_KEY=.*$/m, () => `CASE_DESK_SESSION_KEY=${randomBytes(32).toString('base64url')}`)
    .replace(/^AGENTFLOW_PRIVATE_KEY_ID=.*$/m, () => `AGENTFLOW_PRIVATE_KEY_ID=${kid}`);
  await writeFile('.env', env, { mode: 0o600 });
  console.log('wrote .env with a fresh session key. Fill in AGENTFLOW_ISSUER and the demo ids.');
}
