import { LOGIN_PATTERN } from '../shared/contract';
import { today } from './race';

const KEY = 'contriscape:passport';
/** Cities kept, most recently flown first. Past this the one flown longest ago goes. */
const KEPT = 200;

/** What this browser remembers of one city. */
export interface Stamp {
  login: string;
  name: string | null;
  /** The days it was first and last opened, as `YYYY-MM-DD`. */
  first: string;
  last: string;
  /** Whether every badge on it has been earned here. */
  cleared: boolean;
  /** The years raced to the finish, and those where the rival was beaten. */
  raced: number[];
  won: number[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isYears = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((year) => Number.isInteger(year) && year > 2000 && year < 3000);

function isStamp(value: unknown): value is Stamp {
  const stamp = value as Stamp | null;
  return (
    typeof stamp === 'object' &&
    stamp !== null &&
    typeof stamp.login === 'string' &&
    LOGIN_PATTERN.test(stamp.login) &&
    (stamp.name === null || typeof stamp.name === 'string') &&
    typeof stamp.first === 'string' &&
    DAY.test(stamp.first) &&
    typeof stamp.last === 'string' &&
    DAY.test(stamp.last) &&
    typeof stamp.cleared === 'boolean' &&
    isYears(stamp.raced) &&
    isYears(stamp.won)
  );
}

/** The cities flown in this browser, most recently opened first. */
export function readPassport(): Stamp[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter(isStamp) : [];
  } catch {
    return [];
  }
}

/**
 * Records something about a city in the passport: that it was opened, cleared or raced. Opening one moves it to the
 * front. `change` edits its stamp, which starts empty for a city not seen before.
 */
export function stamp(login: string, name: string | null, change: (stamp: Stamp) => void = () => {}): void {
  const day = today();
  const stamps = readPassport();
  const at = stamps.findIndex((other) => other.login.toLowerCase() === login.toLowerCase());
  const entry: Stamp =
    at >= 0 ? stamps.splice(at, 1)[0] : { login, name, first: day, last: day, cleared: false, raced: [], won: [] };
  entry.login = login;
  entry.name = name;
  entry.last = day;
  change(entry);
  stamps.unshift(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(stamps.slice(0, KEPT)));
  } catch {
    // Private windows can refuse storage. The passport only remembers what it can.
  }
}

/** The city opened last in this browser, or null on a first visit. */
export const lastCity = (): string | null => readPassport()[0]?.login ?? null;

/** Drops a city from the passport, for an account GitHub no longer has. */
export function forget(login: string): void {
  const stamps = readPassport().filter((other) => other.login.toLowerCase() !== login.toLowerCase());
  try {
    localStorage.setItem(KEY, JSON.stringify(stamps));
  } catch {
    // Nothing that can't be reached needs forgetting
  }
}

/** Adds a year to a list of years once. */
export const addYear = (years: number[], year: number): void => {
  if (!years.includes(year)) years.push(year);
};

/** A city's line in the passport: what has been done on it here. */
export function stampLine(stamp: Stamp): string {
  const done = [
    stamp.cleared ? 'Cleared' : '',
    stamp.won.length ? `beat the rival in ${stamp.won.length} ${stamp.won.length === 1 ? 'year' : 'years'}` : '',
    stamp.raced.length && !stamp.won.length
      ? `raced ${stamp.raced.length} ${stamp.raced.length === 1 ? 'year' : 'years'}`
      : '',
  ].filter(Boolean);
  const said = done.join(', ');
  return said ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.` : 'Flown.';
}
