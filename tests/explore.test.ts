import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSY_YEAR,
  buildCatalogue,
  FIELDS,
  FOLLOWERS,
  PER_GROUP,
  tidy,
  type Ask,
  type Field,
} from '../scripts/catalogue';
import { catalogueSchema, pickRandom, type Catalogue } from '../shared/explore';
import { listed, noteArrival, personLine, takeArrival, writtenDay } from '../src/explorer';

const NOW = new Date('2026-11-19T12:00:00Z');
const STATS: Field = { id: 'statistics', title: 'Statistics', says: 'statistician' };

interface Account {
  login: string;
  name?: string;
  bio?: string;
  /** Contributions in the last year. */
  year: number;
  organisation?: boolean;
  /** Found by any search, as GitHub finds a bio holding another form of the words. */
  loose?: boolean;
}
interface Repo {
  owner: string;
  name: string;
  stars: number;
  description?: string;
  organisation?: boolean;
}
interface World {
  /** In the order a search by followers would give them. */
  accounts?: Account[];
  starred?: Repo[];
  /** Search results a request, to make a search run to several. */
  perRequest?: number;
}

/** A stand-in for GitHub that answers the three kinds of query the catalogue is built from, and keeps what it was asked. */
function github(world: World) {
  const asked = { searches: [] as string[], checked: [] as string[] };
  const accounts = world.accounts ?? [];
  const size = world.perRequest ?? 100;
  const paged = <T>(all: T[], after: unknown) => {
    const from = Number(after ?? 0);
    const more = from + size < all.length;
    return {
      nodes: all.slice(from, from + size),
      pageInfo: { hasNextPage: more, endCursor: more ? String(from + size) : null },
    };
  };
  const ask: Ask = async (query, variables) => {
    const q = String(variables.q ?? '');
    if (query.includes('type:USER')) {
      asked.searches.push(q);
      const says = /"([^"]+)" in:bio/.exec(q)?.[1] ?? '';
      const found = accounts
        .filter((a) => a.loose || (a.bio ?? '').toLowerCase().includes(says))
        .map((a) =>
          a.organisation
            ? { __typename: 'Organization' }
            : { __typename: 'User', login: a.login, name: a.name ?? null, bio: a.bio ?? null },
        );
      return { search: paged(found, variables.after) };
    }
    if (query.includes('type:REPOSITORY')) {
      asked.searches.push(q);
      const repos = world.starred ?? [];
      const found = repos.map((r) => ({
        name: r.name,
        description: r.description ?? null,
        stargazerCount: r.stars,
        owner: { __typename: r.organisation ? 'Organization' : 'User', login: r.owner, name: null },
      }));
      return { search: paged(found, variables.after) };
    }
    const reply: Record<string, unknown> = {};
    for (const [, alias, login] of query.matchAll(/(u\d+):user\(login:"([^"]+)"\)/g)) {
      asked.checked.push(login);
      const account = accounts.find((a) => a.login === login);
      reply[alias] = account
        ? { contributionsCollection: { contributionCalendar: { totalContributions: account.year } } }
        : null;
    }
    return reply;
  };
  return { ask, asked };
}

const statistician = (login: string, year: number): Account => ({ login, bio: 'Statistician', year });
const logins = (catalogue: Catalogue, id: string) =>
  catalogue.groups.find((g) => g.id === id)?.people.map((p) => p.login);

