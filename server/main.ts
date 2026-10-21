import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp, missingBuild } from './app.js';
import { ConfigError, loadConfig } from './config.js';

const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const unbuilt = missingBuild(staticDir);
if (unbuilt) {
  console.error(unbuilt);
  process.exit(1);
}

try {
  const config = await loadConfig(process.env);
  const app = createApp(config, { staticDir });
  serve({ fetch: app.fetch, port: config.port }, () => console.log(`Case desk on ${config.origin}`));
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
