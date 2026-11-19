/**
 * Writes `public/explore.json`, the cities the Explore panel offers, from GitHub's search.
 *
 *   npm run explore
 *
 * It reads `GITHUB_TOKEN` from the environment, or from `.env.local` as `npm run dev` does. The lists are a snapshot,
 * so run it again to refresh them, read the result, and commit it.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import { catalogueSchema } from '../shared/explore';
import { buildCatalogue, type Ask } from './catalogue';

const ENDPOINT = 'https://api.github.com/graphql';
const USER_AGENT = 'contriscape (https://github.com/ces0491/contriscape)';
const OUT = 'public/explore.json';
const TIMEOUT_MS = 20000;
/** GitHub's search answers the odd request with a 502, and the next attempt goes through. */
const ATTEMPTS = 3;

const replySchema = z.object({
  data: z.unknown(),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).optional(),
});

if (!process.env.GITHUB_TOKEN && existsSync('.env.local')) process.loadEnvFile('.env.local');
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Set GITHUB_TOKEN, or put it in .env.local. A classic token with no scopes is enough.');
  process.exit(1);
}

/** Requests sent, each of which costs the token a point or more of its hourly 5,000. */
let requests = 0;

const ask: Ask = async (query, variables) => {
  for (let attempt = 1; ; attempt++) {
    requests++;
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const { data, errors } = replySchema.parse(await response.json());
      // An account that has gone since the search found it comes back as an error beside the rest of the data
      const fatal = errors?.filter((e) => e.type !== 'NOT_FOUND') ?? [];
      if (fatal.length || data == null) throw new Error(fatal.map((e) => e.message).join('; ') || 'no data');
      return data;
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
    }
  }
};

const catalogue = catalogueSchema.parse(await buildCatalogue(ask, new Date(), undefined, (line) => console.log(line)));
await writeFile(OUT, await format(JSON.stringify(catalogue), { ...(await resolveConfig(OUT)), parser: 'json' }));
const people = catalogue.groups.reduce((sum, group) => sum + group.people.length, 0);
console.log(
  `Wrote ${OUT}: ${catalogue.groups.length} groups, ${people} listings, from ${requests} requests to GitHub.`,
);
