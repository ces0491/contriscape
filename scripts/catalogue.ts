import { z } from 'zod';
import { LOGIN_PATTERN } from '../shared/contract';
import type { Catalogue, Group, Person } from '../shared/explore';

/** Sends one GraphQL query to GitHub and returns its `data`. */
export type Ask = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** Followers an account needs to be listed under a field, which keeps those lists to people with a public following. */
export const FOLLOWERS = 200;
/** Contributions in the last year an account needs to be listed: one a day, so its city isn't bare ground. */
export const BUSY_YEAR = 365;
/** Accounts kept in each group. */
export const PER_GROUP = 12;
/** The most a search gives in one request. */
const SEARCHED = 100;
/** Requests spent on one group's search before settling for a short list. */
const PAGES = 3;
/** Accounts whose last year is read in one request. Asking for thirty at once ran past GitHub's ten seconds. */
const CHECKED_AT_ONCE = 5;
/** Stars a repo needs for the most-starred search. It only keeps the search small: the top few hundred are far above it. */
const STARRED_FROM = 20000;
/** GitHub caps a bio at this length. Repo descriptions run longer, so they are cut to match. */
const ABOUT_LIMIT = 160;

/** A field, and the words a bio has to contain for its account to be listed under it. */
export interface Field {
  id: string;
  title: string;
  says: string;
}

export const FIELDS: Field[] = [
  { id: 'data-science', title: 'Data science', says: 'data scientist' },
  { id: 'machine-learning', title: 'Machine learning', says: 'machine learning' },
  { id: 'statistics', title: 'Statistics', says: 'statistician' },
  { id: 'biostatistics', title: 'Biostatistics', says: 'biostatistics' },
  { id: 'bioinformatics', title: 'Bioinformatics', says: 'bioinformatics' },
  { id: 'economics', title: 'Economics', says: 'economist' },
  { id: 'physics', title: 'Physics', says: 'physicist' },
  // "astronomer" finds the staff of a company of that name
  { id: 'astrophysics', title: 'Astrophysics', says: 'astrophysics' },
  { id: 'mathematics', title: 'Mathematics', says: 'mathematician' },
  { id: 'security', title: 'Security', says: 'security researcher' },
  { id: 'games', title: 'Games', says: 'game developer' },
  { id: 'graphics', title: 'Graphics', says: 'computer graphics' },
  { id: 'compilers', title: 'Compilers', says: 'compiler' },
  { id: 'robotics', title: 'Robotics', says: 'robotics' },
];

const page = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });

const usersSchema = z.object({
  search: z.object({
    pageInfo: page,
    nodes: z.array(
      z
        .object({
          __typename: z.string(),
          login: z.string().optional(),
          name: z.string().nullish(),
          bio: z.string().nullish(),
        })
        .nullable(),
    ),
  }),
});

const reposSchema = z.object({
  search: z.object({
    pageInfo: page,
    nodes: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().nullable(),
          stargazerCount: z.number().int(),
          owner: z.object({ __typename: z.string(), login: z.string(), name: z.string().nullish() }),
        })
        .nullable(),
    ),
  }),
});

const busySchema = z.record(
  z.string(),
  z
    .object({
      contributionsCollection: z.object({ contributionCalendar: z.object({ totalContributions: z.number() }) }),
    })
    .nullable(),
);

const USERS_QUERY =
  'query($q:String!,$n:Int!,$after:String){search(query:$q,type:USER,first:$n,after:$after){' +
  'pageInfo{hasNextPage endCursor} nodes{__typename ... on User{login name bio}}}}';

const REPOS_QUERY =
  'query($q:String!,$n:Int!,$after:String){search(query:$q,type:REPOSITORY,first:$n,after:$after){' +
  'pageInfo{hasNextPage endCursor} nodes{... on Repository{name description stargazerCount ' +
  'owner{__typename login ... on User{name}}}}}}';

const busyQuery = (logins: string[]): string =>
  `query{${logins
    .map(
      (login, i) => `u${i}:user(login:"${login}"){contributionsCollection{contributionCalendar{totalContributions}}}`,
    )
    .join(' ')}}`;

/** One line of plain text: runs of white space become a space, and anything past the limit is cut at a word. */
export function tidy(text: string | null | undefined, limit = ABOUT_LIMIT): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= limit) return line;
  const cut = line.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

interface Found {
  people: Person[];
  /** Where the next request picks up, or `null` at the end of the results. */
  next: string | null;
}

