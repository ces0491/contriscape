import { z } from 'zod';
import { PROFILE_LANGUAGES, PROFILE_REPOS, type Contributions, type Profile } from '../../shared/contract.js';

const ENDPOINT = 'https://api.github.com/graphql';
const USER_AGENT = 'contriscape (https://github.com/ces0491/contriscape)';
const MS_PER_DAY = 864e5;

/**
 * GitHub answers a request covering 8 or more busy years with a 502 after about 10 seconds.
 * Asking for each year's firsts as well took four-year chunks close to that limit on heavy accounts,
 * so a request covers three years.
 */
const YEARS_PER_REQUEST = 3;
/**
 * The longest history fetched, counted back from this year. A commit can carry any date, so without a limit one dated
 * decades back would cost a request for every three years in between.
 */
export const MAX_YEARS = 30;
const CONCURRENT_REQUESTS = 3;
const TIMEOUT_MS = 9000;
const RETRIES = 1;
/** The user's own repos read for their languages, most-starred first. */
const STARRED_REPOS = 20;

export type GitHubFailure = 'not-found' | 'rate-limited' | 'unavailable';

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubFailure,
    readonly retryAfter?: number,
    /** GitHub replied, and the reply said the query itself went wrong. Asking for less may work where asking again won't. */
    readonly refused = false,
  ) {
    super(kind);
  }
}

/** Visitors see the same message for every outage, and a dead token doesn't recover by itself, so the log has to say why. */
function unavailable(reason: string, refused = false): GitHubError {
  console.error(`GitHub unavailable: ${reason}`);
  return new GitHubError('unavailable', undefined, refused);
}

const replySchema = z.object({
  data: z.unknown(),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).optional(),
});

const accountSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  createdAt: z.iso.datetime(),
  contributionsCollection: z.object({ contributionYears: z.array(z.number().int()) }),
});
const userSchema = z.object({ user: accountSchema });

const repoSchema = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
  description: z.string().nullable(),
  stargazerCount: z.number().int().nonnegative(),
  primaryLanguage: z.object({ name: z.string() }).nullable(),
});
/** Each repo is read by itself further on, so one GitHub can't describe is dropped without losing the rest. */
const repoList = z.object({ nodes: z.array(z.unknown()) });
const profiledSchema = z.object({
  user: accountSchema.extend({
    bio: z.string().nullable(),
    followers: z.object({ totalCount: z.number().int().nonnegative() }),
    pinnedItems: repoList,
    repositories: repoList,
  }),
});

type Account = z.infer<typeof accountSchema>;
type Profiled = z.infer<typeof profiledSchema>['user'];

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

const ACCOUNT = 'login name createdAt contributionsCollection{contributionYears}';
const REPO = '{name owner{login} description stargazerCount primaryLanguage{name}}';

const USER_QUERY = `query($login:String!){user(login:$login){${ACCOUNT}}}`;

/** The account and its profile in one request, which costs the same point as the account alone. */
const PROFILED_QUERY =
  `query($login:String!){user(login:$login){${ACCOUNT} bio followers{totalCount} ` +
  `pinnedItems(first:${PROFILE_REPOS},types:REPOSITORY){nodes{... on Repository${REPO}}} ` +
  `repositories(first:${STARRED_REPOS},ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,` +
  `orderBy:{field:STARGAZERS,direction:DESC}){nodes${REPO}}}}`;

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
      throw unavailable('no reply');
    }

    if (response.status === 403 || response.status === 429) {
      const wait = rateLimitWait(response, Date.now());
      throw wait === null ? unavailable(`status ${response.status}`) : new GitHubError('rate-limited', wait);
    }
    if (response.status >= 500) {
      if (canRetry) continue;
      throw unavailable(`status ${response.status}`);
    }
    if (!response.ok) throw unavailable(`status ${response.status}`);

    const reply = replySchema.safeParse(await response.json());
    if (!reply.success) throw unavailable('unexpected reply');
    const { data, errors } = reply.data;
    if (errors?.some((e) => e.type === 'RATE_LIMITED')) throw new GitHubError('rate-limited', 60);
    if (errors?.some((e) => e.type === 'NOT_FOUND')) throw new GitHubError('not-found');
    if (errors?.length) throw unavailable(errors.map((e) => e.type ?? 'untyped error').join(', '), true);
    return data;
  }
}

const oneLine = (text: string | null): string | null => text?.replace(/\s+/g, ' ').trim() || null;

/** A profile from GitHub's reply: the bio, the repos to show, and the languages most of the user's repos are in. */
export function profileOf(user: Profiled): Profile {
  const read = (nodes: unknown[]): Profile['repos'] =>
    nodes.flatMap((node) => {
      const repo = repoSchema.safeParse(node);
      if (!repo.success) return [];
      const { name, owner, description, stargazerCount, primaryLanguage } = repo.data;
      return [
        {
          owner: owner.login,
          name,
          description: oneLine(description),
          stars: stargazerCount,
          language: primaryLanguage?.name ?? null,
        },
      ];
    });
  const pinned = read(user.pinnedItems.nodes);
  const starred = read(user.repositories.nodes);

  const counted = new Set<string>();
  const tally = new Map<string, number>();
  for (const repo of [...pinned, ...starred]) {
    const key = `${repo.owner}/${repo.name}`.toLowerCase();
    if (!repo.language || counted.has(key)) continue;
    counted.add(key);
    tally.set(repo.language, (tally.get(repo.language) ?? 0) + 1);
  }
  // The sort keeps the order they were met in, so languages level on count stay pinned first, then by stars
  const languages = [...tally].sort((a, b) => b[1] - a[1]).map(([name]) => name);

  return {
    bio: oneLine(user.bio),
    followers: user.followers.totalCount,
    languages: languages.slice(0, PROFILE_LANGUAGES),
    repos: (pinned.length ? pinned : starred).slice(0, PROFILE_REPOS),
    pinned: pinned.length > 0,
  };
}

/**
 * The account, with its profile when GitHub gives one. The profile is an extra, so if it is what spoils the reply the
 * account is asked for again without it. An outage isn't asked about twice, because it would only fail twice.
 */
async function fetchAccount(token: string, login: string): Promise<{ user: Account; profile?: Profile }> {
  try {
    const { user } = profiledSchema.parse(await post(token, PROFILED_QUERY, login));
    return { user, profile: profileOf(user) };
  } catch (error) {
    const spoiled = error instanceof z.ZodError || (error instanceof GitHubError && error.refused);
    if (!spoiled) throw error;
    console.error(`No profile for ${login}: ${error instanceof z.ZodError ? 'unexpected shape' : 'query refused'}`);
    return userSchema.parse(await post(token, USER_QUERY, login));
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

/**
 * The years to fetch, oldest first. GitHub counts commits dated before the account was made, so a history can start
 * before its account does. It starts at the earliest year GitHub lists, and no more than `MAX_YEARS` back.
 */
export function historyYears(created: number, listed: number[], current: number): number[] {
  const first = Math.max(Math.min(created, ...listed), current - MAX_YEARS + 1);
  const years: number[] = [];
  for (let y = Math.min(first, current); y <= current; y++) years.push(y);
  return years;
}

export async function fetchContributions(login: string, token: string, now = new Date()): Promise<Contributions> {
  const { user, profile } = await fetchAccount(token, login);
  const today = now.toISOString().slice(0, 10);
  const span = historyYears(
    Number(user.createdAt.slice(0, 4)),
    user.contributionsCollection.contributionYears,
    now.getUTCFullYear(),
  );

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
  return { login: user.login, name: user.name, snapshot: today, years, firsts, ...(profile && { profile }) };
}
