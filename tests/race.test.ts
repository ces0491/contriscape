import { Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contributions } from '../shared/contract';
import { dailyPick, type Catalogue } from '../shared/explore';
import { Calendar } from '../src/calendar';
import { CELL, CityMap, TOWER } from '../src/map';
import { gapToTower, multiplier, NearMisses, nearPoints, NEAR_GAP } from '../src/near';
import {
  buildCourse,
  challengeHash,
  COUNTDOWN,
  dailyYear,
  decodeTrack,
  encodeTrack,
  FIRST_GATE,
  GATE_GAP,
  GATE_REACH,
  ghostAt,
  Race,
  RaceRecords,
  raceYears,
  readChallenge,
  readGhost,
  Recorder,
  rivalAt,
  saveGhost,
  throughGate,
  today,
  type Course,
  type GhostPose,
} from '../src/race';
import { newPose, poseAt } from '../src/routes';

const SNAPSHOT = '2026-11-02';
/** The widest a ship reaches from its centre line, at its scale in the scene, as the route tests hold it to. */
const SHIP_HALF_SPAN = 0.42;
const CRUISE = 17;
const BOOST = 46;

const daysIn = (y: number) => Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 864e5);
const dayOfYear = (date: string) => Math.round((Date.parse(date) - Date.UTC(Number(date.slice(0, 4)), 0, 1)) / 864e5);

const noise = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

function history(first: number, day: (year: number, dayOfYear: number) => number): Contributions {
  const years: Contributions['years'] = {};
  for (let y = first; y <= 2026; y++) {
    const length = y === 2026 ? dayOfYear(SNAPSHOT) + 1 : daysIn(y);
    years[String(y)] = Array.from({ length }, (_, d) => day(y, d));
  }
  return { login: 'fixture', name: null, snapshot: SNAPSHOT, years };
}

const dense = (seed: number) => {
  const r = noise(seed);
  return () => Math.floor(r() * r() * 60);
};

const FIXTURES: Record<string, Contributions> = {
  'one contribution ever': history(2023, (y, d) => (y === 2024 && d === 100 ? 1 : 0)),
  'joined this year': history(2026, dense(1)),
  'quiet for years, then busy': history(2019, (y, d) => (y >= 2025 && d % 3 ? 9 : 0)),
  'every day extremely busy': history(2014, dense(2)),
  'one enormous spike': history(2022, (y, d) => (y === 2025 && d === 200 ? 5000 : d % 9 ? 2 : 0)),
  'long history, 18 years': history(2009, dense(3)),
};

/** Shortest 3D gap from a point to any tower box nearby. */
function clearance(map: CityMap, p: Vector3): number {
  let min = Infinity;
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      const i = map.cellIndex(p.x + a * CELL, p.z + b * CELL);
      if (i < 0 || !map.cal.counts[i]) continue;
      const dx = Math.max(0, Math.abs(p.x - map.cx[i]) - TOWER / 2);
      const dz = Math.max(0, Math.abs(p.z - map.cz[i]) - TOWER / 2);
      const dy = Math.max(0, p.y - map.top[i]);
      min = Math.min(min, Math.hypot(dx, dz, dy));
    }
  }
  return min;
}

/** Flies a race down its own line at a steady speed, as a perfect pilot would, and gives the events in order. */
function flyLine(course: Course, speed: number, dt = 1 / 60) {
  const race = new Race(course);
  const pose = newPose();
  const from = new Vector3();
  const to = new Vector3();
  const events: ReturnType<Race['update']> = [];
  let s = 0;
  for (let n = 0; n < 1e5 && race.phase !== 'finished'; n++) {
    poseAt(course.route, s, pose);
    from.copy(pose.p);
    if (race.phase === 'racing') s = Math.min(course.route.len, s + speed * dt);
    poseAt(course.route, s, pose);
    to.copy(pose.p);
    events.push(...race.update(dt, from, to));
  }
  return { race, events };
}

