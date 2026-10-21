import { getRequestListener } from '@hono/node-server';
import { loadEnv, type Plugin } from 'vite';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const OWNED = ['/agentflow', '/case-desk/', '/plain', '/elements/'];

export const ownedByServer = (url: string | undefined) => OWNED.some((p) => url?.startsWith(p));

export function caseDeskDevServer(): Plugin {
  return {
    name: 'case-desk-server',
    async configureServer(server) {
      const env = { ...process.env, ...loadEnv(server.config.mode, process.cwd(), '') };
      const listener = getRequestListener(createApp(await loadConfig(env)).fetch);
      server.middlewares.use((req, res, next) => {
        if (ownedByServer(req.url)) void listener(req, res);
        else next();
      });
    },
  };
}
