import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../api/contributions/[login]';
import { fetchContributions, GitHubError, historyYears, MAX_YEARS, yearCounts } from '../api/_lib/github';

const NOW = new Date('2026-03-10T12:00:00Z');

const days = (entries: [string, number][]) => entries.map(([date, contributionCount]) => ({ date, contributionCount }));
const calendar = (entries: [string, number][]) => ({
  contributionCalendar: { weeks: [{ contributionDays: days(entries) }] },
});
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const NO_PROFILE = { bio: null, followers: { totalCount: 0 }, pinnedItems: { nodes: [] }, repositories: { nodes: [] } };
/** GitHub's reply about the account: when it was made, the years it lists contributions in, and its profile. */
const account = (
  login: string,
  created: string,
  listed: number[] = [],
  name: string | null = null,
  profile: object = NO_PROFILE,
) =>
  ok({
    user: {
      login,
      name,
      createdAt: `${created}T00:00:00Z`,
      contributionsCollection: { contributionYears: listed },
      ...profile,
    },
  });
const repo = (
  owner: string,
  name: string,
  stars: number,
  language: string | null,
  description: string | null = null,
) => ({
  name,
  owner: { login: owner },
  description,
  stargazerCount: stars,
  primaryLanguage: language ? { name: language } : null,
});

interface Sent {
  query: string;
  variables: { login: string };
}
const sent = (call: unknown[]): Sent => JSON.parse((call[1] as RequestInit).body as string) as Sent;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GITHUB_TOKEN', 'test-token');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const request = (login: string) => new Request(`https://example.test/api/contributions/${login}`);

describe('yearCounts', () => {
  it('fills missing days with zero and stops today', () => {
    const counts = yearCounts(2026, days([['2026-01-02', 5]]), '2026-01-04');
    expect(counts).toEqual([0, 5, 0, 0]);
  });

  it('keeps a contribution dated after UTC today, for users ahead of UTC', () => {
    const counts = yearCounts(2026, days([['2026-01-05', 2]]), '2026-01-04');
    expect(counts).toEqual([0, 0, 0, 0, 2]);
  });

  it('covers a whole past year, including leap days', () => {
    expect(yearCounts(2024, [], '2026-03-10')).toHaveLength(366);
    expect(yearCounts(2025, [], '2026-03-10')).toHaveLength(365);
  });
});

describe('historyYears', () => {
  it('starts when the account was made if GitHub lists nothing earlier', () => {
    expect(historyYears(2023, [], 2026)).toEqual([2023, 2024, 2025, 2026]);
    expect(historyYears(2023, [2026, 2025], 2026)).toEqual([2023, 2024, 2025, 2026]);
  });

  it('starts at the earliest year GitHub lists, which can be before the account was made', () => {
    const years = historyYears(2007, [2026, 2008, 2007, 2006], 2026);
    expect(years[0]).toBe(2006);
    expect(years).toHaveLength(21);
  });

  it('goes no further back than the limit, however early a commit is dated', () => {
    const years = historyYears(2012, [2026, 2012, 1970], 2026);
    expect(years).toHaveLength(MAX_YEARS);
    expect(years.at(-1)).toBe(2026);
  });

  it('still covers this year for an account GitHub dates after it', () => {
    expect(historyYears(2027, [2027], 2026)).toEqual([2026]);
  });
});