describe.each(Object.entries(FIXTURES))('a race on %s', (_, data) => {
  const cal = new Calendar(data);
  const map = new CityMap(cal);
  const years = raceYears(cal);

  it('is run on each year with contributions, newest first', () => {
    expect(years.length).toBeGreaterThan(0);
    expect(years).toEqual([...years].sort((a, b) => b - a));
    for (const year of years) expect(cal.yearTotal(year)).toBeGreaterThan(0);
  });

  describe.each(years.slice(0, 3))('in %i', (year) => {
    const course = buildCourse(map, year);

    it('follows a line that clears every tower by more than a ship is wide', () => {
      for (const sample of course.route.samples) {
        expect(clearance(map, sample.p), `${sample.p.x.toFixed(1)},${sample.p.z.toFixed(1)}`).toBeGreaterThan(
          SHIP_HALF_SPAN,
        );
      }
    });

    it('starts west of the block on a straight, and goes down its alleys', () => {
      const start = course.route.samples[0].p;
      expect(start.x).toBeLessThan(-30);
      const block = map.blockZ(year);
      const inBlock = course.route.samples.filter(
        (s) => s.p.x > 0 && s.p.x < 120 && s.p.z > block && s.p.z < block + 17.5,
      );
      expect(inBlock.length * 0.25).toBeGreaterThan(100);
    });

    it('sets gates along it in order, a regular distance apart, with the finish at its end', () => {
      const { gates } = course;
      expect(gates.length).toBeGreaterThanOrEqual(5);
      expect(gates[0].s).toBe(FIRST_GATE);
      gates.slice(1).forEach((gate, i) => {
        expect(gate.s).toBeGreaterThan(gates[i].s);
        expect(gate.s - gates[i].s).toBeLessThanOrEqual(GATE_GAP * 1.5 + 1e-9);
      });
      expect(gates[gates.length - 1].s).toBeCloseTo(course.route.len - 1, 6);
      for (const gate of gates) expect(gate.normal.length()).toBeCloseTo(1, 6);
    });

    it('gives the rival a time a clean run at cruise loses to and a boosted one beats', () => {
      const pace = course.route.len / course.rivalTime;
      expect(pace).toBeGreaterThan(CRUISE * 0.9);
      expect(pace).toBeLessThan(BOOST * 0.6);
      // The rival reaches each gate in order, and the finish at the end of its time
      course.rivalSplits.slice(1).forEach((t, i) => expect(t).toBeGreaterThan(course.rivalSplits[i]));
      expect(course.rivalSplits[course.rivalSplits.length - 1]).toBeLessThanOrEqual(course.rivalTime);
      expect(rivalAt(course, course.rivalTime + 5)).toBeCloseTo(course.route.len, 6);
      expect(rivalAt(course, 0)).toBe(0);
    });

    it('is finished by flying its line, through every gate in turn, in the time the speed allows', () => {
      const speed = 30;
      const { race, events } = flyLine(course, speed);
      expect(events.slice(0, 4).map((e) => e.kind)).toEqual(['count', 'count', 'count', 'go']);
      expect(events.filter((e) => e.kind === 'count').map((e) => (e.kind === 'count' ? e.n : 0))).toEqual([3, 2, 1]);
      const gates = events.filter((e) => e.kind === 'gate');
      expect(gates.map((e) => (e.kind === 'gate' ? e.index : -1))).toEqual(course.gates.slice(0, -1).map((_, i) => i));
      const finish = events[events.length - 1];
      expect(finish.kind).toBe('finish');
      expect(race.phase).toBe('finished');
      expect(race.elapsed).toBeCloseTo((course.route.len - 1) / speed, 1);
      // Faster than the rival, so ahead at every gate
      expect(race.gap).toBeLessThan(0);
    });
  });
});

