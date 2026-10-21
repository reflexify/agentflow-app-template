import { expect, it } from 'vitest';
import { ownedByServer } from '../server/vite-plugin.js';

it('hands the server its own paths and leaves the rest to Vite', () => {
  for (const url of ['/agentflow/auth/login', '/agentflow/api/caller', '/agentflow/session', '/case-desk/config.json', '/plain', '/elements/agentflow-elements.js']) {
    expect(ownedByServer(url), url).toBe(true);
  }
  for (const url of ['/', '/index.html', '/src/main.tsx', '/@vite/client', '/node_modules/.vite/deps/react.js', '/case-desk', undefined]) {
    expect(ownedByServer(url), String(url)).toBe(false);
  }
});
