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
  ship: { live: boolean; speed: number; yaw: number; pos: { x: number } };
  weapons: { activeBolts: number };
}
declare global {
  interface Window {
    __city: CityDebug;
  }
}

async function stubApi(page: Page, reply: { status?: number; body: unknown; headers?: Record<string, string> }) {
  await page.route('**/api/contributions/*', (route) =>
    route.fulfill({ status: reply.status ?? 200, json: reply.body, headers: reply.headers }),
  );
}

const cityReady = (page: Page) => expect(page.locator('body')).not.toHaveClass(/empty/, { timeout: 20_000 });

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

test('asks the API for the lower-case login, so each user has one cached copy', async ({ page }) => {
  await stubApi(page, { body: busy('octo-dev') });
  const request = page.waitForRequest('**/api/contributions/*');
  await page.goto('/Octo-Dev');
  expect((await request).url()).toMatch(/\/api\/contributions\/octo-dev$/);
});

test('shows the default city at the root', async ({ page }) => {
  await stubApi(page, { body: busy('ces0491') });
  await page.goto('/');
  await cityReady(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#login')).toHaveText('ces0491');
});

test('the username box takes you to that city', async ({ page }) => {
  await stubApi(page, { body: busy('ces0491') });
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

test('rejects a bad name typed into the box', async ({ page }) => {
  await stubApi(page, { body: busy('ces0491') });
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

test('flies an account with no contributions', async ({ page }) => {
  const faults = watchForFaults(page);
  await stubApi(page, { body: empty });
  await page.goto('/newcomer');
  await cityReady(page);
  await expect(page.locator('#note')).toContainText('No public contributions yet');
  await page.click('#years button[data-key="2026"]');
  await page.waitForTimeout(600);
  await page.click('#m-orbit');
  await expect(page.locator('#busiest')).toHaveText('None');
  expect(faults).toEqual([]);
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
  expect(await page.evaluate(() => window.__city.ship.speed)).toBeLessThan(20);
  await expect(page.locator('#loginInput')).toHaveValue(/^w+$/);
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

test('the wheel scrolls the year buttons when a long history overflows them', async ({ page }) => {
  const years = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(2007 + i), year(10, () => 1)]));
  await stubApi(page, { body: { ...busy('veteran'), years } });
  await page.goto('/veteran');
  await cityReady(page);
  await page.hover('#years button:nth-child(3)');
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => document.getElementById('years')?.scrollLeft)).toBeGreaterThan(100);
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

  const hint = await page.locator('#hint').boundingBox();
  const lookup = await page.locator('#lookup').boundingBox();
  expect(hint?.y).toBeGreaterThanOrEqual((lookup?.y ?? 0) + (lookup?.height ?? 0));
  await context.close();
});
