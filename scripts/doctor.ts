import { runChecks } from '../server/checks.js';

const checks = await runChecks(process.env, fetch);
for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
