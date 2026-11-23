import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Contributions } from '../shared/contract';
import { screenGrid, type Grid } from '../src/skins';

const SNAPSHOT = '2026-11-02';

const year = (length: number, day: (d: number) => number) => Array.from({ length }, (_, d) => day(d));

const busy = (login: string): Contributions => ({
  login,
  name: null,
  snapshot: SNAPSHOT,
  years: {
    '2024': year(366, (d) => (d % 5 ? 3 : 0)),
    '2025': year(365, (d) => (d * 7) % 40),
    '2026': year(306, (d) => (d === 200 ? 120 : (d * 3) % 30)),
  },
});

const empty: Contributions = {
  login: 'newcomer',
  name: null,
  snapshot: SNAPSHOT,
  years: { '2026': year(306, () => 0) },
};

interface CityDebug {
  mode: string;
  zoom: number;
  play: number;
  jump: { done: boolean } | null;
  firing: boolean;
  locked: number;
  sinceJump: number;
  bloom: { enabled: boolean };
  stick: { x: number };
  endFlight: () => void;
  visitBadge: (index: number) => void;
  approach: (index: number) => { x: number; y: number; z: number; pitch: number };
  run: { timed: boolean; seconds: number };
  map: { top: ArrayLike<number> };
  cal: { span(year: number): { a: number; b: number } };
  ship: {
    live: boolean;
    speed: number;
    yaw: number;
    pitch: number;
    bank: number;
    pos: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
  };
  startAttack: (year: number) => void;
  race: {
    phase: string;
    next: number;
    /** Seconds on a time attack's clock. */
    left?: number;
    course: {
      year: number;
      gates: { at: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }[];
    };
  } | null;
  roll: { side: number; t: number } | null;
  onEdge: boolean;
  rival: { visible: boolean };
  camera: { matrixWorld: { elements: number[] } };
  weapons: { activeBolts: number };
  badges: { tokens: { visible: boolean }[]; milestones: { id: string; name: string }[]; earned: Set<string> };
  blasts: { active: boolean; exploding: boolean }[];
  fireworks: { active: boolean };
  fighter: {
    visible: boolean;
    position: { clone(): { project(camera: unknown): { x: number; y: number; z: number } } };
    children: { material: { color: { getHexString(): string }; name: string; emissiveIntensity: number } }[];
  };
  shared: { uRamp: { value: { b: number }[] } };
  saver: { orbitLeft: number } | null;
  aboard: boolean;
  idleFor: (seconds: number) => void;
  /** The sound's private rig, read for the engine's level. */
  sound: { rig: { engine: { gain: number } } | null };
}
interface Heard {
  contexts: AudioContext[];
  started: number;
}
declare global {
  interface Window {
    __city: CityDebug;
    __heard: Heard;
  }
}

async function stubApi(page: Page, reply: { status?: number; body: unknown; headers?: Record<string, string> }) {
  await page.route('**/api/contributions/*', (route) =>
    route.fulfill({ status: reply.status ?? 200, json: reply.body, headers: reply.headers }),
  );
}

/** What Explore offers in these tests: two people, one of them in both lists. */
const CATALOGUE = {
  generated: '2026-11-02',
  groups: [
    {
      id: 'statistics',
      title: 'Statistics',
      blurb: 'People whose GitHub bio says “statistician”, most followed first.',
      people: [
        { login: 'octo-dev', name: 'Octo Dev', about: 'Statistician' },
        { login: 'ada-l', name: 'Ada L', about: 'Statistician. Writes R.' },
      ],
    },
    {
      id: 'most-starred',
      title: 'Most-starred repos',
      blurb: "The people who own GitHub's most-starred repos.",
      people: [{ login: 'ada-l', name: 'Ada L', about: 'An engine', repo: { name: 'engine', stars: 250000 } }],
    },
  ],
};

const profiled = (login: string): Contributions => ({
  ...busy(login),
  name: 'Ada L',
  profile: {
    bio: 'Statistician. Writes R.',
    followers: 1486,
    languages: ['R', 'C'],
    repos: [
      { owner: login, name: 'engine', description: 'An engine', stars: 250000, language: 'C' },
      { owner: 'someone-else', name: 'charts', description: null, stars: 1, language: null },
    ],
    pinned: true,
  },
});

/** Serves the lists, and a city for whichever username is asked for. Only `ada-l` has a profile. */
async function stubExplore(page: Page) {
  await page.route('**/explore.json', (route) => route.fulfill({ json: CATALOGUE }));
  await page.route('**/api/contributions/*', (route) => {
    const login = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    return route.fulfill({ json: login === 'ada-l' ? profiled(login) : busy(login) });
  });
}

const cityReady = (page: Page) => expect(page.locator('body')).not.toHaveClass(/empty/, { timeout: 20_000 });

const shipLive = (page: Page) =>
  expect.poll(() => page.evaluate(() => window.__city.ship.live), { timeout: 30_000 }).toBe(true);

async function pickYear(page: Page, key: string) {
  await page.click('#year');
  await page.click(`#years button[data-key="${key}"]`);
}

/** Counts the audio contexts the page makes and the sounds started in them. */
async function listenForSound(page: Page) {
  await page.addInitScript(() => {
    const heard: Heard = { contexts: [], started: 0 };
    window.__heard = heard;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        heard.contexts.push(this);
      }
    };
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (...args) {
      heard.started++;
      return start.apply(this, args);
    };
  });
}

/** Fails a test on anything the production CSP blocks, and on uncaught errors. */
function watchForFaults(page: Page): string[] {
  const faults: string[] = [];
  page.on('pageerror', (e) => faults.push(e.message));
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) faults.push(m.text());
  });
  return faults;
}

test('builds a city from a username in the URL, under the production CSP', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/OCTO-DEV');
  await cityReady(page);
  await expect(page).toHaveTitle('octo-dev · contriscape');
  await expect(page).toHaveURL(/\/octo-dev$/);
  await expect(page.locator('#login')).toHaveText('octo-dev');
  await expect(page.locator('#scopeLabel')).toHaveText('2024–2026 · contriscape');
  await expect(page.locator('#note')).toContainText('Not affiliated with GitHub');
  expect(faults).toEqual([]);
});

test('loads Vercel Web Analytics from the site itself, which the CSP allows', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  const script = page.waitForRequest((request) => request.url().includes('/_vercel/insights/script.js'));
  await page.goto('/octo-dev');
  expect(new URL((await script).url()).origin).toBe(new URL(page.url()).origin);
  await cityReady(page);
  expect(faults).toEqual([]);
});

test('asks the API for the lower-case login, so each user has one cached copy', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  const request = page.waitForRequest('**/api/contributions/*');
  await page.goto('/Octo-Dev');
  expect((await request).url()).toMatch(/\/api\/contributions\/octo-dev$/);
});

test("shows the default city at the root, under the site's own title", async ({ page }) => {
  await stubApi(page, { body: busy('torvalds') });
  await page.goto('/');
  await cityReady(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#login')).toHaveText('torvalds');
  await expect(page).toHaveTitle('contriscape: fly through your GitHub contributions');
});

test('the front page says its city is an example, then gives the controls', async ({ page }) => {
  await stubApi(page, { body: busy('torvalds') });
  await page.goto('/');
  await cityReady(page);
  const hint = page.locator('#hint');
  await expect(hint).toHaveText(
    'Example city: torvalds. Enter a GitHub username to fly another, or find one in Explore.',
  );
  await expect(hint).toHaveText(/zoom/, { timeout: 60_000 });
});

test('a city asked for by name goes straight to the controls', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect(page.locator('#hint')).toHaveText(/zoom/);
});

test('the username box takes you to that city', async ({ page }) => {
  await stubApi(page, { body: busy('torvalds') });
  await page.goto('/');
  await cityReady(page);
  await page.fill('#loginInput', '@torvalds');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/torvalds$/);
});

test('explains a username GitHub could not have issued, without calling the API', async ({ page }) => {
  let called = false;
  await page.route('**/api/contributions/*', (route) => {
    called = true;
    return route.abort();
  });
  await page.goto('/-nope');
  await expect(page.locator('#status')).toContainText("isn't a valid GitHub username");
  await expect(page.locator('#loginInput')).toBeVisible();
  expect(called).toBe(false);
});

test('without WebGL, the page becomes the Guide, readable to the end, and never calls the API', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const faults = watchForFaults(page);
  let called = false;
  await page.route('**/api/contributions/*', (route) => {
    called = true;
    return route.abort();
  });
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof real>) {
      return args[0].startsWith('webgl') ? null : real.apply(this, args);
    } as typeof real;
  });
  await page.goto('/');
  await expect(page.locator('#login')).toHaveText('contriscape');
  await expect(page.locator('#status')).toContainText('fly a starfighter through a 3D city');
  await expect(page.locator('#status')).toContainText("needs WebGL, which this browser doesn't have");
  await expect(page).toHaveTitle('contriscape: fly through your GitHub contributions');
  await expect(page.locator('#guidePanel')).toContainText('Each tower is one day');
  await expect(page.locator('#guidePanel .panel-close')).toBeHidden();
  const last = page.locator('#guidePanel p').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  expect(called).toBe(false);
  expect(faults).toEqual([]);
  await context.close();
});

test('pressing Fly with an empty box does nothing, and shows no message', async ({ page }) => {
  await stubApi(page, { body: busy('torvalds') });
  await page.goto('/');
  await cityReady(page);
  await page.click('#lookup button');
  await expect(page.locator('#status')).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#loginInput')).toBeFocused();
});