describe('fetchContributions', () => {
  it('fetches a year GitHub lists before the account was made', async () => {
    fetchMock.mockResolvedValueOnce(account('early', '2025-06-01', [2026, 2025, 2024]));
    fetchMock.mockResolvedValueOnce(
      ok({ user: { y2024: calendar([['2024-03-01', 2]]), y2025: calendar([]), y2026: calendar([]) } }),
    );
    const result = await fetchContributions('early', 'token', NOW);
    expect(Object.keys(result.years)).toEqual(['2024', '2025', '2026']);
    expect(result.years['2024'][60]).toBe(2);
    expect(sent(fetchMock.mock.calls[0]).query).toContain('contributionYears');
  });

  it('fetches long histories in chunks of three years', async () => {
    fetchMock.mockResolvedValueOnce(account('veteran', '2017-05-01'));
    for (const years of [[2017, 2018, 2019], [2020, 2021, 2022], [2023, 2024, 2025], [2026]]) {
      const user = Object.fromEntries(years.map((y) => [`y${y}`, calendar([])]));
      fetchMock.mockResolvedValueOnce(ok({ user }));
    }
    const result = await fetchContributions('veteran', 'token', NOW);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(Object.keys(result.years)).toEqual([
      '2017',
      '2018',
      '2019',
      '2020',
      '2021',
      '2022',
      '2023',
      '2024',
      '2025',
      '2026',
    ]);
    expect(result.snapshot).toBe('2026-03-10');
  });

  it('keeps the earliest of each first across the years', async () => {
    fetchMock.mockResolvedValueOnce(account('firsts', '2020-03-01'));
    const year = (extra: object) => ({ ...calendar([]), ...extra });
    fetchMock.mockResolvedValueOnce(
      ok({
        user: {
          y2020: year({
            joinedGitHubContribution: { occurredAt: '2020-03-01T10:00:00Z' },
            firstRepositoryContribution: null,
            firstPullRequestContribution: { occurredAt: '2020-06-02T10:00:00Z' },
            firstIssueContribution: {},
          }),
          y2021: year({ firstRepositoryContribution: { occurredAt: '2021-01-05T10:00:00Z' } }),
          y2022: year({ firstPullRequestContribution: { occurredAt: '2022-02-02T10:00:00Z' } }),
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(ok({ user: { y2023: calendar([]), y2024: calendar([]), y2025: calendar([]) } }));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    const { firsts } = await fetchContributions('firsts', 'token', NOW);
    expect(firsts).toEqual({ joined: '2020-03-01', repository: '2021-01-05', pullRequest: '2020-06-02', issue: null });
  });

  it('sends the login as a variable, keeping it out of the query text', async () => {
    fetchMock.mockResolvedValueOnce(account('someone', '2026-01-01', [2026], 'Some One'));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    await fetchContributions('someone', 'token', NOW);
    for (const call of fetchMock.mock.calls) {
      expect(sent(call).variables.login).toBe('someone');
      expect(sent(call).query).not.toContain('someone');
    }
  });

  it('retries a GitHub 502 once', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
    fetchMock.mockResolvedValueOnce(account('retry', '2026-01-01'));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    await expect(fetchContributions('retry', 'token', NOW)).resolves.toMatchObject({ login: 'retry' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after a second GitHub 502', async () => {
    fetchMock.mockImplementation(async () => new Response('bad gateway', { status: 502 }));
    await expect(fetchContributions('down', 'token', NOW)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads the profile in the same request as the account', async () => {
    const profile = {
      bio: '  Statistician.\r\nWrites R packages. ',
      followers: { totalCount: 1486 },
      pinnedItems: {
        nodes: [
          repo('stats', 'qtl', 90, 'R', 'QTL mapping\n in R'),
          {},
          repo('someone-else', 'charts', 87, 'CoffeeScript'),
        ],
      },
      repositories: {
        nodes: [repo('stats', 'slides', 363, null), repo('stats', 'qtl', 90, 'R'), repo('stats', 'broman', 183, 'R')],
      },
    };
    fetchMock.mockResolvedValueOnce(account('stats', '2026-01-01', [2026], 'A Statistician', profile));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    const result = await fetchContributions('stats', 'token', NOW);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(fetchMock.mock.calls[0]).query).toContain('pinnedItems');
    expect(result.profile).toEqual({
      bio: 'Statistician. Writes R packages.',
      followers: 1486,
      // qtl is pinned and among the most-starred, and counts once
      languages: ['R', 'CoffeeScript'],
      // The pin GitHub sent nothing for is dropped, and the rest are kept in the user's order
      repos: [
        { owner: 'stats', name: 'qtl', description: 'QTL mapping in R', stars: 90, language: 'R' },
        { owner: 'someone-else', name: 'charts', description: null, stars: 87, language: 'CoffeeScript' },
      ],
      pinned: true,
    });
  });

  it('shows the most-starred repos of a user who pinned none', async () => {
    const starred = Array.from({ length: 8 }, (_, i) => repo('plain', `repo-${i}`, 100 - i, i < 5 ? 'Go' : 'C'));
    const profile = { ...NO_PROFILE, repositories: { nodes: starred } };
    fetchMock.mockResolvedValueOnce(account('plain', '2026-01-01', [2026], null, profile));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    const { profile: read } = await fetchContributions('plain', 'token', NOW);

    expect(read?.pinned).toBe(false);
    expect(read?.repos.map((r) => r.name)).toEqual(['repo-0', 'repo-1', 'repo-2', 'repo-3', 'repo-4', 'repo-5']);
    expect(read?.languages).toEqual(['Go', 'C']);
    expect(read?.bio).toBeNull();
  });

  it('loads the city without a profile when the profile is what GitHub refuses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: null, errors: [{ message: 'Something went wrong' }] })),
    );
    fetchMock.mockResolvedValueOnce(
      ok({
        user: {
          login: 'heavy',
          name: null,
          createdAt: '2026-01-01T00:00:00Z',
          contributionsCollection: { contributionYears: [2026] },
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([['2026-01-02', 4]]) } }));
    const result = await fetchContributions('heavy', 'token', NOW);

    expect(result.years['2026'][1]).toBe(4);
    expect(result.profile).toBeUndefined();
    expect(sent(fetchMock.mock.calls[1]).query).not.toContain('pinnedItems');
  });

  it('loads the city without a profile when the profile comes back in a shape it does not know', async () => {
    fetchMock.mockResolvedValueOnce(account('odd', '2026-01-01', [2026], null, { bio: 7 }));
    fetchMock.mockResolvedValueOnce(account('odd', '2026-01-01', [2026], null, {}));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    const result = await fetchContributions('odd', 'token', NOW);

    expect(result.login).toBe('odd');
    expect(result.profile).toBeUndefined();
  });

  it('reports the wait when GitHub says the quota has run out', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }),
    );
    const failure = await fetchContributions('busy', 'token', NOW).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(GitHubError);
    expect((failure as GitHubError).kind).toBe('rate-limited');
    expect((failure as GitHubError).retryAfter).toBeGreaterThan(100);
  });
});

