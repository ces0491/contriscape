import { describe, expect, it } from 'vitest';
import type { Contributions } from '../shared/contract';
import { Calendar } from '../src/calendar';
import {
  Programme,
  saverScopes,
  SETTLE_SECONDS,
  SHOT_ZOOMS,
  WAKE_PIXELS,
  Wake,
  type SaverScope,
} from '../src/screensaver';
import { COCKPIT_BELOW } from '../src/zoom';

const SNAPSHOT = '2026-11-02';

/** A history with these totals a year, spread over the year's first days. */
function history(totals: Record<number, number>): Calendar {
  const years: Contributions['years'] = {};
  for (const [year, total] of Object.entries(totals)) {
    const length = year === '2026' ? 306 : 365;
    years[year] = Array.from({ length }, (_, d) => (d < total ? 1 : 0));
  }
  return new Calendar({ login: 'fixture', name: null, snapshot: SNAPSHOT, years });
}

/** Deterministic pseudo-random, so a failure here reproduces. */
const noise = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

describe('saverScopes', () => {
  it('flies the whole history and each busy year, and leaves out the quiet ones', () => {
    expect(saverScopes(history({ 2023: 2, 2024: 200, 2025: 300, 2026: 120 }))).toEqual(['all', 2024, 2025, 2026]);
  });

  it('flies the one year of a history that has only one', () => {
    expect(saverScopes(history({ 2026: 40 }))).toEqual([2026]);
  });

  it('still has something to fly in a history with no contributions', () => {
    expect(saverScopes(history({ 2025: 0, 2026: 0 }))).toEqual(['all', 2026]);
    expect(saverScopes(history({ 2026: 0 }))).toEqual([2026]);
  });
});

describe('Programme', () => {
  const scopes: SaverScope[] = ['all', 2022, 2023, 2024, 2025, 2026];

  it('flies each flight once a round, and never the same one twice running', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const programme = new Programme(scopes, noise(seed));
      const flown = Array.from({ length: scopes.length * 8 }, () => programme.next().scope);
      for (let round = 0; round < 8; round++) {
        const each = flown.slice(round * scopes.length, (round + 1) * scopes.length);
        expect([...each].sort(), `seed ${seed}, round ${round}`).toEqual([...scopes].sort());
      }
      flown.slice(1).forEach((scope, i) => expect(scope, `seed ${seed}, flight ${i + 1}`).not.toBe(flown[i]));
    }
  });

  it('shuffles, so two rounds can come in different orders', () => {
    const programme = new Programme(scopes, noise(7));
    const rounds = Array.from({ length: 6 }, () => scopes.map(() => programme.next().scope).join());
    expect(new Set(rounds).size).toBeGreaterThan(1);
  });

  it('steps through its distances, the cockpit among them', () => {
    const programme = new Programme([2026], noise(3));
    const zooms = Array.from({ length: SHOT_ZOOMS.length * 2 }, () => programme.next().zoom);
    expect(zooms).toEqual([...SHOT_ZOOMS, ...SHOT_ZOOMS]);
    expect(Math.min(...SHOT_ZOOMS)).toBeLessThan(COCKPIT_BELOW);
  });

  it('flies the one flight it has over and over', () => {
    const programme = new Programme([2026], noise(5));
    expect([1, 2, 3].map(() => programme.next().scope)).toEqual([2026, 2026, 2026]);
  });
});

describe('Wake', () => {
  const settled = SETTLE_SECONDS * 1000;

  it('lets the hand that started the screensaver let go of the mouse', () => {
    const wake = new Wake(1000);
    expect(wake.moved(1000 + settled / 2, 0, 0)).toBe(false);
    expect(wake.moved(1000 + settled / 2, 400, 300)).toBe(false);
  });

  it('ends with a move of the mouse once settled, and not with a twitch', () => {
    const wake = new Wake(0);
    expect(wake.moved(settled, 400, 300)).toBe(false);
    expect(wake.moved(settled + 50, 400 + WAKE_PIXELS / 2, 300)).toBe(false);
    expect(wake.moved(settled + 100, 400 + WAKE_PIXELS, 300 + WAKE_PIXELS)).toBe(true);
  });
});