test('a message about a bad name clears when you type, and by itself', async ({ page }) => {
  await stubApi(page, { body: busy('torvalds') });
  await page.goto('/');
  await cityReady(page);
  await page.fill('#loginInput', 'not a name');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toBeVisible();
  await page.keyboard.type('x');
  await expect(page.locator('#status')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toBeHidden({ timeout: 8_000 });
});

test('rejects a bad name typed into the box', async ({ page }) => {
  await stubApi(page, { body: busy('torvalds') });
  await page.goto('/');
  await cityReady(page);
  await page.fill('#loginInput', 'not a name');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText("isn't a valid GitHub username");
  await expect(page).toHaveURL(/\/$/);
});

for (const [name, status, error, message] of [
  ['a missing user', 404, 'not-found', 'No GitHub user called'],
  ['the GitHub limit', 429, 'rate-limited', 'hourly limit'],
  ['a GitHub outage', 502, 'unavailable', "didn't answer in time"],
] as const) {
  test(`explains ${name} and leaves the username box usable`, async ({ page }) => {
    await stubApi(page, { status, body: { error } });
    await page.goto('/someone');
    await expect(page.locator('#status')).toContainText(message);
    await expect(page.locator('#loginInput')).toBeVisible();
    await expect(page.locator('.deck')).toBeHidden();
  });
}

test("explains the firewall's limit, which answers with no reason of the API's", async ({ page }) => {
  await page.route('**/api/contributions/*', (route) =>
    route.fulfill({ status: 429, contentType: 'text/plain', body: 'Too Many Requests' }),
  );
  await page.goto('/someone');
  await expect(page.locator('#status')).toContainText('Try again in a minute');
  await expect(page.locator('#loginInput')).toBeVisible();
  await expect(page.locator('.deck')).toBeHidden();
});

test('Explore lists other cities, and one picked there opens saying whose it is', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubExplore(page);
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#explore');
  await expect(page.locator('#explorePanel')).toBeVisible();
  // The lists from the file, then the cities flown in this browser, which already has this one
  await expect(page.locator('#exploreGroups button')).toHaveText(['Statistics', 'Most-starred repos', 'Flown here']);
  await expect(page.locator('#exploreNote')).toContainText('2 Nov 2026');
  await expect(page.locator('#about')).toBeHidden();
  await expect(page.locator('#explorePeople a[aria-current]')).toContainText('Octo Dev');

  await page.locator('#exploreGroups button', { hasText: 'Most-starred' }).click();
  await expect(page.locator('#explorePeople a')).toHaveCount(1);
  await expect(page.locator('#explorePeople a')).toContainText('engine, 250,000 stars. An engine');
  await page.locator('#explorePeople a').click();
  await expect(page).toHaveURL(/\/ada-l$/);
  await cityReady(page);

  // The card goes after twelve seconds, which a slow machine can spend between two steps of a test. So it is read and
  // its button pressed in one step, straight after the city is up.
  const card = await page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)?.textContent;
    const read = {
      shown: !(document.getElementById('arrival') as HTMLElement).hidden,
      from: text('arrivalFrom'),
      name: text('arrivalName'),
      bio: text('arrivalBio'),
    };
    (document.getElementById('arrivalMore') as HTMLElement).click();
    return read;
  });
  expect(card).toEqual({ shown: true, from: 'Most-starred repos', name: 'Ada L', bio: 'Statistician. Writes R.' });
  await expect(page.locator('#arrival')).toBeHidden();
  await expect(page.locator('#about')).toBeVisible();
  await expect(page.locator('#others')).toBeHidden();
  await expect(page.locator('#aboutFacts')).toHaveText('1,486 followers. Repos mostly in R and C.');
  await expect(page.locator('#aboutReposTitle')).toHaveText('Pinned');
  const repos = page.locator('#aboutRepos a');
  await expect(repos).toHaveText(['engine', 'someone-else/charts']);
  await expect(repos.first()).toHaveAttribute('href', 'https://github.com/ada-l/engine');
  await expect(repos.first()).toHaveAttribute('target', '_blank');
  await expect(repos.first()).toHaveAttribute('rel', 'noopener noreferrer');

  // The Explore button is for finding somewhere else, so it comes back on the lists
  await page.click('#explore');
  await expect(page.locator('#explorePanel')).toBeHidden();
  await page.click('#explore');
  await expect(page.locator('#others')).toBeVisible();
  await expect(page.locator('#about')).toBeHidden();
  expect(faults).toEqual([]);
});

test('Random city flies somewhere other than here, and the introduction goes when the visitor takes over', async ({
  page,
}) => {
  await stubExplore(page);
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#explore');
  await page.click('#random');
  await expect(page).toHaveURL(/\/ada-l$/);
  await cityReady(page);
  await expect(page.locator('#arrivalFrom')).toHaveText('Statistics');
  await page.click('#m-pilot');
  await expect(page.locator('#arrival')).toBeHidden();
});

test('with no city to show, Explore still offers the lists, on the narrowest phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await stubApi(page, { status: 404, body: { error: 'not-found' } });
  let down = true;
  await page.route('**/explore.json', (route) =>
    down ? route.fulfill({ status: 500, body: '' }) : route.fulfill({ json: CATALOGUE }),
  );
  await page.goto('/nobody-here');
  const status = page.locator('#status');
  await expect(status).toContainText('No GitHub user');
  const button = await page.locator('#explore').boundingBox();
  expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(320);

  await page.tap('#explore');
  const panel = page.locator('#explorePanel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#exploreNote')).toContainText("didn't load");
  // The panel would sit across the message, and there is no city to switch to
  await expect(status).toBeHidden();
  await expect(page.locator('#exploreViews')).toBeHidden();

  down = false;
  await panel.locator('.panel-close').tap();
  await expect(panel).toBeHidden();
  await expect(status).toBeVisible();
  await page.tap('#explore');
  await expect(page.locator('#explorePeople a')).toHaveCount(2);
  const box = await panel.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);

  await page.locator('#explorePeople a').nth(1).tap();
  await expect(page).toHaveURL(/\/ada-l$/);
  await context.close();
});

test('flies an account with no contributions', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: empty });
  await page.goto('/newcomer');
  await cityReady(page);
  await expect(page.locator('#note')).toContainText('No public contributions yet');
  await pickYear(page, '2026');
  await page.waitForTimeout(600);
  await page.click('#m-orbit');
  await expect(page.locator('#busiest')).toHaveText('None');
  expect(faults).toEqual([]);
});

test('autopilot flies a busy year high enough to look down on most of its towers', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await pickYear(page, '2026');
  await page.evaluate(() => {
    const scrub = document.getElementById('scrub') as HTMLInputElement;
    scrub.value = String(Math.round((Number(scrub.min) + Number(scrub.max)) / 2));
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__city.ship.pos.y), { timeout: 30_000 }).toBeGreaterThan(8);
  const lookingUp = () => page.evaluate(() => -window.__city.camera.matrixWorld.elements[9]);
  await expect.poll(lookingUp, { timeout: 30_000 }).toBeLessThan(-0.1);
});

test('copies a link to the city', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#share');
  await expect(page.locator('#share')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/octo-dev$/);
});

test('pilot flies, fires, and scrolls in and out of the cockpit', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await expect.poll(() => page.evaluate(() => window.__city.ship.live), { timeout: 15_000 }).toBe(true);

  const x = await page.evaluate(() => window.__city.ship.pos.x);
  await page.mouse.move(720, 450);
  await expect.poll(() => page.evaluate(() => window.__city.ship.pos.x)).toBeGreaterThan(x + 1);

  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__city.weapons.activeBolts)).toBeGreaterThan(0);
  await page.keyboard.up('Space');

  await page.mouse.wheel(0, -3000);
  await expect(page.locator('#canopy')).toBeVisible();
  await page.mouse.wheel(0, 2000);
  await expect(page.locator('#canopy')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__city.zoom)).toBeGreaterThan(0.2);
});

for (const mode of ['pilot', 'fly'] as const) {
  test(`one notch of the wheel leaves the cockpit in ${mode === 'fly' ? 'Autopilot' : 'Pilot'}`, async ({ page }) => {
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/octo-dev');
    await cityReady(page);
    await page.click(`#m-${mode}`);
    await expect
      .poll(() => page.evaluate(() => window.__city.ship.pos.x !== 0 || window.__city.ship.live), { timeout: 30_000 })
      .toBe(true);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -3000);
    await expect(page.locator('#canopy')).toBeVisible({ timeout: 30_000 });
    await page.mouse.wheel(0, 100);
    await expect(page.locator('#canopy')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__city.fighter.visible)).toBe(true);
  });
}

test('typing a username in Pilot does not steer the ship', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await expect.poll(() => page.evaluate(() => window.__city.ship.live), { timeout: 15_000 }).toBe(true);
  await page.fill('#loginInput', '');
  await page.focus('#loginInput');
  await page.keyboard.press('w');
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  expect(Math.abs(await page.evaluate(() => window.__city.ship.pitch))).toBeLessThan(0.01);
  await expect(page.locator('#loginInput')).toHaveValue(/^w+$/);
});

test('after a timeline drag the keys fly the ship again', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  const box = await page.locator('#scrub').boundingBox();
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.5, y);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.6, y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#scrub')).not.toBeFocused();

  const yaw = () => page.evaluate(() => window.__city.ship.yaw);
  const before = await yaw();
  await page.keyboard.down('ArrowLeft');
  await expect.poll(yaw).toBeGreaterThan(before);
  await page.keyboard.up('ArrowLeft');
});

test('someone who tabs to the timeline keeps it', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-orbit');
  await page.focus('#scrub');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#scrub')).toBeFocused();
});

test('picking a year while paused resumes the flight, and the button says so', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#play');
  await expect(page.locator('#play')).toHaveText('Play');
  await pickYear(page, '2025');
  await expect(page.locator('#play')).toHaveText('Pause');
});

test('a frame that repeats a timestamp leaves the autopilot view intact', async ({ page }) => {
  await page.addInitScript(() => {
    const next = window.requestAnimationFrame.bind(window);
    let held = 0;
    let repeat = false;
    window.requestAnimationFrame = (callback) =>
      next((now) => {
        repeat = !repeat;
        if (repeat) held = now;
        callback(held);
      });
  });
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect.poll(() => page.evaluate(() => window.__city.ship.pos.x), { timeout: 60_000 }).not.toBe(0);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__city.camera.matrixWorld.elements.every(Number.isFinite))).toBe(true);
});

test('lifting the Fire thumb leaves the steering thumb steering, and the other way round', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.tap('#m-pilot');
  await shipLive(page);

  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: { x: number; y: number; id: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  // Reads the controls themselves, because the ship's heading also jumps when it bounces off a tower
  const steer = () => page.evaluate(() => window.__city.stick.x);
  const firing = () => page.evaluate(() => window.__city.firing);
  const box = await page.locator('#fire').boundingBox();
  const fire = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2, id: 1 };

  await touch('touchStart', [{ x: 100, y: 300, id: 0 }]);
  const steering = { x: 190, y: 300, id: 0 };
  await touch('touchMove', [steering]);
  await expect.poll(steer).toBeGreaterThan(0);
  await touch('touchStart', [steering, fire]);
  await expect.poll(firing).toBe(true);

  // A touchEnd lifts the fingers it lists
  await touch('touchEnd', [fire]);
  await expect.poll(firing).toBe(false);
  expect(await steer()).toBeGreaterThan(0);

  await touch('touchStart', [steering, fire]);
  await expect.poll(firing).toBe(true);
  await touch('touchEnd', [steering]);
  await expect.poll(steer).toBe(0);
  expect(await firing()).toBe(true);
  await touch('touchEnd', []);
  await context.close();
});

test('scroll zooms in Orbit, including over the controls', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-orbit');
  const distance = () =>
    page.evaluate(() => {
      const { camera, controls } = window.__city as unknown as {
        camera: { position: { distanceTo(p: unknown): number } };
        controls: { target: unknown };
      };
      return camera.position.distanceTo(controls.target);
    });
  await page.mouse.move(720, 300);
  await page.waitForTimeout(600);
  const start = await distance();
  await page.mouse.wheel(0, -500);
  await expect.poll(distance).toBeLessThan(start - 5);
  const closer = await distance();
  await page.mouse.move(300, 780);
  await page.mouse.wheel(0, 500);
  await expect.poll(distance).toBeGreaterThan(closer + 5);
});

test('a long history keeps its years in one panel', async ({ page }) => {
  const years = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(2007 + i), year(10, () => 1)]));
  await stubApi(page, { body: { ...busy('veteran'), years } });
  await page.goto('/veteran');
  await cityReady(page);
  await expect(page.locator('#year')).toHaveText('All years');
  await expect(page.locator('#years')).toBeHidden();

  await page.click('#year');
  await expect(page.locator('#years button')).toHaveCount(21);
  await page.click('#years button[data-key="2015"]');
  await expect(page.locator('#yearPanel')).toBeHidden();
  await expect(page.locator('#year')).toHaveText('2015');
  await expect(page.locator('#scopeLabel')).toContainText('2015');
});