describe('buildCatalogue', () => {
  it('lists the busy people a bio search finds, in the order it found them', async () => {
    const { ask, asked } = github({
      accounts: [
        { login: 'first', name: ' Ada  L ', bio: 'Statistician.\r\n  Writes R. ', year: BUSY_YEAR },
        statistician('quiet', BUSY_YEAR - 1),
        { login: 'a-company', bio: 'Statistician tools', year: 9000, organisation: true },
        statistician('third', 4000),
        { login: 'elsewhere', bio: 'Plays the cello', year: 9000 },
      ],
    });
    const catalogue = await buildCatalogue(ask, NOW, [STATS]);

    expect(catalogueSchema.parse(catalogue)).toEqual(catalogue);
    expect(catalogue.generated).toBe('2026-11-19');
    expect(catalogue.groups).toHaveLength(1);
    expect(catalogue.groups[0]).toMatchObject({ id: 'statistics', title: 'Statistics' });
    expect(catalogue.groups[0].blurb).toContain('“statistician”');
    expect(catalogue.groups[0].people).toEqual([
      { login: 'first', name: 'Ada L', about: 'Statistician. Writes R.' },
      { login: 'third', name: null, about: 'Statistician' },
    ]);
    expect(asked.searches[0]).toBe(`"statistician" in:bio type:user followers:>=${FOLLOWERS} sort:followers`);
  });

  it('stops checking accounts once a group is full', async () => {
    const { ask, asked } = github({ accounts: Array.from({ length: 40 }, (_, i) => statistician(`busy-${i}`, 500)) });
    const catalogue = await buildCatalogue(ask, NOW, [STATS]);

    expect(logins(catalogue, 'statistics')).toEqual(Array.from({ length: PER_GROUP }, (_, i) => `busy-${i}`));
    // Read five at a time, so the twelfth is found in the third request and the other 25 are never asked about
    expect(asked.checked).toHaveLength(15);
  });

  it('reads further into a search when its first results leave the group short', async () => {
    const quiet = Array.from({ length: 6 }, (_, i) => statistician(`quiet-${i}`, 3));
    const { ask, asked } = github({ accounts: [...quiet, statistician('found-later', 800)], perRequest: 4 });
    const catalogue = await buildCatalogue(ask, NOW, [STATS]);

    expect(logins(catalogue, 'statistics')).toEqual(['found-later']);
    expect(asked.searches.filter((q) => q.includes('in:bio'))).toHaveLength(2);
  });

  it('gives a search three requests, then leaves out a group with nobody in it', async () => {
    const { ask, asked } = github({
      accounts: Array.from({ length: 50 }, (_, i) => statistician(`quiet-${i}`, 0)),
      perRequest: 5,
    });
    const catalogue = await buildCatalogue(ask, NOW, [STATS]);

    expect(catalogue.groups.some((g) => g.id === 'statistics')).toBe(false);
    expect(asked.searches.filter((q) => q.includes('in:bio'))).toHaveLength(3);
    expect(asked.checked).toHaveLength(15);
  });

  it("lists a repo's owner once, under their repo that came first, and skips repos an organisation owns", async () => {
    const { ask } = github({
      accounts: [
        { login: 'maker', year: 900 },
        { login: 'idle', year: 2 },
      ],
      starred: [
        { owner: 'big-org', name: 'framework', stars: 300000, organisation: true },
        { owner: 'maker', name: 'kernel', stars: 250000, description: ' The  kernel ' },
        { owner: 'idle', name: 'list', stars: 200000 },
        { owner: 'maker', name: 'pedal', stars: 150000 },
      ],
    });
    const catalogue = await buildCatalogue(ask, NOW, []);

    expect(catalogue.groups).toHaveLength(1);
    expect(catalogue.groups[0].id).toBe('most-starred');
    expect(catalogue.groups[0].people).toEqual([
      { login: 'maker', name: null, about: 'The kernel', repo: { name: 'kernel', stars: 250000 } },
    ]);
  });

  it('leaves out a bio the search matched on another form of the words', async () => {
    const { ask, asked } = github({
      accounts: [
        { login: 'gamer', bio: 'Gamer. Developer. Geek.', year: 900, loose: true },
        // The words are there once the bio is on one line
        { login: 'maker', bio: 'Indie  Game\r\n developer', year: 900, loose: true },
      ],
    });
    const catalogue = await buildCatalogue(ask, NOW, [{ id: 'games', title: 'Games', says: 'game developer' }]);

    expect(logins(catalogue, 'games')).toEqual(['maker']);
    // Left out before its year is read, so it costs nothing more
    expect(asked.checked).toEqual(['maker']);
  });

  it('searches for repos by stars alone, with no list of new ones', async () => {
    const { ask, asked } = github({
      accounts: [{ login: 'maker', year: 900 }],
      starred: [{ owner: 'maker', name: 'kernel', stars: 250000 }],
    });
    const catalogue = await buildCatalogue(ask, NOW, []);

    expect(asked.searches).toEqual(['stars:>20000 sort:stars']);
    expect(catalogue.groups.map((g) => g.id)).toEqual(['most-starred']);
    expect(catalogue.groups[0].blurb).toContain('organisation');
  });

  it('never writes into a query a login GitHub could not have issued', async () => {
    const { ask, asked } = github({
      accounts: [{ login: 'x"){viewer{login}}#', bio: 'statistician', year: 9000 }, statistician('honest', 900)],
    });
    const catalogue = await buildCatalogue(ask, NOW, [STATS]);

    expect(logins(catalogue, 'statistics')).toEqual(['honest']);
    expect(asked.checked).toEqual(['honest']);
  });

  it('gives each field its own id', () => {
    expect(new Set(FIELDS.map((f) => f.id)).size).toBe(FIELDS.length);
  });
});

describe('tidy', () => {
  it('puts text on one line', () => {
    expect(tidy('  Maps,\r\n\tcharts  and  graphs ')).toBe('Maps, charts and graphs');
    expect(tidy(null)).toBe('');
  });

  it('cuts long text at a word and marks the cut', () => {
    const cut = tidy('A curated list of delightful things for people who like lists of things', 40);
    expect(cut).toBe('A curated list of delightful things…');
    expect(cut.length).toBeLessThanOrEqual(40);
  });

  it('cuts mid-word when there is no space to cut at', () => {
    expect(tidy('x'.repeat(50), 20)).toBe(`${'x'.repeat(19)}…`);
  });
});

