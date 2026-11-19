/**
 * Runs a TypeScript script from this folder, as in `node scripts/run.ts explore`.
 *
 * Vite loads the script, so its imports resolve the way the app's do, with no build step and no second TypeScript
 * setup. Node runs this file as it is, which is why it imports nothing of the project's own.
 */
import { createServer } from 'vite';

const [name] = process.argv.slice(2);
if (!name) {
  console.error('Name a script to run, as in: node scripts/run.ts explore');
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
});
try {
  await server.ssrLoadModule(`/scripts/${name}.ts`);
} finally {
  await server.close();
}
