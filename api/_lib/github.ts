import { z } from 'zod';
import type { Contributions } from '../../shared/contract.js';

const ENDPOINT = 'https://api.github.com/graphql';
const USER_AGENT = 'contriscape (https://github.com/ces0491/contriscape)';
const MS_PER_DAY = 864e5;

/**
 * GitHub answers a request covering 8 or more busy years with a 502 after about 10 seconds.
 * Asking for each year's firsts as well took four-year chunks close to that limit on heavy accounts,
 * so a request covers three years.
 */
const YEARS_PER_REQUEST = 3;
const CONCURRENT_REQUESTS = 3;
const TIMEOUT_MS = 9000;
const RETRIES = 1;

export type GitHubFailure = 'not-found' | 'rate-limited' | 'unavailable';

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubFailure,
    readonly retryAfter?: number,
  ) {
    super(kind);
  }
}

const replySchema = z.object({
  data: z.unknown(),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).optional(),
});

const userSchema = z.object({
  user: z.object({ login: z.string(), name: z.string().nullable(), createdAt: z.iso.datetime() }),
});

const occurrence = z.object({ occurredAt: z.iso.datetime().optional() }).nullish();

const calendarSchema = z.object({
  joinedGitHubContribution: occurrence,
  firstRepositoryContribution: occurrence,
  firstPullRequestContribution: occurrence,
  firstIssueContribution: occurrence,
  contributionCalendar: z.object({
    weeks: z.array(
      z.object({
        contributionDays: z.array(z.object({ date: z.iso.date(), contributionCount: z.number() })),
      }),
    ),
  }),
});
const yearsSchema = z.object({ user: z.record(z.string(), calendarSchema) });

type Day = z.infer<typeof calendarSchema>['contributionCalendar']['weeks'][number]['contributionDays'][number];

const USER_QUERY = 'query($login:String!){user(login:$login){login name createdAt}}';

const firstOf = (field: string, type: string) =>
  `${field}{... on ${type}{occurredAt} ... on RestrictedContribution{occurredAt}}`;

/** GitHub reports each of these only in the period it happened, so every year has to ask. */
const FIRSTS = [
  'joinedGitHubContribution{occurredAt}',
  firstOf('firstRepositoryContribution', 'CreatedRepositoryContribution'),
  firstOf('firstPullRequestContribution', 'CreatedPullRequestContribution'),
  firstOf('firstIssueContribution', 'CreatedIssueContribution'),
].join(' ');

const yearsQuery = (years: number[]): string => {
  const fields = years.map(
    (y) =>
      `y${y}:contributionsCollection(from:"${y}-01-01T00:00:00Z",to:"${y}-12-31T23:59:59Z")` +
      `{contributionCalendar{weeks{contributionDays{date contributionCount}}} ${FIRSTS}}`,
  );
  return `query($login:String!){user(login:$login){${fields.join(' ')}}}`;
};

function rateLimitWait(response: Response, now: number): number | null {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (retryAfter > 0) return retryAfter;
  if (response.headers.get('x-ratelimit-remaining') !== '0') return null;
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  return reset > 0 ? Math.max(1, reset - Math.floor(now / 1000)) : 60;
}

async function post(token: string, query: string, login: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < RETRIES;
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ query, variables: { login } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      if (canRetry) continue;
      throw new GitHubError('unavailable');
    }

    if (response.status === 403 || response.status === 429) {
      const wait = rateLimitWait(response, Date.now());
      throw wait === null ? new GitHubError('unavailable') : new GitHubError('rate-limited', wait);
    }
    if (response.status >= 500) {
      if (canRetry) continue;
      throw new GitHubError('unavailable');
    }
    if (!response.ok) throw new GitHubError('unavailable');

    const reply = replySchema.safeParse(await response.json());
    if (!reply.success) throw new GitHubError('unavailable');
    const { data, errors } = reply.data;
    if (errors?.some((e) => e.type === 'RATE_LIMITED')) throw new GitHubError('rate-limited', 60);
    if (errors?.some((e) => e.type === 'NOT_FOUND')) throw new GitHubError('not-found');
    if (errors?.length) throw new GitHubError('unavailable');
    return data;
  }
}

/** Daily counts from 1 January, stopping today unless GitHub already has something dated later. */
export function yearCounts(year: number, days: Day[], today: string): number[] {
  const byDate = new Map(days.map((d) => [d.date, d.contributionCount]));
  const first = Date.UTC(year, 0, 1);
  let end = Math.min(Date.UTC(year, 11, 31), Date.parse(today));
  for (const d of days) if (d.contributionCount > 0) end = Math.max(end, Date.parse(d.date));
  const counts: number[] = [];
  for (let t = first; t <= end; t += MS_PER_DAY) {
    counts.push(byDate.get(new Date(t).toISOString().slice(0, 10)) ?? 0);
  }
  return counts;
}

function chunked(years: number[]): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < years.length; i += YEARS_PER_REQUEST) chunks.push(years.slice(i, i + YEARS_PER_REQUEST));
  return chunks;
}

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return results;
}

export async function fetchContributions(login: string, token: string, now = new Date()): Promise<Contributions> {
  const { user } = userSchema.parse(await post(token, USER_QUERY, login));
  const today = now.toISOString().slice(0, 10);
  const span: number[] = [];
  for (let y = Number(user.createdAt.slice(0, 4)); y <= now.getUTCFullYear(); y++) span.push(y);

  const replies = await inBatches(chunked(span), CONCURRENT_REQUESTS, (years) =>
    post(token, yearsQuery(years), login).then((data) => yearsSchema.parse(data).user),
  );

  const years: Contributions['years'] = {};
  const firsts: NonNullable<Contributions['firsts']> = {
    joined: null,
    repository: null,
    pullRequest: null,
    issue: null,
  };
  const note = (key: keyof typeof firsts, seen?: { occurredAt?: string } | null) => {
    const date = seen?.occurredAt?.slice(0, 10);
    if (date && (!firsts[key] || date < (firsts[key] as string))) firsts[key] = date;
  };
  for (const reply of replies) {
    for (const [alias, collection] of Object.entries(reply)) {
      const days = collection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
      years[alias.slice(1)] = yearCounts(Number(alias.slice(1)), days, today);
      note('joined', collection.joinedGitHubContribution);
      note('repository', collection.firstRepositoryContribution);
      note('pullRequest', collection.firstPullRequestContribution);
      note('issue', collection.firstIssueContribution);
    }
  }
  return { login: user.login, name: user.name, snapshot: today, years, firsts };
}
