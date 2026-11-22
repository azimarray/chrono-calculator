/* Bundles tests/logic.test.ts (it imports the app's TypeScript/React sources) with esbuild and runs it. */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'chrono-logic-'));
const out = join(dir, 'logic.test.mjs');
try {
  await build({
    entryPoints: [fileURLToPath(new URL('./logic.test.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    outfile: out,
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await import(pathToFileURL(out).href);
} finally {
  await rm(dir, { recursive: true, force: true });
}
