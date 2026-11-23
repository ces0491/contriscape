import { formatCount, type Calendar } from './calendar';
import type { Milestone } from './milestones';

/** A caption shown as the flight reaches a date. */
export interface Beat {
  day: number;
  title: string;
  detail: string;
  /** The badge this moment is, if it is one, by its id. */
  badge?: string;
}

/** The most moments a year's flight stops for. The flight lasts about half a minute, and each caption four seconds. */
export const MOST_BEATS = 7;

export interface YearReview {
  year: number;
  total: number;
  /** Percentage change on the year before, or null with no year to compare. */
  change: number | null;
  activeDays: number;
  /** The days the year has had so far: all of them once it's over. */
  days: number;
  /** Whether the year is over, so every one of its days is counted. */
  complete: boolean;
  streak: number;
  /** The day the longest streak ended on. */
  streakEnd: number;
  busiestDay: { day: number; count: number };
  busiestMonth: { name: string; total: number };
  busiestWeekday: { name: string; total: number };
  /** Contributions in each month, January first, and on each weekday, Sunday first. */
  months: number[];
  weekdays: number[];
  /** The middle count among the days that had any. */
  typicalDay: number;
  beats: Beat[];
}

export const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const reviewTitle = (year: number) => `Your ${year} on GitHub`;

/**
 * The year a visit offers a flight through: the year ending, from mid November through December, and the one just
 * ended, through the first half of January, when people look back on it. Null at other times. `lastYear` is the newest
 * year in the history.
 *
 * The history runs to the year as it stands in UTC, and the CDN can hand out a copy made hours before, so around New
 * Year it can end a year ahead of the visitor's own date or a year behind. The year is taken from the visitor's date,
 * and never past the end of the history.
 */
export function reviewSeason(now: Date, lastYear: number): number | null {
  const year = now.getFullYear();
  if (now.getMonth() === 11 || (now.getMonth() === 10 && now.getDate() >= 15)) return Math.min(year, lastYear);
  if (now.getMonth() === 0 && now.getDate() <= 15) return Math.min(year - 1, lastYear);
  return null;
}

const contributions = (n: number) => `${formatCount(n)} contribution${n === 1 ? '' : 's'}`;

/**
 * The story of one year, told from its daily counts and the badges that fall in it, or null for a year with nothing in
 * it or outside the history. A badge on the same day as one of the year's own moments is left out, so a day isn't told
 * twice.
 */
export function reviewYear(cal: Calendar, year: number, milestones: Milestone[] = []): YearReview | null {
  if (!cal.spans.has(year)) return null;
  const { a, b } = cal.span(year);
  const total = cal.sum(a, b);
  if (!total) return null;

  const months = new Array<number>(12).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  let active = 0;
  let first = -1;
  let busiest = a;
  for (let i = a; i <= b; i++) {
    const count = cal.counts[i];
    const date = cal.dateOf(i);
    months[date.getUTCMonth()] += count;
    weekdays[date.getUTCDay()] += count;
    if (count) {
      active++;
      if (first < 0) first = i;
    }
    if (count > cal.counts[busiest]) busiest = i;
  }
  const topMonth = months.indexOf(Math.max(...months));
  const topWeekday = weekdays.indexOf(Math.max(...weekdays));
  const streak = cal.longestStreak(a, b);
  const previous = cal.spans.has(year - 1) ? cal.yearTotal(year - 1) : 0;
  const busy = cal.counts
    .slice(a, b + 1)
    .filter((count) => count > 0)
    .sort((x, y) => x - y);
  const days = b - a + 1;

  const monthEnd = Math.min(b, cal.dayOf(year, topMonth + 1) - 1);
  const beats: Beat[] = [
    { day: first, title: 'The first of the year', detail: `${cal.formatShort(first)}` },
    {
      day: monthEnd,
      title: `${LONG_MONTHS[topMonth]} was your biggest month`,
      detail: contributions(months[topMonth]),
    },
    {
      day: busiest,
      title: 'Your busiest day',
      detail: `${contributions(cal.counts[busiest])} on ${cal.formatShort(busiest)}`,
    },
  ];
  if (streak.length > 1) {
    beats.push({
      day: streak.end,
      title: `${formatCount(streak.length)} days in a row`,
      detail: `Your longest streak, ending ${cal.formatShort(streak.end)}`,
    });
  }
  const told = new Set(beats.map((beat) => beat.day));
  for (const badge of milestones) {
    if (beats.length >= MOST_BEATS) break;
    if (badge.day < a || badge.day > b || told.has(badge.day)) continue;
    told.add(badge.day);
    beats.push({ day: badge.day, title: `Badge: ${badge.name}`, detail: badge.detail, badge: badge.id });
  }

  return {
    year,
    total,
    change: previous ? Math.round(((total - previous) / previous) * 100) : null,
    activeDays: active,
    days,
    complete: days >= Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000),
    streak: streak.length,
    streakEnd: streak.end,
    busiestDay: { day: busiest, count: cal.counts[busiest] },
    busiestMonth: { name: LONG_MONTHS[topMonth], total: months[topMonth] },
    busiestWeekday: { name: LONG_WEEKDAYS[topWeekday], total: weekdays[topWeekday] },
    months,
    weekdays,
    typicalDay: busy[Math.floor((busy.length - 1) / 2)],
    beats: beats.sort((x, y) => x.day - y.day),
  };
}

/** The rows of the closing card, under its total. */
export function reviewFacts(review: YearReview, cal: Calendar): [string, string][] {
  const facts: [string, string][] = [
    ['Active days', formatCount(review.activeDays)],
    ['Longest streak', `${formatCount(review.streak)} day${review.streak === 1 ? '' : 's'}`],
    ['Busiest day', `${formatCount(review.busiestDay.count)} on ${cal.formatShort(review.busiestDay.day)}`],
    ['Busiest month', `${review.busiestMonth.name}, ${formatCount(review.busiestMonth.total)}`],
    ['Busiest weekday', review.busiestWeekday.name],
  ];
  if (review.change !== null) {
    const direction = review.change >= 0 ? 'up' : 'down';
    facts.unshift([`On ${review.year - 1}`, `${direction} ${formatCount(Math.abs(review.change))}%`]);
  }
  return facts;
}
