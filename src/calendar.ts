import type { Contributions } from '../shared/contract';

const MS_PER_DAY = 864e5;
const BUSY_WINDOW = 10;

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Span {
  a: number;
  b: number;
}

export interface Cell {
  year: number;
  week: number;
  row: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const daysIn = (year: number) => Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / MS_PER_DAY);

export const formatCount = (n: number) => n.toLocaleString('en-ZA').replace(/\s/g, ',');
export const describeCount = (n: number) =>
  n === 0 ? 'No contributions' : `${formatCount(n)} contribution${n === 1 ? '' : 's'}`;

/** One user's history as a single run of days, indexed from 1 January of their first year. */
export class Calendar {
  readonly login: string;
  readonly snapshot: string;
  readonly years: number[] = [];
  readonly counts: number[] = [];
  readonly spans = new Map<number, Span>();
  readonly firstYear: number;
  readonly lastYear: number;
  readonly days: number;
  readonly total: number;
  readonly peak: number;
  readonly busiestWindow: number;
  readonly firsts: NonNullable<Contributions['firsts']>;
  private readonly running: Float64Array;

  constructor(data: Contributions) {
    this.login = data.login;
    this.snapshot = data.snapshot;
    this.firsts = data.firsts ?? { joined: null, repository: null, pullRequest: null, issue: null };
    const listed = Object.keys(data.years).map(Number);
    const fallback = Number(data.snapshot.slice(0, 4));
    this.firstYear = listed.length ? Math.min(...listed) : fallback;
    this.lastYear = listed.length ? Math.max(...listed) : fallback;

    for (let y = this.firstYear; y <= this.lastYear; y++) {
      const a = this.counts.length;
      this.counts.push(...(data.years[String(y)] ?? []));
      if (y < this.lastYear) while (this.counts.length - a < daysIn(y)) this.counts.push(0);
      if (this.counts.length === a) this.counts.push(0);
      this.years.push(y);
      this.spans.set(y, { a, b: this.counts.length - 1 });
    }

    this.days = this.counts.length;
    this.running = new Float64Array(this.days + 1);
    this.counts.forEach((c, i) => {
      this.running[i + 1] = this.running[i] + c;
    });
    this.total = this.running[this.days];
    this.peak = Math.max(...this.counts);
    this.busiestWindow = Math.max(1, ...this.counts.map((_, i) => this.windowSum(i)));
  }

  span(year: number): Span {
    const found = this.spans.get(year);
    if (!found) throw new RangeError(`No such year: ${year}`);
    return found;
  }

  sum(a: number, b: number): number {
    return this.running[b + 1] - this.running[a];
  }

  yearTotal(year: number): number {
    const { a, b } = this.span(year);
    return this.sum(a, b);
  }

  windowSum(day: number): number {
    const last = this.days - 1;
    return this.sum(clamp(Math.floor(day) - BUSY_WINDOW, 0, last), clamp(Math.floor(day) + BUSY_WINDOW, 0, last));
  }

  dateOf(i: number): Date {
    return new Date(Date.UTC(this.firstYear, 0, 1 + i));
  }

  /** The day index of a date, which may lie past the end of the data. */
  dayOf(year: number, month: number): number {
    return Math.round((Date.UTC(year, month, 1) - Date.UTC(this.firstYear, 0, 1)) / MS_PER_DAY);
  }

  /** The day index of a date, or null for no date or one outside the calendar. */
  dayFromDate(date: string | null): number | null {
    if (!date) return null;
    const day = Math.round((Date.parse(date) - Date.UTC(this.firstYear, 0, 1)) / MS_PER_DAY);
    return day >= 0 && day < this.days ? day : null;
  }

  longestStreak(a: number, b: number): { length: number; end: number } {
    let run = 0;
    let best = { length: 0, end: a };
    for (let i = a; i <= b; i++) {
      run = this.counts[i] ? run + 1 : 0;
      if (run > best.length) best = { length: run, end: i };
    }
    return best;
  }

  cellOf(i: number): Cell {
    const d = this.dateOf(i);
    const year = d.getUTCFullYear();
    const jan = Date.UTC(year, 0, 1);
    const week = Math.floor((Math.round((d.getTime() - jan) / MS_PER_DAY) + new Date(jan).getUTCDay()) / 7);
    return { year, week, row: d.getUTCDay() };
  }

  formatShort(i: number): string {
    const d = this.dateOf(i);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  formatDate(i: number): string {
    return `${WEEKDAYS[this.dateOf(i).getUTCDay()]} ${this.formatShort(i)}`;
  }

  /** The busiest day of a year, or -1 for a year with no contributions. */
  busiestIn(year: number): number {
    const { a, b } = this.span(year);
    let best = a;
    for (let i = a; i <= b; i++) if (this.counts[i] > this.counts[best]) best = i;
    return this.counts[best] ? best : -1;
  }
}
