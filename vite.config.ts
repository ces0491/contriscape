import { readFileSync } from 'node:fs';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

interface VercelHeaders {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

/** The Vercel functions, by the path each answers. */
const FUNCTIONS = ['contributions', 'card', 'share'];

/** Runs the Vercel functions inside the dev server, so `npm run dev` needs no Vercel login. */
function apiInDev(): Plugin {
  return {
    name: 'api-in-dev',
    configureServer(server) {
      for (const name of FUNCTIONS) {
        server.middlewares.use(`/api/${name}`, (req, res, next) => {
          void (async () => {
            const route = (await server.ssrLoadModule(`/api/${name}/[login].ts`)) as {
              GET: (request: Request) => Response | Promise<Response>;
            };
            const reply = await route.GET(new Request(`http://${req.headers.host ?? 'localhost'}${req.originalUrl}`));
            res.statusCode = reply.status;
            reply.headers.forEach((value, key) => res.setHeader(key, value));
            // As bytes, because the card is a picture
            res.end(Buffer.from(await reply.arrayBuffer()));
          })().catch(next);
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Assigning undefined here would store the word 'undefined', which looks like a token to the API
  const { GITHUB_TOKEN: token } = loadEnv(mode, process.cwd(), 'GITHUB_');
  if (token) process.env.GITHUB_TOKEN ??= token;

  // `vite preview` serves production's security headers, so end-to-end tests run under the real CSP
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelHeaders;
  const site = vercel.headers.find((rule) => rule.source === '/(.*)')?.headers ?? [];

  return {
    plugins: [apiInDev()],
    build: { chunkSizeWarningLimit: 900 },
    preview: { headers: Object.fromEntries(site.map(({ key, value }) => [key, value])) },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  };
});
