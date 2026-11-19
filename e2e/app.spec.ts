import { expect, test, type Page } from '@playwright/test';
import type { Contributions } from '../shared/contract';

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
  ship: {
    live: boolean;
    speed: number;
    yaw: number;
    pitch: number;
    pos: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
  };
  camera: { matrixWorld: { elements: number[] } };
  weapons: { activeBolts: number };
  badges: { tokens: { visible: boolean }[]; milestones: { id: string; name: string }[]; earned: Set<string> };
  blasts: { active: boolean }[];
  fireworks: { active: boolean };
  fighter: { visible: boolean; children: { material: { color: { getHexString(): string } } }[] };
  shared: { uRamp: { value: { b: number }[] } };
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
      blurb: 'The people who own the most-starred repos on GitHub.',
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

test('Explore lists other cities, and one picked there opens saying whose it is', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubExplore(page);
  await page.goto('/octo-dev');
  await cityReady(page);
  await page.click('#explore');
  await expect(page.locator('#explorePanel')).toBeVisible();
  await expect(page.locator('#exploreGroups button')).toHaveText(['Statistics', 'Most-starred repos']);
  await expect(page.locator('#exploreNote')).toContainText('2 Nov 2026');
  await expect(page.locator('#about')).toBeHidden();
  await expect(page.locator('#explorePeople a[aria-current]')).toContainText('Octo Dev');

  await page.locator('#exploreGroups button', { hasText: 'Most-starred' }).click();
  await expect(page.locator('#explorePeople a')).toHaveCount(1);
  await expect(page.locator('#explorePeople a')).toContainText('engine, 250,000 stars. An engine');
  await page.locator('#explorePeople a').click();
  await expect(page).toHaveURL(/\/ada-l$/);
  await cityReady(page);

  const arrival = page.locator('#arrival');
  await expect(arrival).toBeVisible();
  await expect(page.locator('#arrivalFrom')).toHaveText('Most-starred repos');
  await expect(page.locator('#arrivalName')).toHaveText('Ada L');
  await expect(page.locator('#arrivalBio')).toHaveText('Statistician. Writes R.');

  await page.click('#arrivalMore');
  await expect(arrival).toBeHidden();
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

  // Jump to the next to learn where to line up on it, fly well away, and come back to that spot
  await rows.nth(1).click();
  await shipLive(page);
  const pose = await page.evaluate(() => {
    const { ship } = window.__city;
    return { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z, yaw: ship.yaw, pitch: ship.pitch };
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
  test('stays hidden outside December', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-20T12:00:00Z'));
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/octo-dev');
    await cityReady(page);
    await expect(page.locator('#review')).toBeHidden();
  });

  test('appears in December and tells the story of the year', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-05T12:00:00Z'));
    await stubApi(page, { body: busy('octo-dev') });
    await page.goto('/octo-dev');
    await cityReady(page);
    await expect(page.locator('#review')).toHaveText('Your 2026 on GitHub');
    await page.click('#review');
    await expect(page.locator('#caption')).toContainText('Your 2026 on GitHub', { timeout: 30_000 });
    await expect(page.locator('#scopeLabel')).toContainText('2026');

    await page.evaluate(() => window.__city.endFlight());
    await expect(page.locator('#summary')).toBeVisible();
    await expect(page.locator('#summaryFacts')).toContainText('Contributions');
    await expect(page.locator('#summaryFacts')).toContainText('On 2025');
    await page.click('#summaryClose');
    await expect(page.locator('#summary')).toBeHidden();
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
    await expect(page.locator('#caption')).toContainText('Your 2026 on GitHub', { timeout: 30_000 });
  });

  test('stays away from a year with no contributions', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-05T12:00:00Z'));
    await stubApi(page, { body: empty });
    await page.goto('/newcomer');
    await cityReady(page);
    await expect(page.locator('#review')).toBeHidden();
  });
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
  for (const id of ['#review', '#year', '#badges', '#settings', '#guide']) {
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
