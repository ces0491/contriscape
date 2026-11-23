import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, cardSummary, drawCard, drawYearCard, nameScale, yearLines } from '../api/_lib/card';
import { canWrite, textHeight, textWidth, write } from '../api/_lib/letters';
import { Picture } from '../api/_lib/png';
import { requestedLogin, requestedYear } from '../api/_lib/request';
import { GET as card } from '../api/card/[login]';
import { GET as share } from '../api/share/[login]';
import type { Contributions } from '../shared/contract';
import { Calendar } from '../src/calendar';

const history: Contributions = {
  login: 'octo-dev',
  name: null,
  snapshot: '2026-11-02',
  years: {
    '2024': Array.from({ length: 366 }, (_, d) => (d % 5 ? 3 : 0)),
    '2025': Array.from({ length: 365 }, (_, d) => (d * 7) % 40),
    '2026': Array.from({ length: 306 }, (_, d) => (d === 200 ? 120 : (d * 3) % 30)),
  },
};

/** The size a PNG declares, and its pixels, read back the long way round. */
function decode(png: Uint8Array): { width: number; height: number; at(x: number, y: number): number[] } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let offset = 8;
  const data: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(data));
  const stride = width * 3 + 1;
  return { width, height, at: (x, y) => [...rows.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3)] };
}

describe('Picture', () => {
  it('saves as a PNG that reads back with its size and colours', () => {
    const picture = new Picture(40, 20, [6, 10, 19]);
    picture.rect(10, 5, 4, 3, [57, 211, 83]);
    const read = decode(picture.png());
    expect([read.width, read.height]).toEqual([40, 20]);
    expect(read.at(0, 0)).toEqual([6, 10, 19]);
    expect(read.at(11, 6)).toEqual([57, 211, 83]);
    expect(read.at(14, 6)).toEqual([6, 10, 19]);
  });

  it('keeps a rectangle that runs off the edge inside the picture', () => {
    const picture = new Picture(10, 10, [0, 0, 0]);
    picture.rect(-5, -5, 100, 100, [200, 100, 50]);
    expect(picture.at(0, 0)).toEqual([200, 100, 50]);
    expect(picture.at(9, 9)).toEqual([200, 100, 50]);
  });

  it('blends a see-through rectangle over what is there', () => {
    const picture = new Picture(4, 4, [0, 0, 0]);
    picture.rect(0, 0, 4, 4, [200, 100, 50], 0.5);
    expect(picture.at(1, 1)).toEqual([100, 50, 25]);
  });
});

describe('letters', () => {
  it('has a letter for everything a GitHub login can contain, in either case', () => {
    for (const character of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-') {
      expect(canWrite(character), character).toBe(true);
    }
  });

  it('measures a line by its letters and the gaps between them', () => {
    expect(textWidth('', 4)).toBe(0);
    expect(textWidth('A', 4)).toBe(20);
    expect(textWidth('AB', 4)).toBe(44);
    expect(textHeight(4)).toBe(28);
  });

  it('writes block capitals, and leaves a character it has no letter for blank', () => {
    const picture = new Picture(40, 10, [0, 0, 0]);
    write(picture, 'l~', 0, 0, 1, [255, 255, 255]);
    // An L: a full left edge and a full bottom row
    expect(picture.at(0, 0)).toEqual([255, 255, 255]);
    expect(picture.at(4, 0)).toEqual([0, 0, 0]);
    expect(picture.at(4, 6)).toEqual([255, 255, 255]);
    for (let x = 6; x < 12; x++) for (let y = 0; y < 7; y++) expect(picture.at(x, y)).toEqual([0, 0, 0]);
  });
});

