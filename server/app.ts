import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { createAgentFlowServer, describeError, MemorySessionStore, type AgentFlowServer } from '@reflexify/agentflow-sdk/server';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { publicConfig, serverOptions, type CaseDeskConfig } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const bundlePath = () =>
  join(dirname(require.resolve('@reflexify/agentflow-elements/package.json')), 'dist', 'agentflow-elements.js');

const UNAVAILABLE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Case desk</title>
<p>Sign-in or this page is unavailable right now. Please try again in a moment.</p>
<p lang="vi">Không thể đăng nhập hoặc mở trang này lúc này. Vui lòng thử lại sau ít phút.</p>
</html>
`;

/** Why `staticDir` cannot be served, or `undefined` when it holds a build. */
export function missingBuild(staticDir: string): string | undefined {
  const index = join(staticDir, 'index.html');
  return existsSync(index) ? undefined : `Case desk has no build to serve (${index} is missing): run \`pnpm build:site\` first.`;
}

export function createApp(config: CaseDeskConfig, opts: { staticDir?: string; agentflow?: AgentFlowServer } = {}): Hono {
  const agentflow = opts.agentflow ?? createAgentFlowServer(serverOptions(config, new MemorySessionStore()));
  const app = new Hono();

  // Hono's default handler prints the whole error, cause included, and a failed token exchange keeps
  // the token response in the cause. The path only, since the callback's query carries the authorization
  // code, and still percent-encoded: c.req.path decodes it, which would print an ESC sequence raw.
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error(`[case-desk] ${new URL(c.req.url).pathname}: ${describeError(error)}`);
    return c.html(UNAVAILABLE, 500);
  });

  app.use('*', async (c, next) => {
    const answer = await agentflow.handle(c.req.raw);
    if (answer) return answer;
    await next();
  });

  app.get('/case-desk/config.json', (c) => {
    c.header('cache-control', 'no-store');
    return c.json(publicConfig(config));
  });

  app.get('/plain', async (c) => c.html(await readFile(join(here, '..', 'static', 'plain.html'), 'utf8')));

  app.get('/elements/agentflow-elements.js', async (c) => {
    c.header('content-type', 'text/javascript; charset=utf-8');
    return c.body(await readFile(bundlePath(), 'utf8'));
  });

  if (opts.staticDir) app.use('/*', serveStatic({ root: opts.staticDir }));
  return app;
}
