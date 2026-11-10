import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Node by default; a test that needs a DOM says so with a `// @vitest-environment jsdom` first line. A screen test
  // waits up to 5 s for the kit's first render (`asyncUtilTimeout`), which on a busy machine or CI runner takes seconds,
  // so a test gets 30 s: at Vitest's default of 5 s it times out before its own wait can say what it waited for.
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node', testTimeout: 30_000 },
});