describe('drawCard', () => {
  it('draws at the size link previews use, small enough to send quickly', () => {
    const png = drawCard(history).png();
    const read = decode(png);
    expect([read.width, read.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    expect(png.length).toBeLessThan(200_000);
  });

  it('draws the same card each time for the same history', () => {
    expect(Buffer.from(drawCard(history).png()).equals(Buffer.from(drawCard(history).png()))).toBe(true);
  });

  it('stands a skyline in the buildings green over the night, with the name above it', () => {
    const picture = drawCard(history);
    let green = 0;
    let ink = 0;
    for (let y = 0; y < CARD_HEIGHT; y += 2) {
      for (let x = 0; x < CARD_WIDTH; x += 2) {
        const [r, g, b] = picture.at(x, y);
        if (y > 250 && y < 540 && g > r * 2 && g > b * 1.5 && g > 60) green++;
        if (y < 200 && r > 200 && g > 200 && b > 200) ink++;
      }
    }
    expect(green).toBeGreaterThan(2000);
    expect(ink).toBeGreaterThan(300);
  });

  it('fits the longest login GitHub allows across the card', () => {
    const longest = 'a-really-long-github-username-of-39-cha';
    expect(longest).toHaveLength(39);
    expect(textWidth(longest, nameScale(longest))).toBeLessThanOrEqual(CARD_WIDTH - 120);
    expect(nameScale('torvalds')).toBe(14);
    expect(() => drawCard({ ...history, login: longest })).not.toThrow();
  });

  it('says how long the history is and how much is in it', () => {
    expect(cardSummary(new Calendar(history))).toMatch(/^2024-2026 {2}[\d,]+ contributions$/);
    const single = new Calendar({ login: 'x', name: null, snapshot: '2026-01-02', years: { '2026': [1, 0] } });
    expect(cardSummary(single)).toBe('2026  1 contribution');
  });

  it('draws a history with nothing in it', () => {
    const empty: Contributions = {
      login: 'newcomer',
      name: null,
      snapshot: '2026-11-02',
      years: { '2026': [0, 0, 0] },
    };
    expect(decode(drawCard(empty).png()).width).toBe(CARD_WIDTH);
  });
});

describe('drawYearCard', () => {
  it('draws one year at the size link previews use, the same each time', () => {
    const png = (drawYearCard(history, 2025) as Picture).png();
    expect(decode(png)).toMatchObject({ width: CARD_WIDTH, height: CARD_HEIGHT });
    expect([...png]).toEqual([...(drawYearCard(history, 2025) as Picture).png()]);
  });

  it('says how much was in the year, on how many days, and its longest run of them', () => {
    const lines = yearLines(new Calendar(history), 2024);
    // 2024 has 366 days, every fifth of them empty, and 3 on each of the rest
    expect(lines).toEqual(['876 contributions', '292 active days', 'Longest streak 4 days']);
    for (const line of lines) expect([...line].every(canWrite), line).toBe(true);
  });

  it('stands the year in gold, where the history card is green', () => {
    const gold = decode((drawYearCard(history, 2025) as Picture).png());
    const green = decode(drawCard(history).png());
    // Along the line each skyline stands on
    const warm = (at: number[]) => at[0] > at[2] + 60 && at[0] >= at[1];
    expect(Array.from({ length: 1000 }, (_, x) => gold.at(x + 100, 549)).some(warm)).toBe(true);
    expect(Array.from({ length: 1000 }, (_, x) => green.at(x + 100, 541)).some(warm)).toBe(false);
  });

  it('leaves a year with nothing in it, or not in the history, to the history card', () => {
    const quiet: Contributions = {
      ...history,
      years: { ...history.years, '2023': Array.from({ length: 365 }, () => 0) },
    };
    expect(drawYearCard(quiet, 2023)).toBeNull();
    expect(drawYearCard(history, 2019)).toBeNull();
  });
});

describe('a year in a request', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const url = (query: string) => new URL(`https://example.test/api/card/octo-dev${query}`);

  it("is a year from GitHub's first to this one, or nothing", () => {
    expect(requestedYear(url(''), now)).toBeNull();
    expect(requestedYear(url('?year=2026'), now)).toBe(2026);
    expect(requestedYear(url('?year=2008'), now)).toBe(2008);
    for (const bad of ['2007', '2027', '26', '20x6', '2026.0', '']) {
      expect(requestedYear(url(`?year=${bad}`), now), bad).toBeUndefined();
    }
  });

  it('is let through only where a route takes one', () => {
    expect(requestedLogin(url('?year=2026'))).toBeNull();
    expect(requestedLogin(url('?year=2026'), true)).toBe('octo-dev');
    expect(requestedLogin(url('?year=2026&x=1'), true)).toBeNull();
  });

  it("is read from whatever shape the year's rewrite hands over", () => {
    const at = (address: string) => new URL(`https://example.test${address}`);
    // At the function's own path, at the login's, or at the address that was asked for
    for (const address of [
      '/api/share/[login]?login=octo-dev&year=2025',
      '/api/share/octo-dev?login=octo-dev&year=2025',
      '/octo-dev/2025?login=octo-dev&year=2025',
      '/octo-dev/2025?login=octo-dev',
    ]) {
      expect(requestedLogin(at(address), true), address).toBe('octo-dev');
      expect(requestedYear(at(address), now), address).toBe(2025);
    }
    // A path and a parameter that name two people are refused
    expect(requestedLogin(at('/octo-dev/2025?login=someone-else'), true)).toBeNull();
    expect(requestedLogin(at('/octo-dev/2025?login=octo-dev'))).toBeNull();
    // A username made of four digits is a username, not a year
    expect(requestedYear(at('/api/card/2025'), now)).toBeNull();
    expect(requestedLogin(at('/api/card/2025'))).toBe('2025');
  });
});

describe('GET /api/card/:login', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
  const request = (path: string) => new Request(`https://example.test/api/card/${path}`);

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

  it('draws a found user a card, cached at the CDN for as long as their city', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        user: {
          login: 'found',
          name: null,
          createdAt: '2026-01-01T00:00:00Z',
          contributionsCollection: { contributionYears: [2026] },
          bio: null,
          followers: { totalCount: 0 },
          pinnedItems: { nodes: [] },
          repositories: { nodes: [] },
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      ok({
        user: {
          y2026: {
            contributionCalendar: { weeks: [{ contributionDays: [{ date: '2026-01-01', contributionCount: 3 }] }] },
          },
        },
      }),
    );
    const reply = await card(request('found'));
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toBe('image/png');
    expect(reply.headers.get('cache-control')).toContain('s-maxage=21600');
    expect(decode(new Uint8Array(await reply.arrayBuffer())).width).toBe(CARD_WIDTH);
  });

  it("falls back to the site's own picture for a user GitHub doesn't have", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { user: null }, errors: [{ type: 'NOT_FOUND', message: 'nope' }] })),
    );
    const reply = await card(request('nobody'));
    expect(reply.status).toBe(302);
    expect(reply.headers.get('location')).toBe('https://example.test/og.png');
    expect(reply.headers.get('cache-control')).toContain('s-maxage=3600');
  });

  it('falls back without caching when GitHub is out of reach, out of quota, or the token is missing', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
    const outage = await card(request('outage'));
    expect([outage.status, outage.headers.get('cache-control')]).toEqual([302, 'no-store']);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '90' } }));
    const limited = await card(request('limited'));
    expect([limited.status, limited.headers.get('cache-control')]).toEqual([302, 'no-store']);

    vi.stubEnv('GITHUB_TOKEN', '');
    fetchMock.mockReset();
    const unset = await card(request('anyone'));
    expect([unset.status, unset.headers.get('cache-control')]).toEqual([302, 'no-store']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a name GitHub could not have issued, and any extra parameter, without calling GitHub', async () => {
    for (const bad of ['-leading', 'has_underscore', 'someone?x=1', 'someone?login=other']) {
      expect((await card(request(bad))).status, bad).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects mixed case, so each user has one cached card, and keeps the year', async () => {
    const reply = await card(request('SomeOne'));
    expect(reply.status).toBe(308);
    expect(reply.headers.get('location')).toBe('https://example.test/api/card/someone');
    const year = await card(request('SomeOne?year=2025'));
    expect(year.headers.get('location')).toBe('https://example.test/api/card/someone?year=2025');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a year that cannot be, without calling GitHub', async () => {
    for (const bad of ['someone?year=1999', 'someone?year=next', 'someone?year=3000']) {
      expect((await card(request(bad))).status, bad).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/share/:login', () => {
  const request = (path: string) => new Request(`https://example.test/api/share/${path}`);

  it("gives a link preview the city's address, a title, and that user's card", async () => {
    const reply = share(request('Octo-Dev'));
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toContain('text/html');
    const html = await reply.text();
    expect(html).toContain('<meta property="og:url" content="https://example.test/Octo-Dev" />');
    expect(html).toContain('<meta property="og:image" content="https://example.test/api/card/octo-dev" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta property="og:title" content="Octo-Dev · contriscape" />');
    expect(html).toContain('Not affiliated with GitHub');
  });

  it('describes the city in at least the 100 characters LinkedIn asks of a preview, even for a one-letter login', async () => {
    const html = await share(request('a')).text();
    const description = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(description).toContain("a's GitHub contributions");
    expect(description.length).toBeGreaterThanOrEqual(100);
    expect(html).toContain(`<meta name="twitter:description" content="${description}" />`);
  });

  it("gives the front page's own preview a description as long", () => {
    const page = readFileSync('index.html', 'utf8');
    const description = /property="og:description"\s+content="([^"]*)"/.exec(page)?.[1] ?? '';
    expect(description.length).toBeGreaterThanOrEqual(100);
  });

  it('is never cached, so a person asking for the same address cannot be handed it', () => {
    expect(share(request('octo-dev')).headers.get('cache-control')).toBe('no-store');
  });

  it('reads the login the way Vercel passes it on from the rewrite', () => {
    expect(share(request('[login]?login=octo-dev')).status).toBe(200);
    expect(share(request('octo-dev?login=octo-dev')).status).toBe(200);
  });

  it("gives a link to one year that year's address, title and card", async () => {
    const html = await share(request('Octo-Dev?year=2025')).text();
    expect(html).toContain('<meta property="og:url" content="https://example.test/Octo-Dev/2025" />');
    expect(html).toContain('<meta property="og:image" content="https://example.test/api/card/octo-dev?year=2025" />');
    expect(html).toContain(`<meta property="og:title" content="Octo-Dev's 2025 on GitHub · contriscape" />`);
    const description = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(description.length).toBeGreaterThanOrEqual(100);
    // The preview asks whoever sees it to fly their own year
    expect(description).toMatch(/Then fly your own\.$/);
    expect(share(request('[login]?login=octo-dev&year=2025')).status).toBe(200);
    expect(share(request('octo-dev?year=1999')).status).toBe(400);
    // The rewrite can hand the function the address that was asked for, with the login added
    const asked = await share(new Request('https://example.test/octo-dev/2025?login=octo-dev&year=2025')).text();
    expect(asked).toContain('<meta property="og:url" content="https://example.test/octo-dev/2025" />');
  });

  it('refuses anything that is not a GitHub login, so nothing else can be written into the page', async () => {
    for (const bad of ['-leading', 'a"><script>', 'has_underscore', 'someone?x=1']) {
      const reply = share(request(bad));
      expect(reply.status, bad).toBe(400);
      expect(await reply.text()).not.toContain('<');
    }
  });
});