test('names its two main buttons by what they do', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect(page.locator('#lookup button')).toHaveText('Visit');
  await page.click('#m-orbit');
  await expect(page.locator('#play')).toHaveText('Replay');
});

test('WASD and the arrow keys steer the same way', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await expect.poll(() => page.evaluate(() => window.__city.ship.live), { timeout: 30_000 }).toBe(true);
  await page.mouse.move(720, 450);

  const change = async (key: string, field: 'yaw' | 'pitch') => {
    const before = await page.evaluate((f) => window.__city.ship[f], field);
    await page.keyboard.down(key);
    await page.waitForTimeout(500);
    await page.keyboard.up(key);
    return (await page.evaluate((f) => window.__city.ship[f], field)) - before;
  };
  for (const [letter, arrow, field] of [
    ['a', 'ArrowLeft', 'yaw'],
    ['d', 'ArrowRight', 'yaw'],
    ['w', 'ArrowUp', 'pitch'],
    ['s', 'ArrowDown', 'pitch'],
  ] as const) {
    const byLetter = await change(letter, field);
    const byArrow = await change(arrow, field);
    expect(byLetter).not.toBe(0);
    expect(Math.sign(byLetter)).toBe(Math.sign(byArrow));
  }
});

test('pilot can invert the Y axis, and the choice is remembered', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  await page.click('#settings');
  await expect(page.locator('#invert')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');

  const pitchChange = async () => {
    const before = await page.evaluate(() => window.__city.ship.pitch);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
    return (await page.evaluate(() => window.__city.ship.pitch)) - before;
  };
  expect(await pitchChange()).toBeGreaterThan(0);
  await page.click('#settings');
  await page.click('#invert');
  await page.keyboard.press('Escape');
  expect(await pitchChange()).toBeLessThan(0);

  await page.reload();
  await cityReady(page);
  await page.click('#settings');
  await expect(page.locator('#invert')).toHaveAttribute('aria-pressed', 'true');
});

test('the mouse only steers once it is switched on, and the choice is remembered', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);

  const turnWithMouse = async () => {
    await page.mouse.move(720, 400);
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.__city.ship.yaw);
    await page.mouse.move(1200, 400);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => window.__city.ship.yaw);
    await page.mouse.move(720, 400);
    return after - before;
  };
  expect(await turnWithMouse()).toBe(0);
  await page.keyboard.press('m');
  expect(await turnWithMouse()).toBeLessThan(-0.05);

  await page.reload();
  await cityReady(page);
  await page.click('#settings');
  await expect(page.locator('#mouseSteer')).toHaveAttribute('aria-pressed', 'true');
});

test('a ship on the ground levels out, so its shots still fly', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  await page.keyboard.down('ArrowDown');
  await expect.poll(() => page.evaluate(() => window.__city.ship.pos.y), { timeout: 30_000 }).toBeLessThan(0.75);
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__city.weapons.activeBolts)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__city.ship.pitch)).toBeGreaterThanOrEqual(0);
});

test('sound waits for a key press, plays the guns, and once switched off stays off', async ({ page }) => {
  await listenForSound(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  // The jump has a sound, but a script isn't the visitor, and browsers refuse audio until the visitor acts
  await page.evaluate(() => window.__city.visitBadge(0));
  await shipLive(page);
  expect(await page.evaluate(() => window.__heard.contexts.length)).toBe(0);

  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__heard.contexts[0]?.state)).toBe('running');
  const before = await page.evaluate(() => window.__heard.started);
  await expect.poll(() => page.evaluate(() => window.__heard.started)).toBeGreaterThan(before);
  await page.keyboard.up('Space');

  await page.keyboard.press('n');
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.__heard.contexts[0].state)).toBe('suspended');
  const quiet = await page.evaluate(() => window.__heard.started);
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__city.weapons.activeBolts)).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__heard.started)).toBe(quiet);

  await page.reload();
  await cityReady(page);
  await page.click('#settings');
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__heard.contexts.length)).toBe(0);
  await page.click('#sound');
  await expect.poll(() => page.evaluate(() => window.__heard.contexts[0]?.state)).toBe('running');
});

test('on a phone, sound starts when the finger lifts, not when it lands', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await listenForSound(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 330 }] });
  // A finger landing isn't a go-ahead for sound, so nothing may be built yet
  expect(await page.evaluate(() => window.__heard.contexts.length)).toBe(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.__heard.contexts[0]?.state)).toBe('running');
  await context.close();
});

test('music has its own switch, remembered, and the chords start with the sound', async ({ page }) => {
  await listenForSound(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-orbit');
  await expect.poll(() => page.evaluate(() => window.__heard.contexts[0]?.state)).toBe('running');
  // The engine and the unlocking blank are five sources. The first chord adds eight voices and a bass note.
  await expect.poll(() => page.evaluate(() => window.__heard.started)).toBeGreaterThanOrEqual(14);

  await page.click('#settings');
  await expect(page.locator('#music')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#music');
  await expect(page.locator('#music')).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await cityReady(page);
  await page.click('#m-orbit');
  await expect.poll(() => page.evaluate(() => window.__heard.contexts[0]?.state)).toBe('running');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__heard.started)).toBeLessThan(8);
  await page.click('#settings');
  await expect(page.locator('#music')).toHaveAttribute('aria-pressed', 'false');
});

test('holding Space in Autopilot pauses once, however long it is held', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect(page.locator('#play')).toHaveText('Pause');
  // A held key sends the press again and again
  for (let n = 0; n < 5; n++) await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await expect(page.locator('#play')).toHaveText('Play');
  await page.keyboard.press('Space');
  await expect(page.locator('#play')).toHaveText('Pause');
});

test('only the main mouse button fires, and Pilot keeps the browser menu away', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const menuHeldBack = () =>
    page.evaluate(() => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.getElementById('gl')?.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await menuHeldBack()).toBe(false);
  await page.click('#m-pilot');
  await shipLive(page);
  expect(await menuHeldBack()).toBe(true);
  await page.mouse.move(720, 450);
  await page.mouse.down({ button: 'right' });
  expect(await page.evaluate(() => window.__city.firing)).toBe(false);
  await page.mouse.up({ button: 'right' });
  await page.mouse.down();
  expect(await page.evaluate(() => window.__city.firing)).toBe(true);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__city.firing)).toBe(false);
});

test('with no badge left to lead it, a ship clear of the city is shown the way back', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  // A marker is a point its parts hang from, with no size of its own, so what tells is whether it is hidden
  const home = page.locator('.marker.home');
  const flyTo = (x: number) =>
    page.evaluate((x) => {
      const { ship } = window.__city;
      ship.pos.set(x, 20, 8);
      ship.yaw = Math.PI / 2;
      ship.pitch = 0;
    }, x);

  // Badges still standing have markers of their own, which point at the city
  await page.click('#m-pilot');
  await shipLive(page);
  await flyTo(-200);
  await expect.poll(() => page.locator('.marker:not(.home):not([hidden])').count()).toBeGreaterThan(0);
  await expect(home).toHaveJSProperty('hidden', true);

  const all = await page.evaluate(() => window.__city.badges.milestones.map(({ id }) => id));
  await page.evaluate((ids) => localStorage.setItem('contriscape:badges:octo-dev', JSON.stringify(ids)), all);
  await page.reload();
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  await expect(home).toHaveJSProperty('hidden', true);
  await flyTo(-200);
  await expect(home).toHaveJSProperty('hidden', false);
  // Flying west, the city is behind, so the marker is pinned to the edge with its distance
  await expect(home).toHaveClass(/edge/);
  expect(Number(await home.locator('span').textContent())).toBeGreaterThan(150);
  await flyTo(40);
  await expect(home).toHaveJSProperty('hidden', true);
  await page.click('#m-orbit');
  await expect(home).toHaveJSProperty('hidden', true);
});

test('when an Autopilot flight ends it offers the controls, and taking them starts Pilot', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const offer = page.locator('#offer');
  await expect(offer).toBeHidden();
  await page.evaluate(() => window.__city.endFlight());
  await expect(offer).toBeVisible();
  await page.click('#offerPilot');
  await expect(offer).toBeHidden();
  expect(await page.evaluate(() => window.__city.mode)).toBe('pilot');

  // Picking another way of flying takes the offer away too
  await page.click('#m-fly');
  await page.evaluate(() => window.__city.endFlight());
  await expect(offer).toBeVisible();
  await page.click('#m-fly');
  await expect(offer).toBeHidden();
});

