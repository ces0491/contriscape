import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Contributions } from '../shared/contract';
import { Calendar } from '../src/calendar';
import { CELL, CityMap, DEPTH, TOWER } from '../src/map';
import { buildRoute, lengthAtDay, newPose, poseAt, RISE, type Route } from '../src/routes';

const SNAPSHOT = '2026-11-02';
const SHIP_HALF_SPAN = 0.42;
const MAX_FLIGHT_SECONDS = 90;

const daysIn = (y: number) => Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 864e5);
const dayOfYear = (date: string) => Math.round((Date.parse(date) - Date.UTC(Number(date.slice(0, 4)), 0, 1)) / 864e5);

/** Deterministic pseudo-random, so a failure here reproduces. */
const noise = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

function history(first: number, day: (year: number, dayOfYear: number) => number): Contributions {
  const years: Contributions['years'] = {};
  for (let y = first; y <= 2026; y++) {
    const length = y === 2026 ? dayOfYear(SNAPSHOT) + 1 : daysIn(y);
    years[String(y)] = Array.from({ length }, (_, d) => day(y, d));
  }
  return { login: 'fixture', name: null, snapshot: SNAPSHOT, years };
}

const dense = (seed: number) => {
  const r = noise(seed);
  return () => Math.floor(r() * r() * 60);
};

const FIXTURES: Record<string, Contributions> = {
  'no contributions at all': history(2020, () => 0),
  'one contribution ever': history(2023, (y, d) => (y === 2024 && d === 100 ? 1 : 0)),
  'joined this year': history(2026, dense(1)),
  'joined on the last day of a year': {
    login: 'fixture',
    name: null,
    snapshot: '2026-01-01',
    years: { '2025': [], '2026': [4] },
  },
  'quiet for years, then busy': history(2019, (y, d) => (y >= 2025 && d % 3 ? 9 : 0)),
  'busy, then gone silent': history(2012, (y, d) => (y <= 2016 ? (d * 7) % 40 : 0)),
  'busy years with a gap between': history(2016, (y, d) => ([2018, 2019, 2024, 2026].includes(y) ? (d % 5) * 6 : 0)),
  'every day extremely busy': history(2014, dense(2)),
  'one enormous spike': history(2022, (y, d) => (y === 2025 && d === 200 ? 5000 : d % 9 ? 2 : 0)),
  'long history, 18 years': history(2009, dense(3)),
};

/** Shortest 3D gap from a point to any tower box nearby. */
function clearance(map: CityMap, p: Vector3): number {
  let min = Infinity;
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      const i = map.cellIndex(p.x + a * CELL, p.z + b * CELL);
      if (i < 0 || !map.cal.counts[i]) continue;
      const dx = Math.max(0, Math.abs(p.x - map.cx[i]) - TOWER / 2);
      const dz = Math.max(0, Math.abs(p.z - map.cz[i]) - TOWER / 2);
      const dy = Math.max(0, p.y - map.top[i]);
      min = Math.min(min, Math.hypot(dx, dz, dy));
    }
  }
  return min;
}

const seconds = (route: Route) =>
  route.samples.reduce((t, s, i, S) => (i ? t + (s.len - S[i - 1].len) / Math.max(1, s.pace) : 0), 0);

describe.each(Object.entries(FIXTURES))('%s', (_, data) => {
  const cal = new Calendar(data);
  const map = new CityMap(cal);
  const centre = new Vector3(0, 4, map.depth / 2);
  const scopes: ('all' | number)[] = ['all', ...cal.years];

  it.each(scopes)('flies the %s route without touching a tower', (scope) => {
    const route = buildRoute(map, scope, centre);
    expect(route.len).toBeGreaterThan(0);
    for (const s of route.samples) {
      expect(Number.isFinite(s.p.x + s.p.y + s.p.z + s.roll)).toBe(true);
      expect(s.p.y).toBeGreaterThan(0.5);
      expect(clearance(map, s.p)).toBeGreaterThan(SHIP_HALF_SPAN);
    }
  });

  it.each(scopes)('moves forward through time on the %s route', (scope) => {
    const { samples } = buildRoute(map, scope, centre);
    samples.forEach((s, i) => {
      if (i) expect(s.day).toBeGreaterThanOrEqual(samples[i - 1].day - 1e-6);
    });
    const span = scope === 'all' ? { a: 0, b: cal.days - 1 } : cal.span(scope);
    expect(samples.at(-1)?.day).toBeGreaterThanOrEqual(span.b);
  });

  it.each(scopes)('keeps the %s route to a watchable length', (scope) => {
    expect(seconds(buildRoute(map, scope, centre))).toBeLessThan(MAX_FLIGHT_SECONDS);
  });
});