describe('the rule that sends link previews to their page', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    rewrites: { source: string; destination: string; has?: { type: string; key: string; value: string }[] }[];
  };
  const [previews, everyone] = config.rewrites;
  const matches = (agent: string) => new RegExp(`^${previews.has?.[0].value ?? ''}$`).test(agent);

  it('comes before the rule for everyone else, on the same addresses', () => {
    expect(previews.destination).toBe('/api/share/:login');
    expect(previews.has?.[0]).toMatchObject({ type: 'header', key: 'user-agent' });
    expect(everyone.destination).toBe('/index.html');
    expect(everyone.has).toBeUndefined();
    expect(previews.source).toBe(everyone.source);
  });

  it('catches the programs that fetch previews', () => {
    for (const agent of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'WhatsApp/2.23.20.0',
      'TelegramBot (like TwitterBot)',
    ]) {
      expect(matches(agent), agent).toBe(true);
    }
  });

  it("sends a year's previews to its page on the same terms, and everyone else to the city", () => {
    const [, , yearPreviews, yearEveryone] = config.rewrites;
    // The year reaches the function as the login does, added to the query by the rewrite, and it is in the path too
    expect(yearPreviews.destination).toBe('/api/share/:login');
    expect(yearPreviews.has).toEqual(previews.has);
    expect(yearEveryone).toEqual({ source: yearPreviews.source, destination: '/index.html' });
    expect(yearPreviews.source).toBe(`${previews.source}/:year(\\d{4})`);
  });

  it('leaves people and search engines with the city itself', () => {
    for (const agent of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      '',
    ]) {
      expect(matches(agent), agent).toBe(false);
    }
  });
});