test('the screensaver flies year after year with only the view on screen, and a move of the mouse or a key ends it', async ({
  page,
}) => {
  const faults = watchForFaults(page);
  await listenForSound(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#settings');
  await page.click('#saverStart');
  await expect(page.locator('body')).toHaveClass(/screensaver/);
  await expect(page.locator('header.top')).toBeHidden();
  await expect(page.locator('.deck')).toBeHidden();
  await expect(page.locator('#settingsPanel')).toBeHidden();
  await expect(page.locator('#saverName')).toHaveText('octo-dev');
  await expect(page.locator('#saverLeave')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  expect(await page.evaluate(() => window.__city.mode)).toBe('fly');

  // A flight ends in an Orbit of the city, and then another flight starts
  const first = await page.locator('#saverYears').textContent();
  await page.evaluate(() => window.__city.endFlight());
  expect(await page.evaluate(() => window.__city.mode)).toBe('orbit');
  await page.evaluate(() => {
    const saver = window.__city.saver;
    if (saver) saver.orbitLeft = 0.05;
  });
  await expect.poll(() => page.evaluate(() => window.__city.mode)).toBe('fly');
  await expect(page.locator('#saverYears')).not.toHaveText(first ?? '');
  await expect(page.locator('#saverLeave')).toBeHidden();

  // The engine is quiet once the ship is under way, with nobody flying it. The music isn't checked: it is booked on
  // the audio clock, which barely moves in headless Chromium.
  await expect.poll(() => page.evaluate(() => window.__heard.contexts[0]?.state)).toBe('running');
  await expect.poll(() => page.evaluate(() => window.__city.aboard), { timeout: 120_000 }).toBe(true);
  expect(await page.evaluate(() => window.__city.sound.rig?.engine.gain)).toBe(0);

  // A twitch of the mouse leaves it running, and a move ends it, back at the visitor's own distance. The jump into the
  // flight takes longer than the second in which a hand letting go of the mouse is ignored.
  await page.mouse.move(300, 300);
  await page.mouse.move(304, 303);
  expect(await page.evaluate(() => window.__city.saver)).not.toBeNull();
  await page.mouse.move(340, 330);
  await expect(page.locator('body')).not.toHaveClass(/screensaver/);
  await expect(page.locator('header.top')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect.poll(() => page.evaluate(() => Math.abs(window.__city.zoom - 1) < 0.02)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window.__city.sound.rig?.engine.gain ?? 0) > 0)).toBe(true);

  // The key that ends it does nothing else, so Space doesn't also pause the flight
  await page.click('#settings');
  await page.click('#saverStart');
  await expect(page.locator('body')).toHaveClass(/screensaver/);
  await page.keyboard.press('Space');
  await expect(page.locator('body')).not.toHaveClass(/screensaver/);
  await expect(page.locator('#play')).toHaveText('Pause');
  expect(faults).toEqual([]);
});

test('a screensaver link opens straight into it, and one can start after two minutes alone', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev#screensaver');
  await cityReady(page);
  await expect(page.locator('body')).toHaveClass(/screensaver/);
  await page.keyboard.press('KeyX');
  await expect(page.locator('body')).not.toHaveClass(/screensaver/);
  // A reload would otherwise open it again
  await expect(page).toHaveURL(/\/octo-dev$/);

  // Off until the visitor switches it on, and remembered
  await page.click('#settings');
  await expect(page.locator('#saverIdle')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#saverIdle');
  await expect(page.locator('#saverIdle')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('contriscape:screensaver-idle'))).toBe('1');

  // Never over an open panel, which someone could be reading
  await page.evaluate(() => window.__city.idleFor(150));
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await page.evaluate(() => window.__city.saver)).toBeNull();

  await page.click('#settingsPanel .panel-close');
  await page.evaluate(() => window.__city.idleFor(150));
  await expect(page.locator('body')).toHaveClass(/screensaver/);
  // Nothing clicked, so the browser keeps its window
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('a city flown clear from its first badge is timed, and a jump from the list stops the clock', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const clock = page.locator('#run');
  const count = await page.evaluate(() => window.__city.badges.milestones.length);
  const has = (index: number) =>
    page.evaluate((index) => {
      const { badges } = window.__city;
      return badges.earned.has(badges.milestones[index].id);
    }, index);
  /** Sets the ship down where the list would, without the jump that would stop the clock, and shoots. */
  const flyClear = async () => {
    for (let index = 0; index < count; index++) {
      // Badges that share a day hang one over the other, and a pair of bolts can take both
      if (await has(index)) continue;
      await page.evaluate((index) => {
        const { ship, approach } = window.__city;
        const to = approach(index);
        ship.pos.set(to.x, to.y, to.z);
        ship.yaw = 0;
        ship.pitch = to.pitch;
        ship.speed = 0;
      }, index);
      await page.keyboard.down('Space');
      await expect.poll(() => has(index), { timeout: 60_000 }).toBe(true);
      await page.keyboard.up('Space');
    }
  };

  await expect(clock).toBeHidden();
  await page.click('#m-pilot');
  await shipLive(page);
  await expect(clock).toHaveText(/^Clear \d+:\d\d$/);
  await flyClear();
  await expect(page.locator('#toast b')).toHaveText('City cleared in flight');
  await expect(page.locator('#toast span')).toHaveText(/ in \d+:\d\d$/);
  await expect(clock).toBeHidden();
  const best = Number(await page.evaluate(() => localStorage.getItem('contriscape:best:octo-dev')));
  expect(best).toBeGreaterThan(0);
  await page.click('#badges');
  await expect(page.locator('#badgeFlown')).toContainText(/Fastest clear \d+:\d\d\./);

  // A reset puts the clock back to nothing and keeps the fastest clear
  await page.click('#badgeReset');
  await page.click('#badgeReset');
  await expect(page.locator('#badgeFlown')).toHaveText(/^Fastest clear \d+:\d\d\.$/);
  await page.keyboard.press('Escape');
  await expect(clock).toBeVisible();
  expect(await page.evaluate(() => window.__city.run.seconds)).toBeLessThan(best);

  // A jump carries the ship across the city in no time, so the clear it helps isn't timed
  await page.click('#badges');
  await page.locator('#badgeList button').first().click();
  await expect(clock).toBeHidden();
  expect(await page.evaluate(() => window.__city.run.timed)).toBe(false);
});

test('gold markers lead to the badges in Pilot, and step aside in Autopilot', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const shown = () => page.locator('.marker:not([hidden])').count();
  await expect.poll(shown).toBe(0);
  await page.click('#m-pilot');
  await shipLive(page);
  await expect.poll(shown).toBeGreaterThan(0);
  // Every marker stays inside the view
  for (const box of await page
    .locator('.marker:not([hidden])')
    .evaluateAll((all) => all.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeLessThanOrEqual(1440);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeLessThanOrEqual(900);
  }
  await page.click('#m-fly');
  await expect.poll(shown).toBe(0);
});

test('the targeting computer locks on to a badge ahead and names it', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.evaluate(() => localStorage.removeItem('contriscape:badges:octo-dev'));
  await page.click('#badges');
  await page.locator('#badgeList button').first().click();
  await shipLive(page);
  await expect.poll(() => page.evaluate(() => window.__city.locked)).toBe(0);
  const name = await page.evaluate(() => window.__city.badges.milestones[0].name);
  // The lock is a point the corners and label hang from, so the label is what can be seen
  const label = page.locator('#badgeLock span');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(name);
  await expect(page.locator('#reticle')).toHaveClass(/locked/);

  // Turned right round, nothing is ahead to lock on to
  await page.evaluate(() => {
    window.__city.ship.yaw += Math.PI;
  });
  await expect.poll(() => page.evaluate(() => window.__city.locked)).toBe(-1);
  await expect(label).toBeHidden();
});

test('on a phone, holding Boost speeds the ship up and letting go slows it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect(page.locator('#boost')).toBeHidden();
  await page.tap('#m-pilot');
  await shipLive(page);
  await expect(page.locator('#boost')).toBeVisible();
  const box = await page.locator('#boost').boundingBox();
  const at = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2, id: 3 };
  const cdp = await context.newCDPSession(page);
  const speed = () => page.evaluate(() => window.__city.ship.speed);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await expect.poll(speed, { timeout: 30_000 }).toBeGreaterThan(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(speed, { timeout: 30_000 }).toBeLessThan(25);
  await context.close();
});

test('boost heats the turbines with a flash, and they cool once it is let go', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  // The metal round the nozzles, whose own light is the heat
  const heat = () =>
    page.evaluate(
      () => window.__city.fighter.children.find((part) => part.material?.name === 'hot')?.material.emissiveIntensity,
    );
  expect(await heat()).toBe(0);
  await page.keyboard.down('ShiftLeft');
  await expect.poll(heat, { timeout: 30_000 }).toBeGreaterThan(1);
  await page.keyboard.up('ShiftLeft');
  // Cooling takes over a second of game time, which is dozens of frames at a slow renderer's 0.05 s step
  await expect.poll(heat, { timeout: 180_000 }).toBeLessThan(0.3);
});

/**
 * How bright each of the next few frames is, from 0 for black to 255 for white. Bloom is held on, because it is what
 * spreads one bad pixel over a whole frame, and a slow renderer would have turned it off.
 */
function frameLevels(page: Page, count: number): Promise<number[]> {
  return page.evaluate(
    (frames) =>
      new Promise<number[]>((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 30;
        const g = canvas.getContext('2d') as CanvasRenderingContext2D;
        const levels: number[] = [];
        // Sampled straight after each render, before the canvas is cleared for the next
        const sample = () => {
          window.__city.bloom.enabled = true;
          g.drawImage(document.getElementById('gl') as HTMLCanvasElement, 0, 0, 48, 30);
          const { data } = g.getImageData(0, 0, 48, 30);
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
          levels.push(sum / ((data.length / 4) * 3));
          if (levels.length < frames) requestAnimationFrame(sample);
          else resolve(levels);
        };
        requestAnimationFrame(sample);
      }),
    count,
  );
}

test('Blocks turns the night to day from Settings, in every frame, and is remembered', async ({ page }) => {
  const faults = watchForFaults(page);
  const shaders: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|program/i.test(m.text())) shaders.push(m.text());
  });
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  // Orbit takes in the sky and the ground, which is where night and day differ most
  await page.click('#m-orbit');
  await expect(page.locator('body')).toHaveAttribute('data-skin', 'night');
  const night = Math.max(...(await frameLevels(page, 3)));
  expect(night).toBeLessThan(100);

  await page.click('#settings');
  await expect(page.locator('#skin-night')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#skin-blocks');
  await expect(page.locator('#skin-blocks')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#skin-night')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).toHaveAttribute('data-skin', 'blocks');
  await page.locator('#settingsPanel .panel-close').click();
  expect(Math.min(...(await frameLevels(page, 3)))).toBeGreaterThan(night + 60);

  // Flying, firing and boosting by day. One pixel gone wrong would turn a whole frame black.
  await page.click('#m-pilot');
  await shipLive(page);
  await page.keyboard.down('Space');
  await page.keyboard.down('ShiftLeft');
  const flying = await frameLevels(page, 10);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('Space');
  expect(Math.min(...flying)).toBeGreaterThan(25);

  await page.reload();
  await cityReady(page);
  await expect(page.locator('body')).toHaveAttribute('data-skin', 'blocks');
  await page.click('#m-orbit');
  expect(Math.min(...(await frameLevels(page, 3)))).toBeGreaterThan(night + 60);

  await page.click('#settings');
  await page.click('#skin-night');
  await expect(page.locator('body')).toHaveAttribute('data-skin', 'night');
  await expect.poll(async () => Math.max(...(await frameLevels(page, 2)))).toBeLessThan(100);
  expect(shaders).toEqual([]);
  expect(faults).toEqual([]);
});

