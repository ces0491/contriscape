import { formatCount, type Calendar } from './calendar';

/** A caption shown as the flight reaches a date. */
export interface Beat {
  day: number;
  title: string;
  detail: string;
}

export interface YearReview {
  year: number;
  total: number;
  /** Percentage change on the year before, or null with no year to compare. */
  change: number | null;
  activeDays: number;
  streak: number;
  busiestDay: { day: number; count: number };
  busiestMonth: { name: string; total: number };
  busiestWeekday: { name: string; total: number };
  beats: Beat[];
}

const LONG_MONTHS = [
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
const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const reviewTitle = (year: number) => `Your ${year} on GitHub`;

const contributions = (n: number) => `${formatCount(n)} contribution${n === 1 ? '' : 's'}`;

/** The story of one year, told from its daily counts, or null for a year with nothing in it. */
export function reviewYear(cal: Calendar, year: number): YearReview | null {
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

  const monthEnd = Math.min(b, cal.dayOf(year, topMonth + 1) - 1);
  const beats: Beat[] = [
    { day: a, title: reviewTitle(year), detail: cal.login },
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

  return {
    year,
    total,
    change: previous ? Math.round(((total - previous) / previous) * 100) : null,
    activeDays: active,
    streak: streak.length,
    busiestDay: { day: busiest, count: cal.counts[busiest] },
    busiestMonth: { name: LONG_MONTHS[topMonth], total: months[topMonth] },
    busiestWeekday: { name: LONG_WEEKDAYS[topWeekday], total: weekdays[topWeekday] },
    beats: beats.sort((x, y) => x.day - y.day),
  };
}

/** The rows of the closing card. */
export function reviewFacts(review: YearReview, cal: Calendar): [string, string][] {
  const facts: [string, string][] = [
    ['Contributions', formatCount(review.total)],
    ['Active days', formatCount(review.activeDays)],
    ['Longest streak', `${formatCount(review.streak)} day${review.streak === 1 ? '' : 's'}`],
    ['Busiest day', `${formatCount(review.busiestDay.count)} on ${cal.formatShort(review.busiestDay.day)}`],
    ['Busiest month', `${review.busiestMonth.name}, ${formatCount(review.busiestMonth.total)}`],
    ['Busiest weekday', review.busiestWeekday.name],
  ];
  if (review.change !== null) {
    const direction = review.change >= 0 ? 'up' : 'down';
    facts.splice(1, 0, [`On ${review.year - 1}`, `${direction} ${formatCount(Math.abs(review.change))}%`]);
  }
  return facts;
}
