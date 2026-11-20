import { describe, expect, it } from 'vitest';
import type { Contributions } from '../shared/contract';
import { BADGE_ART } from '../src/badge-art';
import { Calendar } from '../src/calendar';
import { findMilestones } from '../src/milestones';
import { MOST_BEATS, reviewFacts, reviewSeason, reviewYear } from '../src/review';
import { formatClock, Run } from '../src/run';

const SNAPSHOT = '2026-12-15';

function calendar(days: Record<string, number>, firsts?: Contributions['firsts']): Calendar {
  const years: Contributions['years'] = {};
  for (const y of [2025, 2026]) {
    const length = y === 2026 ? 349 : 365;
    years[String(y)] = Array.from({ length }, (_, i) => {
      const date = new Date(Date.UTC(y, 0, 1 + i)).toISOString().slice(0, 10);
      return days[date] ?? 0;
    });
  }
  return new Calendar({ login: 'fixture', name: null, snapshot: SNAPSHOT, years, firsts });
}

const named = (cal: Calendar) => Object.fromEntries(findMilestones(cal).map((m) => [m.id, m]));

describe('findMilestones', () => {
  it('places each first on its date', () => {
    const cal = calendar(
      { '2025-03-01': 2 },
      { joined: '2025-02-01', repository: '2025-02-10', pullRequest: '2025-05-05', issue: null },
    );
    const found = named(cal);
    expect(cal.formatShort(found.joined.day)).toBe('1 Feb 2025');
    expect(cal.formatShort(found['first-repository'].day)).toBe('10 Feb 2025');
    expect(cal.formatShort(found['first-pull-request'].day)).toBe('5 May 2025');
    expect(found['first-issue']).toBeUndefined();
  });

  it('dates a running total to the day it was crossed', () => {
    const cal = calendar({ '2025-01-10': 60, '2025-02-10': 39, '2025-03-10': 1, '2025-04-10': 5 });
    const found = named(cal);
    expect(cal.formatShort(found['hundred-club'].day)).toBe('10 Mar 2025');
    expect(found['thousand-club']).toBeUndefined();
  });

  it('finds the first full week, the longest streak and the busiest day', () => {
    const days: Record<string, number> = { '2026-02-02': 40 };
    for (let d = 1; d <= 7; d++) days[`2025-06-0${d}`] = 1;
    for (let d = 10; d <= 19; d++) days[`2025-09-${d}`] = 1;
    const cal = calendar(days);
    const found = named(cal);
    expect(cal.formatShort(found['full-week'].day)).toBe('7 Jun 2025');
    expect(cal.formatShort(found['longest-streak'].day)).toBe('19 Sep 2025');
    expect(found['longest-streak'].detail).toContain('10 days');
    expect(cal.formatShort(found['busiest-day'].day)).toBe('2 Feb 2026');
  });

  it('leaves out a streak too short to be a milestone', () => {
    expect(named(calendar({ '2025-06-01': 1, '2025-06-02': 1 }))['longest-streak']).toBeUndefined();
  });

  it('copes with an account that has no contributions', () => {
    const found = findMilestones(
      calendar({}, { joined: '2025-02-01', repository: null, pullRequest: null, issue: null }),
    );
    expect(found.map((m) => m.id)).toEqual(['joined']);
  });

  it('copes with replies cached before firsts existed', () => {
    expect(named(calendar({ '2025-03-01': 1 }))['first-contribution']).toBeDefined();
  });

  it('drops a first dated outside the calendar', () => {
    const cal = calendar({}, { joined: '2019-01-01', repository: null, pullRequest: null, issue: null });
    expect(findMilestones(cal)).toEqual([]);
  });

  it('runs in date order, with unique ids', () => {
    const found = findMilestones(
      calendar(
        { '2025-03-01': 2000, '2025-03-02': 9000 },
        { joined: '2025-01-01', repository: '2025-02-01', pullRequest: '2025-03-01', issue: '2025-03-01' },
      ),
    );
    const days = found.map((m) => m.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(new Set(found.map((m) => m.id)).size).toBe(found.length);
  });

  it('has artwork for every badge it can award', () => {
    const found = findMilestones(
      calendar(
        {
          '2025-03-01': 20000,
          '2025-03-02': 1,
          '2025-03-03': 1,
          '2025-03-04': 1,
          '2025-03-05': 1,
          '2025-03-06': 1,
          '2025-03-07': 1,
        },
        { joined: '2025-01-01', repository: '2025-01-02', pullRequest: '2025-01-03', issue: '2025-01-04' },
      ),
    );
    expect(found.length).toBe(Object.keys(BADGE_ART).length);
    for (const m of found) expect(BADGE_ART[m.id]).toBeDefined();
  });

  it("uses names of its own, none of GitHub's achievements", () => {
    const github = /starstruck|quickdraw|yolo|pull shark|pair extraordinaire|galaxy brain|arctic|sponsor/i;
    const found = findMilestones(
      calendar(
        { '2025-03-01': 20000 },
        { joined: '2025-01-01', repository: '2025-01-02', pullRequest: '2025-01-03', issue: '2025-01-04' },
      ),
    );
    for (const m of found) expect(m.name).not.toMatch(github);
  });
});

describe('formatClock', () => {
  it('shows minutes and seconds, whole and padded', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9.9)).toBe('0:09');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(3725)).toBe('62:05');
  });
});

