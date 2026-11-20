import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flownGroup, flownTag } from '../src/explorer';
import { addYear, forget, lastCity, readPassport, stamp, stampLine } from '../src/passport';

/** A stand-in for the browser's storage, which the tests run without. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

describe('the passport', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('remembers the cities opened, most recent first, with nothing on a first visit', () => {
    expect(lastCity()).toBeNull();
    stamp('torvalds', 'Linus Torvalds');
    stamp('octo-dev', null);
    expect(lastCity()).toBe('octo-dev');
    stamp('Torvalds', 'Linus Torvalds');
    expect(readPassport().map((entry) => entry.login)).toEqual(['Torvalds', 'octo-dev']);
    expect(readPassport()[0]).toMatchObject({ first: '2026-11-20', last: '2026-11-20', cleared: false });
  });

  it('records a clear and races, and says so in a line', () => {
    stamp('octo-dev', null);
    expect(stampLine(readPassport()[0])).toBe('Flown.');
    stamp('octo-dev', null, (entry) => {
      addYear(entry.raced, 2025);
      addYear(entry.raced, 2025);
    });
    expect(readPassport()[0].raced).toEqual([2025]);
    expect(stampLine(readPassport()[0])).toBe('Raced 1 year.');
    stamp('octo-dev', null, (entry) => {
      entry.cleared = true;
      addYear(entry.won, 2025);
      addYear(entry.won, 2024);
    });
    expect(stampLine(readPassport()[0])).toBe('Cleared, beat the rival in 2 years.');
    expect(flownTag(readPassport()[0])).toBe('Cleared');
  });

  it('forgets a city that has gone, and keeps the rest', () => {
    stamp('gone-user', null);
    stamp('octo-dev', null);
    forget('Gone-User');
    expect(readPassport().map((entry) => entry.login)).toEqual(['octo-dev']);
  });

  it('ignores whatever else is stored under its name', () => {
    localStorage.setItem('contriscape:passport', JSON.stringify([{ login: 'not a login!' }, 7, null]));
    expect(readPassport()).toEqual([]);
    localStorage.setItem('contriscape:passport', '{');
    expect(lastCity()).toBeNull();
  });

  it('becomes a list in Explore once a city has been flown', () => {
    expect(flownGroup([])).toBeNull();
    stamp('octo-dev', 'Octo Dev');
    const group = flownGroup(readPassport());
    expect(group?.title).toBe('Flown here');
    expect(group?.people).toEqual([{ login: 'octo-dev', name: 'Octo Dev', about: 'Flown.' }]);
  });
});
