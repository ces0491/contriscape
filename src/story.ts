import { formatCount, type Calendar } from './calendar';
import type { Milestone } from './milestones';
import { LONG_MONTHS, LONG_WEEKDAYS, reviewFacts, type YearReview } from './review';

/** What a card is about, which also picks how it is drawn. */
export type CardKind = 'opener' | 'total' | 'days' | 'streak' | 'peak' | 'month' | 'style' | 'badges' | 'summary';

/** Bars to draw under a card's words: one per value, with the ones from `from` to `to` picked out. */
export interface Bars {
  values: number[];
  from: number;
  to: number;
  /** A letter under each bar, where there is room for one. */
  labels?: string[];
}

/** One card of a year's story. */
export interface StoryCard {
  kind: CardKind;
  /** A few words above the number. */
  kicker: string;
  /** The one thing the card is about, as large as it fits. */
  big: string;
  /** A sentence under it. */
  line: string;
  bars?: Bars;
  /** Badges to show, by id. */
  badges?: string[];
  /** The rows of the closing card. */
  rows?: [string, string][];
}

/** A year told as cards, and what drawing them needs. */
export interface Story {
  login: string;
  year: number;
  /** The address of the year's own page, without the scheme, which every card carries. */
  link: string;
  /** The site's address, without the scheme, which every card invites its viewer to fly their own year at. */
  site: string;
  /** The year's daily counts, from 1 January. */
  counts: number[];
  /** The weekday 1 January fell on, Sunday 0. */
  startDay: number;
  cards: StoryCard[];
}

/** A name for how someone worked through a year, and the fact it rests on, printed beside it. */
export interface Style {
  name: string;
  reason: string;
}

const percent = (part: number, whole: number) => Math.round((part / Math.max(1, whole)) * 100);
const contributions = (n: number) => `${formatCount(n)} contribution${n === 1 ? '' : 's'}`;

/**
 * How someone worked through a year, from the first rule it meets: a streak of a month or more, a weekend habit, most
 * days busy, a busiest day far above a usual one, or weekdays only. Anyone else is an all-rounder.
 */
export function yearStyle(review: YearReview): Style {
  const weekend = review.weekdays[0] + review.weekdays[6];
  const weekendShare = weekend / Math.max(1, review.total);
  if (review.streak >= 30) {
    return { name: 'Marathoner', reason: `${formatCount(review.streak)} days in a row without a break` };
  }
  if (weekendShare >= 0.35) {
    return {
      name: 'Weekend builder',
      reason: `${percent(weekend, review.total)}% of your contributions fell on a Saturday or a Sunday`,
    };
  }
  if (review.activeDays / review.days >= 0.6) {
    return {
      name: 'Regular',
      reason: `Something on ${percent(review.activeDays, review.days)}% of the days ${review.complete ? 'in' : 'so far in'} ${review.year}`,
    };
  }
  const burst = review.busiestDay.count / Math.max(1, review.typicalDay);
  if (review.activeDays >= 10 && burst >= 8) {
    return {
      name: 'Sprinter',
      reason: `Your busiest day was ${formatCount(Math.floor(burst))} times a usual active day`,
    };
  }
  if (review.total >= 50 && weekendShare < 0.08) {
    return {
      name: 'Weekday worker',
      reason: `${percent(review.total - weekend, review.total)}% of your contributions came Monday to Friday`,
    };
  }
  return {
    name: 'All-rounder',
    reason: `${review.busiestWeekday.name} was your day, with ${percent(review.busiestWeekday.total, review.total)}% of the year`,
  };
}

/** A list in words: "a", "a and b", "a, b and c". */
const listed = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** The days of a year in weeks of seven from 1 January, each week's total. */
const weekly = (counts: number[]) =>
  Array.from({ length: Math.ceil(counts.length / 7) }, (_, w) =>
    counts.slice(w * 7, w * 7 + 7).reduce((sum, n) => sum + n, 0),
  );

/**
 * A year's story as cards: its number over the city, then one fact to a card, and a closing card with them all.
 * A streak card needs a streak of two days or more, and a badges card a badge reached in the year.
 */