describe('a gate', () => {
  const gate = { s: 0, at: new Vector3(0, 5, 0), normal: new Vector3(1, 0, 0) };

  it('is passed by crossing it the right way within reach of its centre, however fast', () => {
    expect(throughGate(gate, new Vector3(-1, 5, 0), new Vector3(1, 5, 0))).toBeCloseTo(0.5, 6);
    expect(throughGate(gate, new Vector3(-90, 5, 1), new Vector3(10, 5, 1))).toBeCloseTo(0.9, 6);
    expect(
      throughGate(gate, new Vector3(-1, 5 + GATE_REACH * 0.99, 0), new Vector3(1, 5 + GATE_REACH * 0.99, 0)),
    ).not.toBeNull();
  });

  it('is not passed backwards, round the outside, or without reaching it', () => {
    expect(throughGate(gate, new Vector3(1, 5, 0), new Vector3(-1, 5, 0))).toBeNull();
    expect(
      throughGate(gate, new Vector3(-1, 5 + GATE_REACH * 1.01, 0), new Vector3(1, 5 + GATE_REACH * 1.01, 0)),
    ).toBeNull();
    expect(throughGate(gate, new Vector3(-2, 5, 0), new Vector3(-1, 5, 0))).toBeNull();
  });
});

describe('a race', () => {
  const cal = new Calendar(FIXTURES['every day extremely busy']);
  const course = buildCourse(new CityMap(cal), 2025);

  it('holds the clock at 0 through the countdown, and counts from the moment it ends', () => {
    const race = new Race(course);
    const here = course.route.samples[0].p;
    expect(race.count).toBe(3);
    race.update(COUNTDOWN - 0.01, here, here);
    expect(race.phase).toBe('countdown');
    expect(race.elapsed).toBe(0);
    expect(race.rivalS).toBe(0);
    const events = race.update(0.05, here, here);
    expect(events.map((e) => e.kind)).toContain('go');
    expect(race.elapsed).toBeCloseTo(0.04, 6);
    race.update(1, here, here);
    expect(race.rivalS).toBeGreaterThan(0);
  });

  it('counts only the next gate, so one flown past out of turn waits until the one before it is passed', () => {
    const race = new Race(course);
    const here = course.route.samples[0].p;
    race.update(COUNTDOWN + 0.1, here, here);
    const second = course.gates[1];
    const across = (gate: typeof second) => [
      gate.at.clone().addScaledVector(gate.normal, -0.5),
      gate.at.clone().addScaledVector(gate.normal, 0.5),
    ];
    const [a, b] = across(second);
    expect(race.update(0.1, a, b)).toEqual([]);
    expect(race.next).toBe(0);
    const [c, d] = across(course.gates[0]);
    expect(race.update(0.1, c, d)).toEqual([{ kind: 'gate', index: 0 }]);
    expect(race.update(0.1, a, b)).toEqual([{ kind: 'gate', index: 1 }]);
    expect(race.splits).toHaveLength(2);
  });
});

describe('near misses', () => {
  // One tower, 28 units tall, in the middle of an otherwise empty year
  const cal = new Calendar(history(2026, (_, d) => (d === 150 ? 9 : 0)));
  const map = new CityMap(cal);
  const day = cal.counts.findIndex((c) => c > 0);
  const roof = (i: number) => map.top[i];
  const x = map.cx[day];
  const z = map.cz[day];
  const wall = x + TOWER / 2;

  /** Flies past the tower's east wall, northwards, at a gap from it and a speed. */
  const passBy = (near: NearMisses, gap: number, speed: number) => {
    for (let k = -40; k <= 40; k++) near.update(1 / 60, map, roof, wall + gap, 3, z + k * 0.1, speed);
  };

  it('scores more for passing closer and faster, and nothing outside the gap or below the speed', () => {
    expect(nearPoints(0.6, 17)).toBeGreaterThan(nearPoints(0.8, 17));
    expect(nearPoints(0.6, 34)).toBeCloseTo(nearPoints(0.6, 17) * 2, 6);
    expect(nearPoints(NEAR_GAP, 17)).toBe(0);
    expect(nearPoints(0.5, 5)).toBe(0);
    expect(gapToTower(map, roof, day, wall + 0.5, 3, z)).toBeCloseTo(0.5, 6);
    expect(gapToTower(map, roof, day, x, map.top[day] + 0.4, z)).toBeCloseTo(0.4, 6);
  });

  it('counts a tower once, at its closest, after the ship has left it behind', () => {
    const near = new NearMisses();
    passBy(near, 0.5, 17);
    expect(near.count).toBe(1);
    expect(near.chain).toBeCloseTo(nearPoints(0.5, 17), 6);
    passBy(near, 0.4, 17);
    expect(near.count).toBe(1);
  });

  it('banks a chain once it goes quiet, multiplied by its length', () => {
    const near = new NearMisses();
    passBy(near, 0.5, 17);
    const chain = near.chain;
    for (let n = 0; n < 130; n++) near.update(1 / 60, map, roof, -50, 3, -50, 17);
    expect(near.score).toBe(Math.round(chain * multiplier(1)));
    expect(near.chain).toBe(0);
    expect(multiplier(11)).toBeCloseTo(2, 6);
    expect(multiplier(100)).toBe(3);
  });

  it('banks a chain that reaches its top multiplier, without waiting for it to go quiet', () => {
    // A long row of towers, flown past one after another
    const row = new CityMap(new Calendar(history(2026, (_, d) => (d % 7 === 3 ? 9 : 0))));
    const near = new NearMisses();
    const days = [...row.cal.counts.keys()].filter((d) => row.cal.counts[d] > 0);
    const lane = row.cz[days[0]] + TOWER / 2 + 0.5;
    for (let x = 0; x < 130; x += 0.2) near.update(1 / 60, row, (i) => row.top[i], x, 3, lane, 17);
    expect(days.length).toBeGreaterThan(30);
    expect(near.score).toBeGreaterThan(0);
    expect(near.count).toBeLessThan(21);
  });

  it('loses the chain to a clip', () => {
    const near = new NearMisses();
    passBy(near, 0.5, 17);
    expect(near.clip(day)).toBeGreaterThan(0);
    expect(near.chain).toBe(0);
    expect(near.count).toBe(0);
    near.bank();
    expect(near.score).toBe(0);
  });
});

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

