import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../api/contributions/[login]';
import { fetchContributions, GitHubError, yearCounts } from '../api/_lib/github';

const NOW = new Date('2026-03-10T12:00:00Z');

const days = (entries: [string, number][]) => entries.map(([date, contributionCount]) => ({ date, contributionCount }));
const calendar = (entries: [string, number][]) => ({
  contributionCalendar: { weeks: [{ contributionDays: days(entries) }] },
});
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

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

describe('fetchContributions', () => {
  it('fetches long histories in chunks of four years', async () => {
    fetchMock.mockResolvedValueOnce(ok({ user: { login: 'veteran', name: null, createdAt: '2017-05-01T00:00:00Z' } }));
    for (const years of [
      [2017, 2018, 2019, 2020],
      [2021, 2022, 2023, 2024],
      [2025, 2026],
    ]) {
      const user = Object.fromEntries(years.map((y) => [`y${y}`, calendar([])]));
      fetchMock.mockResolvedValueOnce(ok({ user }));
    }
    const result = await fetchContributions('veteran', 'token', NOW);
    expect(fetchMock).toHaveBeenCalledTimes(4);
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

  it('sends the login as a variable, keeping it out of the query text', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ user: { login: 'someone', name: 'Some One', createdAt: '2026-01-01T00:00:00Z' } }),
    );
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    await fetchContributions('someone', 'token', NOW);
    for (const call of fetchMock.mock.calls) {
      expect(sent(call).variables.login).toBe('someone');
      expect(sent(call).query).not.toContain('someone');
    }
  });

  it('retries a GitHub 502 once', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
    fetchMock.mockResolvedValueOnce(ok({ user: { login: 'retry', name: null, createdAt: '2026-01-01T00:00:00Z' } }));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    await expect(fetchContributions('retry', 'token', NOW)).resolves.toMatchObject({ login: 'retry' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after a second GitHub 502', async () => {
    fetchMock.mockImplementation(async () => new Response('bad gateway', { status: 502 }));
    await expect(fetchContributions('down', 'token', NOW)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    fetchMock.mockResolvedValueOnce(ok({ user: { login: 'found', name: null, createdAt: '2026-01-01T00:00:00Z' } }));
    fetchMock.mockResolvedValueOnce(ok({ user: { y2026: calendar([]) } }));
    expect((await GET(request('found?login=found'))).status).toBe(200);
  });

  it('reads the login from the parameter when the path is the route pattern', async () => {
    fetchMock.mockResolvedValueOnce(ok({ user: { login: 'found', name: null, createdAt: '2026-01-01T00:00:00Z' } }));
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
    fetchMock.mockResolvedValueOnce(ok({ user: { login: 'found', name: null, createdAt: '2026-01-01T00:00:00Z' } }));
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

  it('keeps the token out of the response', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
    const reply = await GET(request('leak'));
    expect(await reply.text()).not.toContain('test-token');
  });
});
