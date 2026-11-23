import { describe, expect, it } from 'vitest';
import { Calendar } from '../src/calendar';
import { findMilestones } from '../src/milestones';
import { reviewYear, type YearReview } from '../src/review';
import { cardText, yearStory, yearStyle } from '../src/story';

/** A history of 2025 and 2026, 2026 running to 15 December, with a count on each day `day` picks. */
function calendar(day: (date: Date) => number, through = 348): Calendar {
  const years: Record<string, number[]> = {};
  for (const y of [2025, 2026]) {
    const length = y === 2026 ? through + 1 : 365;
    years[String(y)] = Array.from({ length }, (_, i) => day(new Date(Date.UTC(y, 0, 1 + i))));
  }
  return new Calendar({ login: 'fixture', name: null, snapshot: '2026-12-15', years });
}

const story = (cal: Calendar, year = 2026) =>
  yearStory(reviewYear(cal, year, findMilestones(cal)) as YearReview, cal, findMilestones(cal), 'https://example.com');

describe('yearStory', () => {
  // Weekdays only, two a day, with a busy 10 March and a run through June
  const cal = calendar((d) => {
    if (d.getUTCFullYear() === 2025) return d.getUTCDate() === 1 ? 3 : 0;
    if (d.getUTCMonth() === 2 && d.getUTCDate() === 10) return 40;
    if (d.getUTCMonth() === 5) return 1;
    return d.getUTCDay() % 6 ? 2 : 0;
  });
  const told = story(cal);
  const card = (kind: string) => told.cards.find((c) => c.kind === kind);

  it('opens on the year and closes on all its numbers, with a card for each fact between', () => {
    expect(told.cards.map((c) => c.kind)).toEqual([
      'opener',
      'total',
      'days',
      'streak',
      'peak',
      'month',
      'style',
      'badges',
      'summary',
    ]);
    expect(cardText(told.cards[0])).toBe('fixture: 2026. Your year on GitHub, so far.');
    expect(told.link).toBe('example.com/fixture/2026');
    expect(told.site).toBe('example.com');
  });

  it('says what each card is about in words that match the numbers', () => {
    const review = reviewYear(cal, 2026) as YearReview;
    expect(card('total')?.big).toBe(String(review.total));
    expect(card('total')?.line).toMatch(/^Up [\d,]+% on 2025$/);
    expect(card('days')?.line).toBe('of the 349 days so far in 2026 had a contribution');
    expect(card('peak')?.big).toBe('10 March');
    expect(card('peak')?.line).toBe('40 contributions, on a Tuesday');
    // June has a contribution every day. 31 May is a Sunday, and the weekdays after June carry the run to Friday 3 July
    expect(card('streak')?.line).toBe('in a row, from 1 June to 3 July');
    expect(card('summary')?.rows?.at(-1)).toEqual(['Style', yearStyle(review).name]);
  });

  it('picks out on each chart the thing its card is about', () => {
    const peak = card('peak')?.bars;
    expect(peak && peak.values[peak.from]).toBe(40);
    const month = card('month')?.bars;
    expect(month?.labels).toHaveLength(12);
    expect(month && month.from).toBe(month?.values.indexOf(Math.max(...(month?.values ?? []))));
    const streak = card('streak')?.bars;
    expect(streak && streak.to - streak.from + 1).toBe(33);
  });

  it('leaves out a streak card for a year with no two days in a row, and a badges card with no badge in it', () => {
    const sparse = calendar((d) => (d.getUTCDate() % 2 ? 0 : 1));
    const kinds = story(sparse, 2026).cards.map((c) => c.kind);
    expect(kinds).not.toContain('streak');
    expect(kinds).not.toContain('badges');
  });

  it("says a year is a first when nothing came before it, and doesn't call a finished year so far", () => {
    const first = calendar((d) => (d.getUTCFullYear() === 2025 && d.getUTCDate() === 5 ? 1 : 0));
    const told2025 = story(first, 2025);
    expect(told2025.cards.find((c) => c.kind === 'total')?.line).toBe('Your first year with any');
    expect(told2025.cards[0].line).toBe('Your year on GitHub');
    expect(told2025.cards.find((c) => c.kind === 'days')?.line).toBe('of the 365 days in 2025 had a contribution');
  });
});

describe('yearStyle', () => {
  const base: YearReview = {
    year: 2026,
    total: 1000,
    change: null,
    activeDays: 100,
    days: 365,
    complete: true,
    streak: 5,
    streakEnd: 0,
    busiestDay: { day: 0, count: 20 },
    busiestMonth: { name: 'May', total: 200 },
    busiestWeekday: { name: 'Tuesday', total: 200 },
    months: [],
    weekdays: [100, 180, 200, 180, 150, 120, 70],
    typicalDay: 5,
    beats: [],
  };

  it('takes the first rule a year meets, and gives the fact it rests on', () => {
    expect(yearStyle({ ...base, streak: 40 })).toEqual({
      name: 'Marathoner',
      reason: '40 days in a row without a break',
    });
    expect(yearStyle({ ...base, weekdays: [250, 100, 100, 100, 100, 100, 250] })).toEqual({
      name: 'Weekend builder',
      reason: '50% of your contributions fell on a Saturday or a Sunday',
    });
    expect(yearStyle({ ...base, activeDays: 300 })).toEqual({
      name: 'Regular',
      reason: 'Something on 82% of the days in 2026',
    });
    expect(yearStyle({ ...base, busiestDay: { day: 0, count: 60 }, typicalDay: 5 })).toEqual({
      name: 'Sprinter',
      reason: 'Your busiest day was 12 times a usual active day',
    });
    expect(yearStyle({ ...base, weekdays: [20, 200, 200, 200, 200, 160, 20] })).toEqual({
      name: 'Weekday worker',
      reason: '96% of your contributions came Monday to Friday',
    });
    expect(yearStyle(base)).toEqual({ name: 'All-rounder', reason: 'Tuesday was your day, with 20% of the year' });
  });
});