/** The accounts among these with a busy last year, in the order given. */
async function busyOnes(ask: Ask, people: Person[]): Promise<Person[]> {
  const kept: Person[] = [];
  for (let i = 0; i < people.length; i += CHECKED_AT_ONCE) {
    const batch = people.slice(i, i + CHECKED_AT_ONCE);
    const reply = busySchema.parse(await ask(busyQuery(batch.map((p) => p.login)), {}));
    batch.forEach((person, n) => {
      const total = reply[`u${n}`]?.contributionsCollection.contributionCalendar.totalContributions ?? 0;
      if (total >= BUSY_YEAR) kept.push(person);
    });
  }
  return kept;
}

/** Works through a search a request at a time until a group is full, the results run out or the requests do. */
async function gather(ask: Ask, find: (after: string | null) => Promise<Found>): Promise<Person[]> {
  const kept: Person[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let request = 0; request < PAGES && kept.length < PER_GROUP; request++) {
    const { people, next } = await find(after);
    const fresh = people.filter((p) => {
      const key = p.login.toLowerCase();
      // A login that isn't one can't have come from GitHub, and it is about to be written into a query
      if (seen.has(key) || !LOGIN_PATTERN.test(p.login)) return false;
      seen.add(key);
      return true;
    });
    // Checked a few at a time, in order, so a full group doesn't pay to check the rest of the results
    for (let i = 0; i < fresh.length && kept.length < PER_GROUP; i += CHECKED_AT_ONCE) {
      kept.push(...(await busyOnes(ask, fresh.slice(i, i + CHECKED_AT_ONCE))));
    }
    if (next === null) break;
    after = next;
  }
  return kept.slice(0, PER_GROUP);
}

/**
 * Accounts whose bio says the field's words, most followed first. GitHub's search also matches other forms of a word,
 * so "Gamer. Developer." came back for "game developer". The list's heading says the bio has the words, so a bio
 * without them is left out.
 */
function byBio(ask: Ask, field: Field): Promise<Person[]> {
  const q = `"${field.says}" in:bio type:user followers:>=${FOLLOWERS} sort:followers`;
  const words = field.says.toLowerCase();
  return gather(ask, async (after) => {
    const { search } = usersSchema.parse(await ask(USERS_QUERY, { q, n: SEARCHED, after }));
    const people = search.nodes.flatMap((node) => {
      if (node?.__typename !== 'User' || !node.login) return [];
      const about = tidy(node.bio);
      return about.toLowerCase().includes(words) ? [{ login: node.login, name: tidy(node.name) || null, about }] : [];
    });
    return { people, next: search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null };
  });
}

/** The people who own the repos a search finds, each listed once, by their repo that came first. */
function byRepo(ask: Ask, q: string): Promise<Person[]> {
  return gather(ask, async (after) => {
    const { search } = reposSchema.parse(await ask(REPOS_QUERY, { q, n: SEARCHED, after }));
    const people = search.nodes.flatMap((repo) =>
      repo?.owner.__typename === 'User'
        ? [
            {
              login: repo.owner.login,
              name: tidy(repo.owner.name) || null,
              about: tidy(repo.description),
              repo: { name: repo.name, stars: repo.stargazerCount },
            },
          ]
        : [],
    );
    return { people, next: search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null };
  });
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The cities Explore offers: busy accounts by field, then the people who own the most-starred repos. A group nobody
 * qualifies for is left out.
 *
 * There is no list of new repos by stars, the nearest thing to trending that GitHub's API gives. What such a search
 * finds can't be known ahead of a run, and one listed a console emulator and a recompiled console game. It is also out
 * of date a month after it is made.
 */
export async function buildCatalogue(
  ask: Ask,
  now: Date,
  fields: Field[] = FIELDS,
  log: (line: string) => void = () => {},
): Promise<Catalogue> {
  const groups: Group[] = [];
  const add = (group: Omit<Group, 'people'>, people: Person[]) => {
    log(`${group.title}: ${people.length}`);
    if (people.length) groups.push({ ...group, people });
  };

  for (const field of fields) {
    add(
      { id: field.id, title: field.title, blurb: `People whose GitHub bio says “${field.says}”, most followed first.` },
      await byBio(ask, field),
    );
  }

  add(
    {
      id: 'most-starred',
      title: 'Most-starred repos',
      blurb:
        "The people who own GitHub's most-starred repos. Repos an organisation owns are left out, because an organisation has no city.",
    },
    await byRepo(ask, `stars:>${STARRED_FROM} sort:stars`),
  );

  return { generated: day(now), groups };
}