describe('what races leave in the browser', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the fastest time and the highest score for each year and ship', () => {
    const records = new RaceRecords('Octo-Dev');
    expect(records.record(2025, 'rocket', 40, 900, false)).toEqual({ fastest: true, highest: true });
    expect(records.record(2025, 'rocket', 44, 1200, true)).toEqual({ fastest: false, highest: true });
    expect(records.record(2025, 'rocket', 38, 100, false)).toEqual({ fastest: true, highest: false });
    const again = new RaceRecords('octo-dev');
    expect(again.best(2025, 'rocket')).toEqual({ time: 38, points: 1200, won: true });
    expect(again.best(2025, 'saucer')).toBeNull();
    expect(again.won(2025)).toBe(true);
    expect(again.won(2024)).toBe(false);
  });

  it('ignores whatever else is stored under its name', () => {
    localStorage.setItem(
      'contriscape:race:octo-dev',
      JSON.stringify({
        2025: { rocket: { time: -1, points: 1, won: false }, teapot: { time: 1, points: 1, won: true } },
        x: 1,
      }),
    );
    expect(new RaceRecords('octo-dev').best(2025, 'rocket')).toBeNull();
    localStorage.setItem('contriscape:race:octo-dev', 'not json');
    expect(new RaceRecords('octo-dev').best(2025, 'rocket')).toBeNull();
  });

  it('records a run ten times a second, and reads it back as it was flown', () => {
    const recorder = new Recorder();
    for (let n = 0; n <= 120; n++) {
      const t = n / 60;
      recorder.note(t, t * 10, 5, -t * 3, 3.1 + t, 0.2, -0.4);
    }
    const track = recorder.finish(2) as Float32Array;
    expect(track.length / 6).toBe(21);
    const back = decodeTrack(encodeTrack(track)) as Float32Array;
    const pose: GhostPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0 };
    expect(ghostAt(back, 1.05, pose)).toBe(true);
    expect(pose.x).toBeCloseTo(10.5, 1);
    expect(pose.z).toBeCloseTo(-3.15, 1);
    expect(pose.pitch).toBeCloseTo(0.2, 3);
    // The heading is kept as an angle, so a turn past half a circle comes back the short way round
    expect(Math.cos(pose.yaw)).toBeCloseTo(Math.cos(3.1 + 1.05), 2);
    expect(ghostAt(back, 2.5, pose)).toBe(false);
    expect(decodeTrack('not base64!')).toBeNull();
  });

  it('keeps no ghost of a run longer than three minutes', () => {
    const recorder = new Recorder();
    recorder.note(0, 0, 0, 0, 0, 0, 0);
    expect(recorder.finish(181)).toBeNull();
  });

  it('keeps a ghost per city, year and ship, and lets the oldest go when there are too many', () => {
    const recorder = new Recorder();
    recorder.note(0, 1, 2, 3, 0, 0, 0);
    recorder.note(0.2, 1, 2, 3, 0, 0, 0);
    const track = recorder.finish(0.2) as Float32Array;
    saveGhost('octo-dev', 2025, 'rocket', track);
    expect(readGhost('Octo-Dev', 2025, 'rocket')?.length).toBe(track.length);
    expect(readGhost('octo-dev', 2025, 'dart')).toBeNull();
    for (let n = 0; n < 20; n++) saveGhost(`other-${n}`, 2025, 'rocket', track);
    expect(readGhost('octo-dev', 2025, 'rocket')).toBeNull();
    expect(readGhost('other-19', 2025, 'rocket')).not.toBeNull();
  });
});