describe('the catalogue the site ships', () => {
  const shipped = catalogueSchema.parse(JSON.parse(readFileSync('public/explore.json', 'utf8')));

  it('names each list once', () => {
    const ids = shipped.groups.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists nobody twice in a list, and no more than a list holds', () => {
    for (const group of shipped.groups) {
      const seen = group.people.map((p) => p.login.toLowerCase());
      expect(new Set(seen).size, group.title).toBe(seen.length);
      expect(seen.length, group.title).toBeLessThanOrEqual(PER_GROUP);
    }
  });

  it('lists under a field only people whose bio has the words its heading quotes', () => {
    for (const group of shipped.groups) {
      const words = /“(.+?)”/.exec(group.blurb)?.[1].toLowerCase();
      if (words === undefined) continue;
      for (const person of group.people) {
        expect(person.about.toLowerCase(), `${group.id} ${person.login}`).toContain(words);
      }
    }
  });

  it('has no list of new repos', () => {
    expect(shipped.groups.map((g) => g.id)).not.toContain('new');
  });

  it('names a repo for everyone in the list picked by repo, and for nobody else', () => {
    for (const group of shipped.groups) {
      const byRepo = group.id === 'most-starred';
      for (const person of group.people) expect(person.repo !== undefined, `${group.id} ${person.login}`).toBe(byRepo);
    }
  });
});

describe('pickRandom', () => {
  const person = (login: string) => ({ login, name: null, about: '' });
  const group = (id: string, people: string[]) => ({ id, title: id, blurb: id, people: people.map(person) });
  const catalogue: Catalogue = {
    generated: '2026-11-19',
    groups: [group('one', ['Ada', 'ben']), group('two', ['ben', 'cy', 'ada'])],
  };
  const at = (share: number, current: string | null = null) =>
    pickRandom(catalogue, current, () => share)?.person.login;

  it('gives each account the same chance, however many lists it is in', () => {
    // Three accounts across five listings: a third of the range each
    expect([0, 0.3, 0.34, 0.6, 0.67, 0.99].map((share) => at(share))).toEqual(['Ada', 'Ada', 'ben', 'ben', 'cy', 'cy']);
  });

  it('never picks the city being shown, whatever its capitals', () => {
    expect([0, 0.49, 0.5, 0.99].map((share) => at(share, 'ADA'))).toEqual(['ben', 'ben', 'cy', 'cy']);
  });

  it('says which list the account came from, by the first that has it', () => {
    expect(pickRandom(catalogue, null, () => 0.5)?.group.id).toBe('one');
    expect(pickRandom(catalogue, null, () => 0.9)?.group.id).toBe('two');
  });

  it('stays in range when the random number is at its limit', () => {
    expect(at(1)).toBe('cy');
  });

  it('has nobody to offer when the only account listed is the one on screen', () => {
    const lone: Catalogue = { generated: '2026-11-19', groups: [group('one', ['ada'])] };
    expect(pickRandom(lone, 'ada')).toBeNull();
    expect(pickRandom(lone, null)?.person.login).toBe('ada');
  });
});

describe('what the panel writes', () => {
  it('writes a date the way the rest of the page does', () => {
    expect(writtenDay('2026-11-19')).toBe('19 Nov 2026');
    expect(writtenDay('2027-01-05')).toBe('5 Jan 2027');
  });

  it('lists languages in a sentence', () => {
    expect(listed([])).toBe('');
    expect(listed(['R'])).toBe('R');
    expect(listed(['R', 'C'])).toBe('R and C');
    expect(listed(['R', 'C', 'Go'])).toBe('R, C and Go');
  });

  it("describes someone by their bio, or by the repo that put them in a list and what it's for", () => {
    expect(personLine({ login: 'a', name: null, about: 'Statistician' })).toBe('Statistician');
    expect(personLine({ login: 'a', name: null, about: 'A kernel', repo: { name: 'linux', stars: 256067 } })).toBe(
      'linux, 256,067 stars. A kernel',
    );
    expect(personLine({ login: 'a', name: null, about: '', repo: { name: 'ub-mode', stars: 8220 } })).toBe(
      'ub-mode, 8,220 stars',
    );
  });
});

describe('arriving from Explore', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('tells the city which list it was picked from, once', () => {
    vi.stubGlobal('sessionStorage', storage);
    noteArrival('KBroman', 'Biostatistics');
    expect(takeArrival('kbroman')).toBe('Biostatistics');
    expect(takeArrival('kbroman')).toBeNull();
  });

  it('says nothing to a different city, and forgets the note', () => {
    vi.stubGlobal('sessionStorage', storage);
    noteArrival('kbroman', 'Biostatistics');
    expect(takeArrival('torvalds')).toBeNull();
    expect(takeArrival('kbroman')).toBeNull();
  });

  it('copes with storage that is blocked or holds something else', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    });
    expect(() => noteArrival('kbroman', 'Biostatistics')).not.toThrow();
    expect(takeArrival('kbroman')).toBeNull();

    vi.stubGlobal('sessionStorage', storage);
    store.set('contriscape:arrival', 'not json');
    expect(takeArrival('kbroman')).toBeNull();
    store.set('contriscape:arrival', '{"login":"kbroman","from":7}');
    expect(takeArrival('kbroman')).toBeNull();
  });
});