describe('Run', () => {
  it('times a clear flown from a city with no badge earned', () => {
    const run = new Run(true);
    expect(run.timed).toBe(true);
    run.tick(1.5);
    run.tick(2);
    expect(run.seconds).toBeCloseTo(3.5);
    expect(run.finish()).toBeCloseTo(3.5);
  });

  it('stops the clock once the city is cleared', () => {
    const run = new Run(true);
    run.tick(4);
    run.finish();
    run.tick(10);
    expect(run.seconds).toBeCloseTo(4);
    expect(run.timed).toBe(false);
    expect(run.finish()).toBeNull();
  });

  it('gives no time to a clear that took a jump from the list', () => {
    const run = new Run(true);
    run.tick(3);
    run.jumped();
    run.tick(3);
    expect(run.timed).toBe(false);
    expect(run.finish()).toBeNull();
  });

  it('gives no time to a visit that began with badges already earned', () => {
    const run = new Run(false);
    run.tick(5);
    expect(run.timed).toBe(false);
    expect(run.finish()).toBeNull();
  });

  it('starts over from nothing when the badges are reset', () => {
    const run = new Run(false);
    run.tick(5);
    run.reset();
    expect(run.timed).toBe(true);
    expect(run.seconds).toBe(0);
    run.tick(2);
    expect(run.finish()).toBeCloseTo(2);
  });
});

describe('reviewYear', () => {
  const days = {
    '2025-05-05': 50,
    '2026-01-15': 5,
    '2026-03-02': 7,
    '2026-03-03': 8,
    '2026-03-04': 9,
    '2026-03-09': 31,
    '2026-11-20': 15,
  };
  const cal = calendar(days);
  const review = reviewYear(cal, 2026);

  it('adds up the year', () => {
    expect(review).toMatchObject({ year: 2026, total: 75, activeDays: 6, streak: 3 });
  });

  it('finds the busiest day, month and weekday', () => {
    expect(cal.formatShort(review?.busiestDay.day as number)).toBe('9 Mar 2026');
    expect(review?.busiestMonth).toEqual({ name: 'March', total: 55 });
    expect(review?.busiestWeekday).toEqual({ name: 'Monday', total: 38 });
  });

  it('compares with the year before', () => {
    expect(review?.change).toBe(50);
    expect(reviewFacts(review as NonNullable<typeof review>, cal)).toContainEqual(['On 2025', 'up 50%']);
  });

  it('has no comparison in a first year', () => {
    const first = reviewYear(cal, 2025);
    expect(first?.change).toBeNull();
    expect(reviewFacts(first as NonNullable<typeof first>, cal).map(([label]) => label)).not.toContain('On 2024');
  });

  it('says down when the year fell', () => {
    const fell = reviewYear(calendar({ '2025-01-05': 40, '2026-01-05': 10 }), 2026);
    expect(fell?.change).toBe(-75);
    expect(reviewFacts(fell as NonNullable<typeof fell>, cal)).toContainEqual(['On 2025', 'down 75%']);
  });

  it('tells the story in date order, inside the year', () => {
    const beats = review?.beats ?? [];
    const { a, b } = cal.span(2026);
    expect(beats[0].title).toBe('The first of the year');
    beats.forEach((beat, i) => {
      expect(beat.day).toBeGreaterThanOrEqual(a);
      expect(beat.day).toBeLessThanOrEqual(b);
      if (i) expect(beat.day).toBeGreaterThanOrEqual(beats[i - 1].day);
    });
  });

  it("adds the year's badges, but not one on a day the year already tells, nor one from another year", () => {
    const day = (date: string) => cal.dayFromDate(date) as number;
    const badges = [
      { id: 'old', name: 'Old', detail: 'Before', day: day('2025-05-05') },
      { id: 'summit', name: 'Summit', detail: 'Busiest day', day: day('2026-03-09') },
      { id: 'thousand-club', name: 'Thousand Club', detail: 'Contribution number 1,000', day: day('2026-11-20') },
    ];
    const told = reviewYear(cal, 2026, badges)?.beats ?? [];
    expect(told.filter((beat) => beat.badge).map((beat) => beat.badge)).toEqual(['thousand-club']);
    expect(told.find((beat) => beat.badge)?.title).toBe('Badge: Thousand Club');
  });

  it('stops for no more moments than the flight has time for', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `badge-${i}`,
      name: `Badge ${i}`,
      detail: '',
      day: (cal.dayFromDate('2026-04-01') as number) + i,
    }));
    expect(reviewYear(cal, 2026, many)?.beats).toHaveLength(MOST_BEATS);
  });

  it('has nothing to say about an empty year', () => {
    expect(reviewYear(calendar({ '2025-03-03': 1 }), 2026)).toBeNull();
  });
});

describe('reviewSeason', () => {
  it('offers the year ending through December, and the one just ended through mid January', () => {
    expect(reviewSeason(new Date(2026, 11, 1), 2026)).toBe(2026);
    expect(reviewSeason(new Date(2026, 11, 31), 2026)).toBe(2026);
    expect(reviewSeason(new Date(2027, 0, 1), 2027)).toBe(2026);
    expect(reviewSeason(new Date(2027, 0, 15), 2027)).toBe(2026);
    expect(reviewSeason(new Date(2027, 0, 16), 2027)).toBeNull();
    expect(reviewSeason(new Date(2026, 10, 30), 2026)).toBeNull();
  });
});