test('every look draws the city, with no shader left broken', async ({ page }) => {
  const faults = watchForFaults(page);
  const shaders: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|program/i.test(m.text())) shaders.push(m.text());
  });
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-orbit');
  await page.click('#settings');
  const looks = page.locator('#looks button');
  await expect(looks).toHaveText(['Night', 'Blocks', 'Poster', 'Vector', '16-bit', 'VGA']);

  const levels: Record<string, number> = {};
  for (const look of ['blocks', 'poster', 'vector', 'console', 'shooter', 'night']) {
    await page.click(`#skin-${look}`);
    await expect(page.locator('body')).toHaveAttribute('data-skin', look);
    await expect(page.locator(`#skin-${look}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#looks button[aria-pressed="true"]')).toHaveCount(1);
    // A shader that failed to compile draws nothing, and a pixel gone wrong turns the frame black
    levels[look] = Math.min(...(await frameLevels(page, 2)));
    expect(levels[look], look).toBeGreaterThan(2);
  }
  // The looks with a sun are bright, and the dark ones are not
  for (const bright of ['blocks', 'poster', 'console']) {
    for (const dark of ['night', 'vector', 'shooter'])
      expect(levels[bright], `${bright} ${dark}`).toBeGreaterThan(levels[dark] + 40);
  }
  expect(shaders).toEqual([]);
  expect(faults).toEqual([]);
});

test('an old screen draws big pixels that are each one flat colour, whatever the size of the view', async ({
  page,
}) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-orbit');
  await page.click('#settings');
  // The second view isn't a whole number of big pixels either way, so the frame it is drawn in overhangs it
  for (const [look, width, height] of [
    ['console', 1440, 900],
    ['shooter', 1001, 613],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.click(`#skin-${look}`);
    await expect(page.locator('body')).toHaveAttribute('data-skin', look);
    const canvas = page.locator('#gl');
    await expect.poll(() => canvas.evaluate((gl: HTMLCanvasElement) => gl.clientWidth)).toBe(width);
    const size = await canvas.evaluate((gl: HTMLCanvasElement) => ({ width: gl.width, height: gl.height }));
    const grid = screenGrid(look, size.width, size.height);
    expect(grid, look).not.toBeNull();
    const seen = await page.evaluate(
      ({ side, cols, rows, left, top }) =>
        new Promise<{ mixed: number; colours: number }>((resolve) => {
          // A frame drawn at the new size, then one read straight after it is drawn
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const gl = document.getElementById('gl') as HTMLCanvasElement;
              const { width: w, height: h } = gl;
              const copy = document.createElement('canvas');
              copy.width = w;
              copy.height = h;
              const g = copy.getContext('2d') as CanvasRenderingContext2D;
              g.drawImage(gl, 0, 0);
              const { data } = g.getImageData(0, 0, w, h);
              const colours = new Set<number>();
              let mixed = 0;
              for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                  const x0 = Math.max(0, c * side - left);
                  const x1 = Math.min(w, (c + 1) * side - left);
                  const y0 = Math.max(0, r * side - top);
                  const y1 = Math.min(h, (r + 1) * side - top);
                  const first = (y0 * w + x0) * 4;
                  let flat = true;
                  for (let y = y0; y < y1 && flat; y++) {
                    for (let x = x0; x < x1 && flat; x++) {
                      const i = (y * w + x) * 4;
                      flat =
                        data[i] === data[first] && data[i + 1] === data[first + 1] && data[i + 2] === data[first + 2];
                    }
                  }
                  if (!flat) mixed++;
                  colours.add((data[first] << 16) | (data[first + 1] << 8) | data[first + 2]);
                }
              }
              resolve({ mixed, colours: colours.size });
            }),
          );
        }),
      grid as Grid,
    );
    // A blurred or misplaced frame has big pixels of more than one colour, and a blank one has a single colour
    expect(seen.mixed, look).toBe(0);
    expect(seen.colours, look).toBeGreaterThan(8);
  }
  expect(faults).toEqual([]);
});

test('a ship picked in Orbit is held up beside Settings with its power named, until the panel closes', async ({
  page,
}) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-orbit');
  await expect.poll(() => page.evaluate(() => window.__city.fighter.visible)).toBe(false);
  await page.click('#settings');
  await expect(page.locator('#shipPower')).toHaveText('Long lock. Locks on to a badge from half as far again.');
  // Opening Settings alone shows no ship, so it doesn't sit over a city someone is choosing a look for
  expect(await page.evaluate(() => window.__city.fighter.visible)).toBe(false);

  await page.click('#ship-rocket');
  await expect(page.locator('#shipPower')).toHaveText('Afterburner. Boosts 30% faster.');
  await expect.poll(() => page.evaluate(() => window.__city.fighter.visible)).toBe(true);
  // Where it is drawn: in front of the camera, in the part of the view the panel leaves free
  const shown = await page.evaluate(
    () =>
      new Promise<{ x: number; y: number; depth: number; panel: number; width: number; height: number }>((resolve) => {
        requestAnimationFrame(() => {
          const { fighter, camera } = window.__city;
          const at = fighter.position.clone().project(camera);
          resolve({
            x: ((at.x + 1) / 2) * innerWidth,
            y: ((1 - at.y) / 2) * innerHeight,
            depth: at.z,
            panel: document.getElementById('settingsPanel')!.getBoundingClientRect().left,
            width: innerWidth,
            height: innerHeight,
          });
        });
      }),
  );
  expect(shown.depth).toBeLessThan(1);
  expect(shown.x).toBeGreaterThan(shown.width * 0.1);
  expect(shown.x).toBeLessThan(shown.panel);
  expect(shown.y).toBeGreaterThan(shown.height * 0.2);
  expect(shown.y).toBeLessThan(shown.height * 0.8);

  await page.locator('#settingsPanel .panel-close').click();
  await expect.poll(() => page.evaluate(() => window.__city.fighter.visible)).toBe(false);
  expect(faults).toEqual([]);
});

test('each ship has a cockpit of its own, and the gunsight is seen through glass in all of them', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -3000);
  await expect(page.locator('#canopy')).toBeVisible();

  const ships = ['interceptor', 'dart', 'rocket', 'saucer', 'brick'];
  await page.click('#settings');
  // All five are picked and read in one step, because each step of a test waits on frames, and frames crawl under
  // software rendering. A cockpit is in place as soon as its ship is picked, before the next frame hides it.
  const seen = await page.evaluate((ships) => {
    const canopy = document.getElementById('canopy')!;
    // The middle of the cockpit's own box, where the gunsight sits, and a corner of it, which is frame in any design
    const middle = new DOMPoint(800, 450);
    const corner = new DOMPoint(8, 8);
    return ships.map((ship) => {
      document.getElementById(`ship-${ship}`)!.click();
      const frame = canopy.querySelector<SVGGeometryElement>('.frame')!;
      const strut = canopy.querySelector<SVGGeometryElement>('.strut');
      return {
        ship: canopy.dataset.ship,
        frame: frame.getAttribute('d') ?? '',
        // A frame that isn't being drawn covers no point at all, so the corner shows the next reading means something
        drawn: frame.isPointInFill(corner),
        covered: frame.isPointInFill(middle) || (strut?.isPointInStroke(middle) ?? false),
        needles: canopy.querySelectorAll('[data-live="speed"]').length,
        lamps: canopy.querySelectorAll('.lamp').length,
      };
    });
  }, ships);
  expect(seen.map((cockpit) => cockpit.ship)).toEqual(ships);
  for (const { ship, drawn, covered, needles, lamps } of seen) {
    expect(drawn, ship).toBe(true);
    expect(covered, ship).toBe(false);
    expect(needles, ship).toBe(1);
    expect(lamps, ship).toBe(2);
  }
  expect(new Set(seen.map((cockpit) => cockpit.frame)).size).toBe(5);

  // The frame steps aside while the ship is held up beside Settings, and is back once the panel has closed
  await expect(page.locator('#canopy')).toBeHidden();
  await page.locator('#settingsPanel .panel-close').click();
  await expect(page.locator('#canopy')).toBeVisible();
  await expect(page.locator('#canopy')).toHaveAttribute('data-ship', 'brick');
  expect(faults).toEqual([]);
});