describe('GET /api/contributions/:login', () => {
  it('rejects logins GitHub could not have issued, without calling GitHub', async () => {
    for (const bad of ['-leading', 'has_underscore', 'a'.repeat(40), '%2e%2e']) {
      expect((await GET(request(bad))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the login parameter added by the Vercel rewrite', async () => {
    fetchMock.mockResolvedValueOnce(account('found', '2026-01-01'));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    expect((await GET(request('found?login=found'))).status).toBe(200);
  });

  it('reads the login from the parameter when the path is the route pattern', async () => {
    fetchMock.mockResolvedValueOnce(account('found', '2026-01-01'));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    expect((await GET(request('[login]?login=found'))).status).toBe(200);
  });

  it('refuses extra query parameters, which would bypass the CDN cache', async () => {
    for (const path of ['someone?x=1', 'someone?login=someone&x=1', 'someone?login=other']) {
      expect((await GET(request(path))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects mixed case, so each user has one cached copy', async () => {
    const reply = await GET(request('SomeOne'));
    expect(reply.status).toBe(308);
    expect(reply.headers.get('location')).toBe('https://example.test/api/contributions/someone');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a found user at the CDN', async () => {
    fetchMock.mockResolvedValueOnce(account('found', '2026-01-01'));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([['2026-01-01', 3]]) } }));
    const reply = await GET(request('found'));
    expect(reply.status).toBe(200);
    expect(reply.headers.get('cache-control')).toContain('s-maxage=21600');
    expect(((await reply.json()) as { login: string }).login).toBe('found');
  });

  it('caches a missing user for less time', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { user: null }, errors: [{ type: 'NOT_FOUND', message: 'nope' }] })),
    );
    const reply = await GET(request('nobody'));
    expect(reply.status).toBe(404);
    expect(reply.headers.get('cache-control')).toContain('s-maxage=3600');
  });

  it('never caches a rate limit, and passes on the wait', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '90' } }));
    const reply = await GET(request('limited'));
    expect(reply.status).toBe(429);
    expect(reply.headers.get('cache-control')).toBe('no-store');
    expect(reply.headers.get('retry-after')).toBe('90');
  });

  it('never caches an outage', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
    const reply = await GET(request('outage'));
    expect(reply.status).toBe(502);
    expect(reply.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed and logs when the token is missing', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const reply = await GET(request('anyone'));
    expect(reply.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('logs why GitHub failed when it refuses the token, leaving the token out', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }));
    const reply = await GET(request('expired'));
    expect(reply.status).toBe(502);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('401'));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('test-token');
  });

  it('logs the kind of error when GitHub answers with one it has no message for', async () => {
    // Asked again without the profile, and refused again
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ data: null, errors: [{ type: 'SOMETHING_NEW', message: 'nope' }] })),
    );
    expect((await GET(request('oddity'))).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('SOMETHING_NEW'));
  });

  it('keeps the token out of the response', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
    const reply = await GET(request('leak'));
    expect(await reply.text()).not.toContain('test-token');
  });
});