export function yearStory(review: YearReview, cal: Calendar, milestones: Milestone[], origin: string): Story {
  const { year } = review;
  const { a, b } = cal.span(year);
  const counts = cal.counts.slice(a, b + 1);
  const date = (day: number) => {
    const d = cal.dateOf(day);
    return `${d.getUTCDate()} ${LONG_MONTHS[d.getUTCMonth()]}`;
  };
  const style = yearStyle(review);
  const cards: StoryCard[] = [];
  const add = (card: StoryCard) => cards.push(card);

  add({
    kind: 'opener',
    kicker: cal.login,
    big: String(year),
    line: review.complete ? 'Your year on GitHub' : 'Your year on GitHub, so far',
  });

  const earlier = a > 0 && cal.sum(0, a - 1) > 0;
  add({
    kind: 'total',
    kicker: 'Contributions',
    big: formatCount(review.total),
    line:
      review.change !== null
        ? `${review.change >= 0 ? 'Up' : 'Down'} ${formatCount(Math.abs(review.change))}% on ${year - 1}`
        : earlier
          ? `Up from none at all in ${year - 1}`
          : 'Your first year with any',
    bars: { values: weekly(counts), from: -1, to: -1 },
  });

  add({
    kind: 'days',
    kicker: 'Active days',
    big: formatCount(review.activeDays),
    line: `of the ${formatCount(review.days)} days ${review.complete ? 'in' : 'so far in'} ${year} had a contribution`,
  });

  if (review.streak > 1) {
    const start = review.streakEnd - review.streak + 1;
    add({
      kind: 'streak',
      kicker: 'Longest streak',
      big: `${formatCount(review.streak)} days`,
      line: `in a row, from ${date(start)} to ${date(review.streakEnd)}`,
      bars: { values: counts, from: start - a, to: review.streakEnd - a },
    });
  }

  const peak = review.busiestDay.day;
  add({
    kind: 'peak',
    kicker: 'Busiest day',
    big: date(peak),
    line: `${contributions(review.busiestDay.count)}, on a ${LONG_WEEKDAYS[cal.dateOf(peak).getUTCDay()]}`,
    bars: { values: counts, from: peak - a, to: peak - a },
  });

  const month = review.months.indexOf(review.busiestMonth.total);
  add({
    kind: 'month',
    kicker: 'Biggest month',
    big: review.busiestMonth.name,
    line: `${contributions(review.busiestMonth.total)}, ${percent(review.busiestMonth.total, review.total)}% of your year`,
    bars: { values: review.months, from: month, to: month, labels: LONG_MONTHS.map((m) => m[0]) },
  });

  const weekday = review.weekdays.indexOf(review.busiestWeekday.total);
  add({
    kind: 'style',
    kicker: 'Your style',
    big: style.name,
    line: style.reason,
    bars: { values: review.weekdays, from: weekday, to: weekday, labels: LONG_WEEKDAYS.map((d) => d[0]) },
  });

  const reached = milestones.filter((m) => m.day >= a && m.day <= b);
  if (reached.length) {
    add({
      kind: 'badges',
      kicker: 'Badges',
      big: `${reached.length} new`,
      line: `${listed(reached.map((m) => m.name))}, reached in ${year}`,
      badges: reached.map((m) => m.id),
    });
  }

  add({
    kind: 'summary',
    kicker: cal.login,
    big: String(year),
    line: contributions(review.total),
    rows: [...reviewFacts(review, cal), ['Style', style.name]],
    bars: { values: weekly(counts), from: -1, to: -1 },
  });

  return {
    login: cal.login,
    year,
    link: `${origin.replace(/^https?:\/\//, '')}/${cal.login}/${year}`,
    site: origin.replace(/^https?:\/\//, ''),
    counts,
    startDay: cal.dateOf(a).getUTCDay(),
    cards,
  };
}

/** What a card says, in one sentence, for a screen reader and for the text shared with its picture. */
export const cardText = (card: StoryCard): string =>
  card.kind === 'opener' || card.kind === 'summary'
    ? `${card.kicker}: ${card.big}. ${card.line}.`
    : `${card.kicker}: ${card.big}, ${card.line}.`;