describe('a challenge link', () => {
  const cal = new Calendar(FIXTURES['every day extremely busy']);
  const years = raceYears(cal);

  it('sets a year, a time to beat and the ship it was set in, and reads back the same', () => {
    const hash = challengeHash(2025, 41.234, 'rocket');
    expect(hash).toBe('#race=2025&beat=41.2&ship=rocket');
    expect(readChallenge(hash, years, cal, 'fixture')).toEqual({ year: 2025, beat: 41.2, ship: 'rocket', daily: null });
  });

  it('ignores a year this city has no race for, and a time or ship that is no use', () => {
    expect(readChallenge('#race=1999&beat=40', years, cal, 'fixture')).toBeNull();
    expect(readChallenge('#race=2025&beat=-3&ship=teapot', years, cal, 'fixture')).toEqual({
      year: 2025,
      beat: null,
      ship: null,
      daily: null,
    });
    expect(readChallenge('#race=2025&beat=99999', years, cal, 'fixture')?.beat).toBeNull();
    expect(readChallenge('#your-year', years, cal, 'fixture')).toBeNull();
    expect(readChallenge('', years, cal, 'fixture')).toBeNull();
  });

  it("sets the day's course on a busy year, the same one for everyone on the same day", () => {
    const one = readChallenge('#daily=2026-11-20', years, cal, 'fixture');
    expect(one?.daily).toBe('2026-11-20');
    expect(years).toContain(one?.year);
    expect(readChallenge('#daily=2026-11-20', years, cal, 'FIXTURE')).toEqual(one);
    expect(readChallenge('#daily=20-11-2026', years, cal, 'fixture')).toBeNull();
    const picked = new Set(
      Array.from({ length: 30 }, (_, d) => dailyYear(cal, `2026-12-${String(d + 1).padStart(2, '0')}`, 'fixture')),
    );
    expect(picked.size).toBeGreaterThan(1);
    expect(dailyYear(new Calendar(history(2025, () => 0)), '2026-11-20', 'fixture')).toBeNull();
  });
});

describe("the day's course", () => {
  const catalogue: Catalogue = {
    generated: '2026-11-02',
    groups: [
      {
        id: 'one',
        title: 'One',
        blurb: 'First',
        people: ['a', 'b', 'c'].map((login) => ({ login, name: null, about: '' })),
      },
      {
        id: 'two',
        title: 'Two',
        blurb: 'Second',
        people: ['b', 'd'].map((login) => ({ login, name: null, about: '' })),
      },
    ],
  };

  it('picks the same city all day, and different cities on different days', () => {
    expect(dailyPick(catalogue, '2026-11-20')).toEqual(dailyPick(catalogue, '2026-11-20'));
    const picked = new Set(
      Array.from(
        { length: 40 },
        (_, d) => dailyPick(catalogue, today(new Date(Date.UTC(2026, 0, d + 1)))).person.login,
      ),
    );
    expect(picked).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('takes the day in UTC', () => {
    expect(today(new Date('2026-11-20T23:30:00-05:00'))).toBe('2026-11-21');
  });
});