describe('alley flying', () => {
  it('spends real time down among tall towers in a busy year', () => {
    const cal = new Calendar(FIXTURES['every day extremely busy']);
    const map = new CityMap(cal);
    const { samples } = buildRoute(map, 2024, new Vector3());
    const among = samples.filter((s) => {
      let walls = 0;
      map.towersNear(s.p.x, s.p.z, 1.4, (i) => {
        if (map.top[i] > s.p.y) walls++;
      });
      return walls >= 2;
    });
    expect(among.length / samples.length).toBeGreaterThan(0.1);
  });
});

describe('Calendar', () => {
  it('pads a missing year so dates stay aligned', () => {
    const cal = new Calendar({
      login: 'x',
      name: null,
      snapshot: '2026-01-02',
      years: { '2024': [1], '2026': [2, 3] },
    });
    expect(cal.years).toEqual([2024, 2025, 2026]);
    expect(cal.span(2026).a).toBe(366 + 365);
    expect(cal.formatDate(cal.span(2026).a)).toBe('Thu 1 Jan 2026');
    expect(cal.total).toBe(6);
  });

  it('places days on the same grid as the GitHub graph', () => {
    const cal = new Calendar({ login: 'x', name: null, snapshot: '2026-12-31', years: { '2026': Array(365).fill(0) } });
    expect(cal.cellOf(0)).toEqual({ year: 2026, week: 0, row: 4 });
    expect(cal.cellOf(3)).toEqual({ year: 2026, week: 1, row: 0 });
  });

  it('survives a user with no data', () => {
    const cal = new Calendar({ login: 'x', name: null, snapshot: '2026-06-01', years: {} });
    expect(cal.years).toEqual([2026]);
    expect(cal.total).toBe(0);
    expect(cal.busiestIn(2026)).toBe(-1);
  });
});

describe('CityMap', () => {
  const cal = new Calendar(FIXTURES['every day extremely busy']);
  const map = new CityMap(cal);

  it('finds a tower from its own coordinates, for every day', () => {
    for (let i = 0; i < cal.days; i += 37) expect(map.cellIndex(map.cx[i], map.cz[i])).toBe(i);
  });

  it('leaves alleys wider than the ship', () => {
    expect(CELL - TOWER).toBeGreaterThan(SHIP_HALF_SPAN * 2);
  });

  it('scales the tallest tower to the same height for any peak', () => {
    const big = new CityMap(new Calendar(FIXTURES['one enormous spike']));
    expect(Math.max(...big.top)).toBeCloseTo(Math.max(...map.top), 3);
  });

  it('keeps blocks and streets apart', () => {
    expect(map.cellIndex(10, DEPTH + 1)).toBe(-1);
  });
});

describe('route lookups', () => {
  const cal = new Calendar(FIXTURES['quiet for years, then busy']);
  const map = new CityMap(cal);
  const route = buildRoute(map, 'all', new Vector3());

  it('interpolates between samples and stops at the ends', () => {
    const pose = newPose();
    expect(poseAt(route, -5, pose).p.distanceTo(route.samples[0].p)).toBeCloseTo(0);
    expect(poseAt(route, route.len + 5, pose).p.distanceTo(route.samples.at(-1)?.p as Vector3)).toBeCloseTo(0);
  });

  it('finds a date on the route', () => {
    const target = cal.span(2025).a + 100;
    expect(poseAt(route, lengthAtDay(route, target), newPose()).day).toBeGreaterThanOrEqual(target - RISE);
  });
});