test('the ship can be swapped for another design, in the same colours, and the choice is remembered', async ({
  page,
}) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const parts = () => page.evaluate(() => window.__city.fighter.children.length);
  const hull = () => page.evaluate(() => window.__city.fighter.children[0].material.color.getHexString());
  const interceptor = await parts();

  await page.click('#settings');
  await expect(page.locator('#ships button')).toHaveText(['Interceptor', 'Dart', 'Rocket', 'Saucer', 'Brick']);
  await expect(page.locator('#ship-interceptor')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Red ship', exact: true }).click();

  const counts = new Set([interceptor]);
  for (const ship of ['dart', 'rocket', 'saucer', 'brick']) {
    await page.click(`#ship-${ship}`);
    await expect(page.locator(`#ship-${ship}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ships button[aria-pressed="true"]')).toHaveCount(1);
    // The fuselage is still first, and still in the colour chosen for the last ship
    expect(await hull(), ship).toBe('c8463c');
    counts.add(await parts());
  }
  // Five designs are not five names for one model
  expect(counts.size).toBeGreaterThan(3);

  await page.reload();
  await cityReady(page);
  await page.click('#settings');
  await expect(page.locator('#ship-brick')).toHaveAttribute('aria-pressed', 'true');
  expect(await hull()).toBe('c8463c');
  // It flies and fires like any other
  await page.locator('#settingsPanel .panel-close').click();
  await page.click('#m-pilot');
  await shipLive(page);
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__city.weapons.activeBolts)).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  expect(faults).toEqual([]);
});

test('at a middling width the header keeps to one row, so the hint sits under it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await context.newPage();
  await stubApi(page, { body: busy('a-really-long-github-username-of-39-cha') });
  await page.goto('/octo-dev');
  await cityReady(page);
  // The hint hides itself nine seconds after it shows, which a slow runner can pass while the city loads. Its place is
  // what's tested, so it is shown here and measured in the same step as the header.
  const { hint, modes, find } = await page.evaluate(() => {
    document.getElementById('hint')!.hidden = false;
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON() as DOMRect;
    return { hint: box('#hint'), modes: box('.modes'), find: box('.find') };
  });
  expect(hint.height).toBeGreaterThan(0);
  expect(Math.abs(modes.y - find.y)).toBeLessThan(12);
  expect(hint.y).toBeGreaterThanOrEqual(modes.y + modes.height - 1);
  expect(modes.x + modes.width).toBeLessThanOrEqual(900);
  await context.close();
});

test('no frame goes black while flying, firing and boosting', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  // A slow renderer turns bloom off, and bloom is what spreads one NaN pixel over the whole frame
  await page.evaluate(() => {
    window.__city.bloom.enabled = true;
  });
  await page.keyboard.down('Space');
  await page.keyboard.down('ShiftLeft');
  const dark = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 30;
        const g = canvas.getContext('2d') as CanvasRenderingContext2D;
        let frames = 0;
        let black = 0;
        // Sampled straight after each render, before the canvas is cleared for the next
        const sample = () => {
          window.__city.bloom.enabled = true;
          g.drawImage(document.getElementById('gl') as HTMLCanvasElement, 0, 0, 48, 30);
          const { data } = g.getImageData(0, 0, 48, 30);
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
          if (sum / (data.length / 4) < 3) black++;
          if (++frames < 12) requestAnimationFrame(sample);
          else resolve(black);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('Space');
  expect(dark).toBe(0);
});

test('an open panel stops the ship, and it flies on when the panel closes', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  await page.click('#settings');
  await expect.poll(() => page.evaluate(() => window.__city.ship.speed), { timeout: 60_000 }).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__city.ship.speed), { timeout: 60_000 }).toBeGreaterThan(5);
});

test('steering at a badge lines up the shot without leaving it', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#badges');
  await page.locator('#badgeList button').first().click();
  await shipLive(page);

  const pose = () => page.evaluate(() => ({ x: window.__city.ship.pos.x, yaw: window.__city.ship.yaw }));
  const before = await pose();
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowLeft');
  const after = await pose();
  expect(after.yaw).toBeGreaterThan(before.yaw);
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.2);
  expect(await page.evaluate(() => window.__city.ship.speed)).toBeLessThan(0.5);
});

test('a shot badge blows up, and a reset brings it back', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#badges');
  await page.locator('#badgeList button').first().click();
  await shipLive(page);
  await expect.poll(() => page.evaluate(() => window.__city.badges.tokens[0].visible)).toBe(true);

  await page.keyboard.down('Space');
  await expect(page.locator('#toast')).toContainText('Badge earned', { timeout: 30_000 });
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__city.blasts.some((blast) => blast.active))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__city.badges.tokens[0].visible)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__city.blasts.some((blast) => blast.active))).toBe(false);

  await page.click('#badges');
  await page.click('#badgeReset');
  await page.click('#badgeReset');
  await expect.poll(() => page.evaluate(() => window.__city.badges.tokens[0].visible)).toBe(true);
});

test('shooting a badge earns it, and it stays earned', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect(page.locator('#badges')).toHaveText(/^Badges 0\/\d+$/);
  await page.click('#badges');
  const rows = page.locator('#badgeList button');
  await rows.first().click();
  await expect.poll(() => page.evaluate(() => window.__city.ship.live), { timeout: 30_000 }).toBe(true);
  await page.mouse.move(720, 450);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast')).toContainText('Badge earned', { timeout: 30_000 });
  await page.keyboard.up('Space');
  await expect(page.locator('#badges')).toHaveText(/^Badges 1\/\d+$/);

  await page.reload();
  await cityReady(page);
  await expect(page.locator('#badges')).toHaveText(/^Badges 1\/\d+$/);
});

test('flying into a badge earns it without a shot, and scatters its gold with no fireball', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#badges');
  await page.locator('#badgeList button').first().click();
  await shipLive(page);
  // The list sets the ship down aimed at the badge, and boost flies it straight on
  await page.keyboard.down('ShiftLeft');
  // The gold is in the air for a second and a bit, so it is read in the frame the badge is won
  const won = await page.waitForFunction(
    () => {
      const { badges, blasts, weapons } = window.__city;
      if (!badges.earned.has(badges.milestones[0].id)) return null;
      return {
        bolts: weapons.activeBolts,
        gold: blasts.some((blast) => blast.active),
        fireball: blasts.some((blast) => blast.exploding),
      };
    },
    null,
    { timeout: 60_000 },
  );
  await page.keyboard.up('ShiftLeft');
  expect(await won.jsonValue()).toEqual({ bolts: 0, gold: true, fireball: false });
  await expect(page.locator('#toast b')).toHaveText(/^Badge earned: /);
  await expect(page.locator('#badges')).toHaveText(/^Badges 1\/\d+$/);
});

test('a badge jumped to from the list is earned, and one flown to is marked as flown', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const rows = page.locator('#badgeList button');
  const tally = page.locator('#badgeFlown');

  await page.click('#badges');
  await rows.nth(0).click();
  await shipLive(page);
  expect(await page.evaluate(() => window.__city.sinceJump)).toBeLessThan(5);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast b')).toHaveText(/^Badge earned: /, { timeout: 30_000 });
  await page.keyboard.up('Space');
  await page.click('#badges');
  await expect(rows.nth(0)).toContainText('✓');
  await expect(rows.nth(0).locator('em')).toHaveCount(0);
  await expect(tally).toBeHidden();

  // Jump to the next to learn where to line up on it, fly well away, and come back to that spot. The ship flies away
  // high over the city, because flying on from where the jump left it would take it into the badge.
  await rows.nth(1).click();
  await shipLive(page);
  const pose = await page.evaluate(() => {
    const { ship } = window.__city;
    const at = { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z, yaw: ship.yaw, pitch: ship.pitch };
    ship.pos.y = 150;
    ship.pitch = 0;
    return at;
  });
  await page.keyboard.down('ShiftLeft');
  await expect.poll(() => page.evaluate(() => window.__city.sinceJump), { timeout: 120_000 }).toBeGreaterThan(125);
  await page.keyboard.up('ShiftLeft');
  await page.evaluate((pose) => {
    const { ship } = window.__city;
    ship.pos.set(pose.x, pose.y, pose.z);
    ship.yaw = pose.yaw;
    ship.pitch = pose.pitch;
    ship.speed = 0;
  }, pose);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast b')).toHaveText(/^Badge earned in flight: /, { timeout: 30_000 });
  await page.keyboard.up('Space');
  await page.click('#badges');
  await expect(rows.nth(1).locator('em')).toHaveText('Flown');
  await expect(tally).toHaveText(/^1 of \d+ flown to\.$/);

  // Flown stays flown, and a reset forgets it with the rest
  await page.reload();
  await cityReady(page);
  await page.click('#badges');
  await expect(rows.nth(1).locator('em')).toHaveText('Flown');
  await page.click('#badgeReset');
  await page.click('#badgeReset');
  await expect(rows.locator('em')).toHaveCount(0);
  await expect(tally).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('contriscape:flown:octo-dev'))).toBeNull();
});

test('on a phone, holding Brake slows the ship and letting go lets it pick up again', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect(page.locator('#brake')).toBeHidden();
  await page.tap('#m-pilot');
  await shipLive(page);
  await expect(page.locator('#brake')).toBeVisible();
  // Clear of the towers, so a bump doesn't do the slowing
  await page.evaluate(() => window.__city.ship.pos.set(-150, 30, 8));
  const speed = () => page.evaluate(() => window.__city.ship.speed);
  await expect.poll(speed, { timeout: 30_000 }).toBeGreaterThan(15);
  const box = await page.locator('#brake').boundingBox();
  const at = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2, id: 4 };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await expect.poll(speed, { timeout: 30_000 }).toBeLessThan(8);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(speed, { timeout: 30_000 }).toBeGreaterThan(14);
  // The three buttons sit clear of one another
  const boxes = await Promise.all(['#fire', '#boost', '#brake'].map((id) => page.locator(id).boundingBox()));
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const [p, q] = [boxes[a], boxes[b]];
      if (!p || !q) throw new Error('a button has no box');
      const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
      expect(apart).toBe(true);
    }
  }
  await context.close();
});

/** Loads a city with every badge earned but the first, then lines up that last one. */
async function lineUpLastBadge(page: Page) {
  await page.goto('/octo-dev');
  await cityReady(page);
  const others = await page.evaluate(() => window.__city.badges.milestones.slice(1).map(({ id }) => id));
  await page.evaluate((ids) => localStorage.setItem('contriscape:badges:octo-dev', JSON.stringify(ids)), others);
  await page.reload();
  await cityReady(page);
  await expect(page.locator('#badges')).not.toHaveClass(/complete/);
  await page.click('#badges');
  await page.locator('#badgeList button').first().click();
  await shipLive(page);
}

test('shooting the last badge sets off fireworks, and only the once', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await lineUpLastBadge(page);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast')).toContainText('City cleared', { timeout: 30_000 });
  await page.keyboard.up('Space');
  await expect(page.locator('#toast')).toContainText('badges earned on octo-dev');
  expect(await page.evaluate(() => window.__city.fireworks.active)).toBe(true);
  await expect(page.locator('#badges')).toHaveClass(/complete/);

  await page.reload();
  await cityReady(page);
  await expect(page.locator('#badges')).toHaveClass(/complete/);
  await expect(page.locator('#toast')).toBeHidden();
  expect(await page.evaluate(() => window.__city.fireworks.active)).toBe(false);
});

test('a reset takes the gold off the Badges button', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await lineUpLastBadge(page);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast')).toContainText('City cleared', { timeout: 30_000 });
  await page.keyboard.up('Space');
  await page.click('#badges');
  await page.click('#badgeReset');
  await page.click('#badgeReset');
  await expect(page.locator('#badges')).not.toHaveClass(/complete/);
});

test('clearing a city under reduced motion says so without the show', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await stubApi(page, { body: busy('octo-dev') });
  await lineUpLastBadge(page);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast')).toContainText('City cleared', { timeout: 30_000 });
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__city.fireworks.active)).toBe(false);
  await context.close();
});

test('a badge picked late in a warp still gets the ship there', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  await pickYear(page, '2025');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const wait = () => {
          if (window.__city.jump?.done) {
            window.__city.visitBadge(0);
            resolve();
          } else {
            requestAnimationFrame(wait);
          }
        };
        wait();
      }),
  );
  await shipLive(page);
});

test('a badge chosen before the towers have risen is approached clear of them', async ({ page }) => {
  // The first contribution falls on a Sunday, and a tall tower stands three rows in front of its badge
  const blocked: Contributions = {
    login: 'blocked',
    name: null,
    snapshot: SNAPSHOT,
    years: { '2025': year(365, (d) => (d === 4 ? 1 : d === 7 ? 100 : 0)) },
  };
  await stubApi(page, { body: blocked });
  await page.goto('/blocked');
  await cityReady(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const wait = () => {
          if (window.__city.play < 4) {
            window.__city.visitBadge(0);
            resolve();
          } else {
            requestAnimationFrame(wait);
          }
        };
        wait();
      }),
  );
  await shipLive(page);
  const { y, tower } = await page.evaluate(() => ({ y: window.__city.ship.pos.y, tower: window.__city.map.top[7] }));
  expect(y).toBeGreaterThan(tower);
  // Badges hovering over the tall tower sit on the line of fire, so this one may not be the first to go
  await page.keyboard.down('Space');
  await expect
    .poll(() => page.evaluate(() => window.__city.badges.earned.has('first-contribution')), { timeout: 60_000 })
    .toBe(true);
  await page.keyboard.up('Space');
});

test('a badge waits to be shot after the timeline has been dragged back', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  await page.evaluate(() => {
    const scrub = document.getElementById('scrub') as HTMLInputElement;
    scrub.value = scrub.min;
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#badges');
  await page.locator('#badgeList button').last().click();
  await expect
    .poll(() => page.evaluate(() => window.__city.badges.tokens.at(-1)?.visible), { timeout: 60_000 })
    .toBe(true);
});

test('the wheel scrolls the badge list and leaves the zoom alone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#badges');
  const zoom = await page.evaluate(() => window.__city.zoom);
  await page.hover('#badgeList li:nth-child(2)');
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => page.evaluate(() => document.getElementById('badgePanel')?.scrollTop ?? 0))
    .toBeGreaterThan(50);
  expect(await page.evaluate(() => window.__city.zoom)).toBe(zoom);
});

test('a finger scrolls the badge list on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.tap('#badges');
  const box = await page.locator('#badgePanel').boundingBox();
  const x = (box?.x ?? 0) + 100;
  const y = (box?.y ?? 0) + (box?.height ?? 0) - 30;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 14; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 14 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(() => page.evaluate(() => document.getElementById('badgePanel')?.scrollTop ?? 0))
    .toBeGreaterThan(50);
  await context.close();
});

test('earned badges can be reset, after a second press, and shot again', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#badges');
  await expect(page.locator('#badgeReset')).toBeHidden();
  await page.locator('#badgeList button').first().click();
  await expect.poll(() => page.evaluate(() => window.__city.ship.live), { timeout: 30_000 }).toBe(true);
  await page.mouse.move(720, 450);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast')).toContainText('Badge earned', { timeout: 30_000 });
  await page.keyboard.up('Space');

  await page.click('#badges');
  await page.click('#badgeReset');
  await expect(page.locator('#badgeReset')).toHaveText('Clear 1?');
  await expect(page.locator('#badges')).toHaveText(/^Badges 1\/\d+$/);
  await page.click('#badgeReset');
  await expect(page.locator('#badges')).toHaveText(/^Badges 0\/\d+$/);
  await expect(page.locator('#badgeReset')).toBeHidden();

  await page.reload();
  await cityReady(page);
  await expect(page.locator('#badges')).toHaveText(/^Badges 0\/\d+$/);
  await page.click('#badges');
  await page.locator('#badgeList button').first().click();
  await expect.poll(() => page.evaluate(() => window.__city.ship.live), { timeout: 30_000 }).toBe(true);
  await page.mouse.move(720, 450);
  await page.keyboard.down('Space');
  await expect(page.locator('#toast')).toContainText('Badge earned', { timeout: 30_000 });
  await page.keyboard.up('Space');
});

test('closing the list stands down an unconfirmed badge reset', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('contriscape:badges:octo-dev', '["first-contribution"]'));
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#badges');
  await page.click('#badgeReset');
  await expect(page.locator('#badgeReset')).toHaveText('Clear 1?');
  await page.click('#badgePanel .panel-close');
  await page.click('#badges');
  await expect(page.locator('#badgeReset')).toHaveText('Reset');
  await expect(page.locator('#badges')).toHaveText(/^Badges 1\/\d+$/);
});

test('colours can be changed, are remembered, and go back to the default', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--g4').trim());
  const topStop = () => page.evaluate(() => window.__city.shared.uRamp.value[3].b);
  const hull = () => page.evaluate(() => window.__city.fighter.children[0].material.color.getHexString());
  const green = await topStop();
  expect(await hull()).toBe('9aa5b2');

  await page.click('#settings');
  await page.getByRole('button', { name: 'Blue buildings' }).click();
  await expect.poll(topStop).toBeGreaterThan(green);
  expect(await accent()).not.toBe('#39d353');
  await expect(page.getByRole('button', { name: 'Blue buildings' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Red ship', exact: true }).click();
  expect(await hull()).toBe('c8463c');
  await page.getByLabel('Custom ship trim colour').fill('#123456');
  await expect(page.getByRole('button', { name: 'Amber ship trim' })).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await cityReady(page);
  expect(await topStop()).toBeGreaterThan(green);
  expect(await hull()).toBe('c8463c');
  await page.click('#settings');
  await expect(page.getByLabel('Custom ship trim colour')).toHaveValue('#123456');

  await page.click('#colourReset');
  expect(await topStop()).toBe(green);
  expect(await hull()).toBe('9aa5b2');
  await expect(page.getByRole('button', { name: 'Green buildings' })).toHaveAttribute('aria-pressed', 'true');
  expect(faults).toEqual([]);
});

test('the guide explains the controls and the badges, and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#badges');
  await page.click('#guide');
  await expect(page.locator('#badgePanel')).toBeHidden();
  await expect(page.locator('#guidePanel')).toContainText('Shift');
  await expect(page.locator('#guidePanel')).toContainText('no API');
  await page.hover('#guidePanel p');
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => page.evaluate(() => document.getElementById('guidePanel')?.scrollTop ?? 0))
    .toBeGreaterThan(50);
  await page.keyboard.press('Escape');
  await expect(page.locator('#guidePanel')).toBeHidden();
  await expect(page.locator('#guide')).toHaveAttribute('aria-expanded', 'false');
});

test('each panel closes from its own button', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  for (const [button, panel] of [
    ['#explore', '#explorePanel'],
    ['#badges', '#badgePanel'],
    ['#year', '#yearPanel'],
    ['#race', '#racePanel'],
    ['#settings', '#settingsPanel'],
    ['#guide', '#guidePanel'],
  ]) {
    await page.click(button);
    await expect(page.locator(panel)).toBeVisible();
    await page.locator(`${panel} .panel-close`).click();
    await expect(page.locator(panel)).toBeHidden();
  }
});

test.describe('your year on GitHub', () => {
  test('stays hidden before mid November', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T12:00:00Z'));
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/octo-dev');
    await cityReady(page);
    await expect(page.locator('#review')).toBeHidden();
  });

  test('appears from mid November and tells the story of the year', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-20T12:00:00Z'));
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/octo-dev');
    await cityReady(page);
    await expect(page.locator('#review')).toHaveText('Your 2026 on GitHub');
    await page.click('#review');
    // It opens on the year's number, over its block with nothing built yet
    await expect(page.locator('#opener')).toBeVisible();
    await expect(page.locator('#openerYear')).toHaveText('2026');
    await expect(page.locator('#openerName')).toHaveText('octo-dev');
    await expect(page.locator('#scopeLabel')).toContainText('2026');
    expect(await page.evaluate(() => window.__city.play)).toBeLessThan(
      await page.evaluate(() => window.__city.cal.span(2026).a + 1),
    );

    // The flight ends in fireworks, and the year's cards follow them
    await page.evaluate(() => window.__city.endFlight());
    await expect(page.locator('#opener')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__city.fireworks.active)).toBe(true);
    await expect(page.locator('#story')).toBeVisible();
    await expect(page.locator('#storyCard')).toHaveAttribute('aria-label', /./);
    // Stepped through in one go, because the cards also turn by themselves
    const said = await page.evaluate(() => {
      const card = document.getElementById('storyCard') as HTMLElement;
      const press = (id: string) => (document.getElementById(id) as HTMLElement).click();
      for (let n = 0; n < 12; n++) press('storyBack');
      const seen = [card.getAttribute('aria-label') ?? ''];
      for (let n = 0; n < 12; n++) {
        press('storyNext');
        seen.push(card.getAttribute('aria-label') ?? '');
      }
      return [...new Set(seen)];
    });
    expect(said[0]).toBe('octo-dev: 2026. Your year on GitHub, so far.');
    expect(said[1]).toMatch(/^Contributions: [\d,]+, (Up|Down) [\d,]+% on 2025\.$/);
    for (const kicker of ['Active days', 'Longest streak', 'Busiest day', 'Biggest month', 'Your style']) {
      expect(
        said.some((text) => text.startsWith(`${kicker}: `)),
        kicker,
      ).toBe(true);
    }
    expect(said[said.length - 1]).toMatch(/^octo-dev: 2026\. [\d,]+ contributions\.$/);
    await page.click('#storyAgain');
    await expect(page.locator('#story')).toBeHidden();
    await expect(page.locator('#opener')).toBeVisible();
    await page.click('#m-orbit');
    await expect(page.locator('#opener')).toBeHidden();
  });

  test('keeps the link that opened it in the address bar', async ({ page }) => {
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/Octo-Dev#your-year');
    await cityReady(page);
    await expect(page).toHaveURL(/\/octo-dev#your-year$/);
  });

  test('can be opened from a link at any time of year', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-05T12:00:00Z'));
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/octo-dev#your-year');
    await cityReady(page);
    await expect(page.locator('#openerYear')).toHaveText('2026');
  });

  test('stays away from a year with no contributions', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-05T12:00:00Z'));
    await stubApi(page, { body: empty });
    await page.goto('/newcomer');
    await cityReady(page);
    await expect(page.locator('#review')).toBeHidden();
  });

  test('a link to a year outside the history opens the city', async ({ page }) => {
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/octo-dev/2001');
    await cityReady(page);
    await expect(page.locator('#opener')).toBeHidden();
  });

  test('early January loads a history that starts in the new year', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2027-01-05T12:00:00Z'));
    await stubApi(page, { body: { ...empty, years: { '2027': year(5, () => 2) } } });
    await page.goto('/newcomer');
    await cityReady(page);
    await expect(page.locator('#review')).toBeHidden();
  });
});

/**
 * Flies a race's gates for the test: after each of the game's frames, puts the ship just short of the next gate and
 * aims it through, so the following frame carries it across. Runs until the race is over.
 */
async function flyGates(page: Page) {
  await page.evaluate(() => {
    const drive = () => {
      const { race, ship } = window.__city;
      if (!race || race.phase === 'finished') return;
      requestAnimationFrame(drive);
      if (race.phase !== 'racing') return;
      const { at, normal: n } = race.course.gates[race.next];
      ship.pos.set(at.x - n.x * 0.1, at.y - n.y * 0.1, at.z - n.z * 0.1);
      ship.yaw = Math.atan2(-n.x, -n.z);
      ship.pitch = Math.asin(n.y);
      ship.speed = Math.max(ship.speed, 17);
    };
    requestAnimationFrame(drive);
  });
}

test('a race counts down, is flown through its gates in turn, and keeps the best time for the ship', async ({
  page,
  context,
}) => {
  const faults = watchForFaults(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#race');
  await expect(page.locator('#raceList button b')).toHaveText(['2026', '2025', '2024']);
  await expect(page.locator('#raceList button').first()).toContainText(/Rival 0:\d\d\.\d/);
  await page.locator('#raceList button[data-year="2025"]').click();

  await expect(page.locator('#countdown b')).toHaveText(/^[123]$/, { timeout: 60_000 });
  await expect(page.locator('#raceGate')).toHaveText(/^2025 · Gate 1 of \d+$/);
  await expect.poll(() => page.evaluate(() => window.__city.rival.visible)).toBe(true);
  // The ship waits on the line until the start
  expect(await page.evaluate(() => window.__city.ship.speed)).toBeLessThan(1);

  await flyGates(page);
  // A frame moves the game on 0.05 s at most, so the countdown alone is 60 frames, a minute at CI's frame rate
  await expect(page.locator('#raceResult')).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('#raceResultTitle')).toHaveText(/^You beat the rival by \d+\.\d s$/);
  await expect(page.locator('#raceResultFacts')).toContainText('Interceptor');
  await expect(page.locator('#raceHud')).toBeHidden();
  expect(await page.evaluate(() => window.__city.rival.visible)).toBe(false);

  await page.click('#raceCopy');
  await expect(page.locator('#raceCopy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /\/octo-dev#race=2025&beat=\d+\.\d&ship=interceptor$/,
  );
  await page.click('#raceResultClose');
  await page.click('#race');
  const row = page.locator('#raceList button[data-year="2025"]');
  await expect(row).toContainText('Beaten');
  await expect(row).toContainText(/Best 0:\d\d\.\d/);
  expect(faults).toEqual([]);
});

test('a challenge link opens with the time to beat, which the race shows', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev#race=2024&beat=12.3&ship=rocket');
  await cityReady(page);
  await expect(page.locator('#challengeText')).toHaveText('A challenge: fly 2024 in under 0:12.3, set in the Rocket.');
  await page.click('#challengeGo');
  await expect(page.locator('#raceTarget')).toHaveText('To beat 0:12.3', { timeout: 30_000 });
  expect(await page.evaluate(() => window.__city.race?.course.year)).toBe(2024);
  // Any other way of flying calls the race off
  await page.click('#m-orbit');
  await expect(page.locator('#raceHud')).toBeHidden();
  expect(await page.evaluate(() => window.__city.race)).toBeNull();
});

test('a time attack counts down, is flown through its rings, and keeps the time to spare for the ship', async ({
  page,
}) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#race');
  await page.click('#raceKindClock');
  await expect(page.locator('#raceKindClock')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#raceAbout')).toContainText('Each ring adds time');
  await expect(page.locator('#raceList button').first()).toHaveText(/^2026\d+ rings$/);
  await page.locator('#raceList button[data-year="2025"]').click();

  await expect(page.locator('#raceGate')).toHaveText(/^2025 · Ring 1 of \d+$/, { timeout: 30_000 });
  await expect(page.locator('#countdown span')).toHaveText('Each ring adds time. Keep the clock from running out');
  expect(await page.evaluate(() => window.__city.rival.visible)).toBe(false);
  await flyGates(page);
  await expect(page.locator('#raceResult')).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('#raceResultTitle')).toHaveText(/^Finished with 0:\d\d\.\d to spare$/);
  await expect(page.locator('#raceResultFacts')).toContainText('Interceptor');
  // A challenge link sets a race against the rival, so a time attack has none to copy
  await expect(page.locator('#raceCopy')).toBeHidden();
  await page.click('#raceResultClose');
  await page.click('#race');
  await expect(page.locator('#raceKindClock')).toHaveAttribute('aria-pressed', 'true');
  const row = page.locator('#raceList button[data-year="2025"]');
  await expect(row).toContainText('Finished');
  await expect(row).toContainText(/Best 0:\d\d\.\d to spare/);
  // The rival's list is as it was
  await page.click('#raceKindRival');
  await expect(row).toContainText(/^2025Rival 0:\d\d\.\d$/);
  expect(faults).toEqual([]);
});

test('a time attack ends when its clock runs out, and Race again starts another', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.evaluate(() => window.__city.startAttack(2024));
  await expect
    .poll(() => page.evaluate(() => window.__city.race?.phase), { timeout: 200_000, intervals: [500] })
    .toBe('racing');
  // Nearly out of time, and nowhere near the first ring
  await page.evaluate(() => {
    const { race } = window.__city;
    if (race) race.left = 0.2;
  });
  await expect(page.locator('#raceResultTitle')).toHaveText(/^Out of time at ring 1 of \d+$/, { timeout: 60_000 });
  await expect(page.locator('#raceResultFacts')).toContainText(/Rings0 of \d+/);
  await page.click('#raceAgain');
  await expect(page.locator('#raceGate')).toHaveText(/^2024 · Ring 1 of \d+$/, { timeout: 30_000 });
  await expect(page.locator('#raceResult')).toBeHidden();
});

test("the day's course is in Explore, and opens on a year of that city's", async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-20T12:00:00Z'));
  await stubExplore(page);
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#explore');
  const link = page.locator('#daily a');
  await expect(link).toHaveAttribute('href', /^\/(octo-dev|ada-l)#daily=2026-11-20$/);
  await link.click();
  await cityReady(page);
  await expect(page.locator('#challengeText')).toHaveText(
    /^Today's course: 202[456]\. Everyone who opens today's course gets this one\.$/,
  );
  await page.click('#race');
  await expect(page.locator('#raceList em.tag')).toHaveText(["Today's course"]);
});

test('the site root goes back to the city opened last, and to the example if that account has gone', async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route('**/api/contributions/*', (route) => {
    const login = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    asked.push(login);
    return login === 'gone-user'
      ? route.fulfill({ status: 404, json: { error: 'not-found' } })
      : route.fulfill({ json: busy(login) });
  });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.goto('/');
  await cityReady(page);
  expect(asked).toEqual(['octo-dev', 'octo-dev']);
  await expect(page).toHaveURL(/\/octo-dev$/);
  await expect(page.locator('#login')).toHaveText('octo-dev');
  await expect(page.locator('#hint')).not.toContainText('Example city');

  await page.evaluate(() =>
    localStorage.setItem(
      'contriscape:passport',
      JSON.stringify([
        { login: 'gone-user', name: null, first: '2026-11-01', last: '2026-11-01', cleared: false, raced: [], won: [] },
      ]),
    ),
  );
  asked.length = 0;
  await page.goto('/');
  await cityReady(page);
  expect(asked).toEqual(['gone-user', 'torvalds']);
  await expect(page.locator('#login')).toHaveText('torvalds');
  const kept = await page.evaluate(() => localStorage.getItem('contriscape:passport') ?? '');
  expect(kept).not.toContain('gone-user');
});

test("a link to a year opens on that year's flight in the year's own edition, and gives back the visitor's look", async ({
  page,
  context,
}) => {
  const faults = watchForFaults(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => localStorage.setItem('contriscape:skin', 'blocks'));
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/Octo-Dev/2025');
  await cityReady(page);
  await expect(page).toHaveURL(/\/octo-dev\/2025$/);
  await expect(page.locator('#openerYear')).toHaveText('2025');
  // The year's own look is the night, whatever the visitor picked, with the year's own ship
  await expect(page.locator('body')).toHaveAttribute('data-skin', 'night');
  await expect(page.locator('#skin-blocks')).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => window.__city.endFlight());
  await expect(page.locator('#story')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-skin', 'night');
  await page.click('#storyCopy');
  await expect(page.locator('#storyCopy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/octo-dev\/2025$/);
  await page.click('#storyClose');
  await expect(page.locator('body')).toHaveAttribute('data-skin', 'blocks');
  expect(faults).toEqual([]);
});

test("a card of the year saves as a picture the size of a phone's story, and Esc puts the story away", async ({
  page,
}) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev#your-year');
  await cityReady(page);
  await page.evaluate(() => window.__city.endFlight());
  await expect(page.locator('#storyCard')).toHaveAttribute('aria-label', /./);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#storySave')]);
  expect(download.suggestedFilename()).toMatch(/^contriscape-octo-dev-2026-\d\d-[a-z]+\.png$/);
  const png = readFileSync(await download.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  // The width and height, from the image's header
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#story')).toBeHidden();
  expect(faults).toEqual([]);
});

test("the year's cards turn by themselves, and a press held on one stops them until it lets go", async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev#your-year');
  await cityReady(page);
  await page.evaluate(() => window.__city.endFlight());
  const card = page.locator('#storyCard');
  await expect(card).toHaveAttribute('aria-label', /^Contributions: /, { timeout: 30_000 });
  const box = await page.locator('#storyFrame').boundingBox();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.down();
  // Longer than a card stays
  await page.waitForTimeout(8_000);
  await expect(card).toHaveAttribute('aria-label', /^Contributions: /);
  // Letting go of a long press doesn't also turn the card, and the clock picks up where it stopped
  await page.mouse.up();
  await expect(card).toHaveAttribute('aria-label', /^Contributions: /);
  await expect(card).toHaveAttribute('aria-label', /^Active days: /, { timeout: 30_000 });
});

test("someone watching another person's year flies their own, the same year, from its cards", async ({ page }) => {
  await stubExplore(page);
  await page.goto('/octo-dev/2025');
  await cityReady(page);
  await page.evaluate(() => window.__city.endFlight());
  await expect(page.locator('#story')).toBeVisible();
  await expect(page.locator('#storyOwnLabel')).toHaveText('Fly your own 2025');
  // Something that can't be a username goes nowhere
  await page.fill('#storyOwnLogin', 'not a name');
  await page.click('#storyOwn button');
  await expect(page.locator('#story')).toBeVisible();
  await expect(page).toHaveURL(/\/octo-dev\/2025$/);
  await page.fill('#storyOwnLogin', '@ada-l');
  await page.press('#storyOwnLogin', 'Enter');
  await expect(page).toHaveURL(/\/ada-l\/2025$/);
  await cityReady(page);
  await expect(page.locator('#openerYear')).toHaveText('2025');
  await expect(page.locator('#openerName')).toHaveText('ada-l');
});

test('a year in the address that is not a year is refused, without asking for the city', async ({ page }) => {
  let asked = false;
  await page.route('**/api/contributions/*', (route) => {
    asked = true;
    return route.fulfill({ json: busy('octo-dev') });
  });
  await page.goto('/octo-dev/twenty');
  await expect(page.locator('#status')).toContainText("isn't a valid GitHub username");
  expect(asked).toBe(false);
});

test('Explore marks the cities flown here, and lists them', async ({ page }) => {
  await stubExplore(page);
  await page.goto('/ada-l');
  await cityReady(page);
  await page.click('#explore');
  await page.click('#exploreGroups button:has-text("Statistics")');
  await expect(page.locator('#explorePeople a[href="/ada-l"] em')).toHaveText('Flown');
  await expect(page.locator('#explorePeople a[href="/octo-dev"] em')).toHaveCount(0);
  await page.click('#exploreGroups button:has-text("Flown here")');
  await expect(page.locator('#explorePeople a')).toHaveCount(1);
  await expect(page.locator('#explorePeople a')).toContainText('Flown.');
});

test('a double tap rolls the ship one alley across, and up with a direction flies it on its side', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#m-pilot');
  await shipLive(page);
  // High over the towers and heading east, so the ship's right is south
  const level = () =>
    page.evaluate(() => {
      const { ship } = window.__city;
      ship.pos.y = 60;
      ship.pitch = 0;
      ship.yaw = -Math.PI / 2;
      return ship.pos.z;
    });
  const z = await level();
  // Sent from the page, because under software rendering each press the test makes waits on a frame, which puts two
  // quick presses half a second apart
  await page.evaluate(() => {
    for (let n = 0; n < 2; n++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }));
    }
  });
  await expect.poll(() => page.evaluate(() => window.__city.roll?.side ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__city.roll), { timeout: 30_000 }).toBeNull();
  const across = (await page.evaluate(() => window.__city.ship.pos.z)) - z;
  expect(across).toBeGreaterThan(2);
  expect(across).toBeLessThan(3);

  await level();
  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => window.__city.onEdge)).toBe(true);
  // On its left side, the nose neither rising nor falling
  const pitch = await page.evaluate(() => window.__city.ship.pitch);
  await expect.poll(() => page.evaluate(() => window.__city.ship.bank), { timeout: 30_000 }).toBeGreaterThan(1.4);
  expect(await page.evaluate(() => window.__city.ship.pitch)).toBeCloseTo(pitch, 6);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  await expect.poll(() => page.evaluate(() => window.__city.onEdge)).toBe(false);
});

test('respects reduced motion by starting still, in Orbit', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await expect(page.locator('#m-orbit')).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test('the tool buttons all fit the narrowest phone in December, in Pilot', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-12-05T12:00:00Z'));
  await stubApi(page, { body: busy('octo-dev') });
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.tap('#m-pilot');
  for (const id of ['#review', '#year', '#race', '#badges', '#settings', '#guide']) {
    const box = await page.locator(id).boundingBox();
    expect(box?.x, id).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0), id).toBeLessThanOrEqual(320);
  }
  await context.close();
});

test('fits a phone without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await stubApi(page, { body: busy('a-really-long-github-username-of-39-cha') });
  await page.goto('/octo-dev');
  await cityReady(page);
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  await expect(page.locator('#loginInput')).toBeVisible();

  // Under 16px, phones zoom the page when the box takes focus
  const size = await page.locator('#loginInput').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);

  // The hint hides itself 9 seconds after the city loads, which slow CI can reach, so it is measured first
  const hint = await page.locator('#hint').boundingBox();
  const lookup = await page.locator('#lookup').boundingBox();
  expect(hint?.y).toBeGreaterThanOrEqual((lookup?.y ?? 0) + (lookup?.height ?? 0));

  // A held finger would select text and open the copy menu mid-game, so only the username box and the Guide allow it
  const selection = (id: string) =>
    page
      .locator(id)
      .first()
      .evaluate((e) => getComputedStyle(e).userSelect);
  expect(await selection('#fire')).toBe('none');
  expect(await selection('#date')).toBe('none');
  expect(await selection('#loginInput')).not.toBe('none');
  expect(await selection('#guidePanel p')).not.toBe('none');
  await context.close();
});
