import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { caseDeskDevServer } from './server/vite-plugin.js';

export default defineConfig({
  plugins: [react(), caseDeskDevServer()],
  server: { port: 5173, strictPort: true, host: 'localhost' },
});
