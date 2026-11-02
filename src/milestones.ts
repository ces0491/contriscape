import { formatCount, type Calendar } from './calendar';

/** A dated moment in a user's history. These are our own: GitHub offers no API for its achievements. */
export interface Milestone {
  id: string;
  name: string;
  detail: string;
  day: number;
}

const TOTALS: [number, string, string][] = [
  [100, 'hundred-club', 'Hundred Club'],
  [1000, 'thousand-club', 'Thousand Club'],
  [10000, 'ten-thousand-club', 'Ten Thousand Club'],
];
const FULL_WEEK = 7;

export function findMilestones(cal: Calendar): Milestone[] {
  const found: Milestone[] = [];
  const add = (id: string, name: string, detail: string, day: number | null) => {
    if (day !== null) found.push({ id, name, detail, day });
  };

  add('joined', 'Day One', 'Joined GitHub', cal.dayFromDate(cal.firsts.joined));
  add('first-repository', 'Cornerstone', 'First repository created', cal.dayFromDate(cal.firsts.repository));
  add('first-pull-request', 'Opening Move', 'First pull request', cal.dayFromDate(cal.firsts.pullRequest));
  add('first-issue', 'Speaking Up', 'First issue opened', cal.dayFromDate(cal.firsts.issue));

  const { counts, days } = cal;
  const first = counts.findIndex((c) => c > 0);
  if (first < 0) return found.sort((a, b) => a.day - b.day);
  add('first-contribution', 'Ground Broken', 'First contribution', first);

  for (const [total, id, name] of TOTALS) {
    if (cal.total < total) continue;
    let day = first;
    while (cal.sum(0, day) < total) day++;
    add(id, name, `Contribution number ${formatCount(total)}`, day);
  }

  let run = 0;
  for (let i = 0; i < days; i++) {
    run = counts[i] ? run + 1 : 0;
    if (run === FULL_WEEK) {
      add('full-week', 'Full Week', 'First seven days in a row', i);
      break;
    }
  }

  const streak = cal.longestStreak(0, days - 1);
  if (streak.length >= FULL_WEEK) {
    add('longest-streak', 'Long Haul', `Longest streak, ${formatCount(streak.length)} days in a row`, streak.end);
  }

  const peak = counts.indexOf(cal.peak);
  add('busiest-day', 'Summit', `Busiest day, ${formatCount(cal.peak)} contributions`, peak);

  return found.sort((a, b) => a.day - b.day);
}
