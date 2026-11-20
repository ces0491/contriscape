import { Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contributions } from '../shared/contract';
import { AttackRecords, buildAttack, GRACE, PAR_PACE, TimeAttack, type AttackCourse } from '../src/attack';
import { Calendar } from '../src/calendar';
import { CELL, CityMap, TOWER, WIDTH } from '../src/map';
import { COUNTDOWN, GATE_RADIUS, raceYears } from '../src/race';
import { newPose, poseAt } from '../src/routes';

const SNAPSHOT = '2026-11-02';
/** The widest a ship reaches from its centre line, at its scale in the scene, as the route tests hold it to. */
const SHIP_HALF_SPAN = 0.42;
/** What Pilot's ship can do: its speeds, how fast it turns and pitches, and the size it hits towers at. */
const CRUISE = 17;
const TURN_RATE = 2;
const PITCH_RATE = 1.5;
const MAX_PITCH = 1.3;
const SHIP_RADIUS = 0.3;

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

/** Runs a time attack down its own line at a steady speed, as a perfect pilot would. */
function flyLine(course: AttackCourse, speed: number, dt = 1 / 60) {
  const attack = new TimeAttack(course);
  const pose = newPose();
  const from = new Vector3();
  const to = new Vector3();
  const events: ReturnType<TimeAttack['update']> = [];
  let s = 0;
  for (let n = 0; n < 1e5 && (attack.phase === 'countdown' || attack.phase === 'racing'); n++) {
    poseAt(course.route, s, pose);
    from.copy(pose.p);
    if (attack.phase === 'racing') s = Math.min(course.route.len, s + speed * dt);
    poseAt(course.route, s, pose);
    to.copy(pose.p);
    events.push(...attack.update(dt, from, to));
  }
  return { attack, events };
}

/**
 * Flies a time attack as a pilot held to the ship's turn and pitch rates would: steering at a point a little way along
 * the line, at a steady speed. Gives how it ended, and how many times the ship clipped a tower.
 */
function flyAsShip(map: CityMap, course: AttackCourse, speed: number) {
  const S = course.route.samples;
  const attack = new TimeAttack(course);
  const pos = S[0].p.clone();
  const start = S[8].p.clone().sub(S[0].p).normalize();
  let yaw = Math.atan2(-start.x, -start.z);
  let pitch = Math.asin(start.y);
  let near = 0;
  let clips = 0;
  let touching = false;
  const from = new Vector3();
  const dt = 1 / 60;
  const ahead = Math.round(10 / 0.25);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const step = (value: number, goal: number, rate: number) => value + Math.max(-rate * dt, Math.min(rate * dt, goal));
  for (let n = 0; n < 1e5 && (attack.phase === 'countdown' || attack.phase === 'racing'); n++) {
    from.copy(pos);
    if (attack.phase === 'racing') {
      for (let i = near; i < Math.min(S.length, near + 200); i++) {
        if (S[i].p.distanceToSquared(pos) < S[near].p.distanceToSquared(pos)) near = i;
      }
      const aim = S[Math.min(S.length - 1, near + ahead)].p;
      const dx = aim.x - pos.x;
      const dz = aim.z - pos.z;
      yaw = step(yaw, wrap(Math.atan2(-dx, -dz) - yaw), TURN_RATE);
      pitch = step(pitch, Math.atan2(aim.y - pos.y, Math.hypot(dx, dz)) - pitch, PITCH_RATE);
      pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
      pos.x -= Math.sin(yaw) * Math.cos(pitch) * speed * dt;
      pos.y += Math.sin(pitch) * speed * dt;
      pos.z -= Math.cos(yaw) * Math.cos(pitch) * speed * dt;
      const hit = clearance(map, pos) < SHIP_RADIUS;
      if (hit && !touching) clips++;
      touching = hit;
    }
    attack.update(dt, from, pos);
  }
  return { attack, clips };
}

describe.each(Object.entries(FIXTURES))('a time attack on %s', (_, data) => {
  const cal = new Calendar(data);
  const map = new CityMap(cal);

  describe.each(raceYears(cal).slice(0, 3))('in %i', (year) => {
    const course = buildAttack(map, year);
    const { gates, kinds } = course;

    it('follows a line that clears every tower by more than a ship is wide', () => {
      for (const sample of course.route.samples) {
        expect(Number.isFinite(sample.p.x + sample.p.y + sample.p.z)).toBe(true);
        expect(clearance(map, sample.p), `${sample.p.x.toFixed(1)},${sample.p.z.toFixed(1)}`).toBeGreaterThan(
          SHIP_HALF_SPAN,
        );
      }
    });

    it('starts west of the block, goes out to its east end and back, and finishes near the start', () => {
      const { samples } = course.route;
      const start = samples[0].p;
      const finish = samples[samples.length - 1].p;
      expect(start.x).toBeLessThan(-30);
      expect(Math.max(...samples.map((s) => s.p.x))).toBeGreaterThan(WIDTH);
      expect(finish.x).toBeLessThan(0);
      expect(finish.x).toBeGreaterThan(start.x);
    });

    it('sets a dozen rings or more on the line, in order, with the finish at its end', () => {
      expect(gates.length).toBeGreaterThanOrEqual(12);
      expect(kinds).toHaveLength(gates.length);
      expect(kinds.filter((kind) => kind === 'turn')).toHaveLength(1);
      expect(kinds[kinds.length - 1]).toBe('finish');
      gates.slice(1).forEach((gate, i) => expect(gate.s).toBeGreaterThan(gates[i].s + 5));
      expect(gates[gates.length - 1].s).toBeCloseTo(course.route.len - 1, 6);
      for (const gate of gates) expect(gate.normal.length()).toBeCloseTo(1, 6);
    });

    it('sets a ring over the roofs clear of the row it crosses', () => {
      gates.forEach((gate, i) => {
        if (kinds[i] !== 'over') return;
        let roof = 0;
        map.towersNear(gate.at.x, gate.at.z, SHIP_HALF_SPAN, (day) => {
          roof = Math.max(roof, map.top[day]);
        });
        expect(gate.at.y - roof).toBeGreaterThan(GATE_RADIUS);
      });
    });

    it('gives a run at cruise too little time, and one a little faster enough', () => {
      expect(course.start).toBeCloseTo(gates[0].s / PAR_PACE + GRACE, 6);
      const slow = flyLine(course, CRUISE);
      expect(slow.attack.phase).toBe('out');
      expect(slow.events[slow.events.length - 1]).toEqual({ kind: 'out', reached: slow.attack.next });
      const quick = flyLine(course, 24);
      expect(quick.attack.phase).toBe('finished');
      expect(quick.attack.next).toBe(gates.length);
      expect(quick.attack.left).toBeGreaterThan(GRACE);
    });

    it('can be finished by a ship that turns and pitches no faster than Pilot lets it', () => {
      const { attack, clips } = flyAsShip(map, course, 24);
      expect(attack.phase).toBe('finished');
      // Scraping a wall costs speed, which a ship flown this steadily doesn't make up for
      expect(clips).toBeLessThanOrEqual(8);
    });
  });
});

describe('the alleys of a busy year', () => {
  const cal = new Calendar(FIXTURES['every day extremely busy']);
  const map = new CityMap(cal);

  it.each([2026, 2025, 2024])('set low rings between the towers in %i, with walls above them on both sides', (year) => {
    const { gates, kinds } = buildAttack(map, year);
    const low = gates.filter((_, i) => kinds[i] === 'low');
    const between = low.filter((gate) => {
      const sides = [-1, 1].map((side) => map.cellIndex(gate.at.x, gate.at.z + (side * CELL) / 2));
      return sides.every((day) => day >= 0 && map.top[day] > gate.at.y);
    });
    expect(low.length).toBeGreaterThanOrEqual(6);
    expect(between.length / low.length).toBeGreaterThan(0.6);
  });
});

describe('a time attack', () => {
  const cal = new Calendar(FIXTURES['every day extremely busy']);
  const course = buildAttack(new CityMap(cal), 2025);
  const across = (index: number) => {
    const { at, normal } = course.gates[index];
    return [at.clone().addScaledVector(normal, -0.5), at.clone().addScaledVector(normal, 0.5)] as const;
  };
  const started = () => {
    const attack = new TimeAttack(course);
    const here = course.route.samples[0].p;
    attack.update(COUNTDOWN, here, here);
    attack.update(0.001, here, here);
    return attack;
  };

  it('holds the clock through the countdown, then runs it down', () => {
    const attack = new TimeAttack(course);
    const here = course.route.samples[0].p;
    expect(attack.count).toBe(3);
    const counted = attack.update(COUNTDOWN - 0.01, here, here);
    expect(counted).toEqual([{ kind: 'count', n: 3 }]);
    expect(attack.left).toBe(course.start);
    expect(attack.update(0.05, here, here).map((e) => e.kind)).toContain('go');
    expect(attack.left).toBeCloseTo(course.start - 0.04, 6);
    attack.update(1, here, here);
    expect(attack.left).toBeCloseTo(course.start - 1.04, 6);
    expect(attack.elapsed).toBeCloseTo(1.04, 6);
  });

  it('adds a ring’s time when it is passed, and counts only the next ring', () => {
    const attack = started();
    const [a, b] = across(1);
    expect(attack.update(0.1, a, b)).toEqual([]);
    expect(attack.next).toBe(0);
    const before = attack.left;
    const [c, d] = across(0);
    expect(attack.update(0.1, c, d)).toEqual([{ kind: 'gate', index: 0, bonus: course.bonus[0] }]);
    expect(attack.left).toBeCloseTo(before - 0.1 + course.bonus[0], 6);
    expect(course.bonus[0]).toBeCloseTo((course.gates[1].s - course.gates[0].s) / PAR_PACE, 6);
    expect(attack.update(0.1, a, b)).toEqual([{ kind: 'gate', index: 1, bonus: course.bonus[1] }]);
  });

  it('ends when the clock runs out, with the rings reached', () => {
    const attack = started();
    const here = course.route.samples[0].p;
    const events = attack.update(course.start + 1, here, here);
    expect(events).toEqual([{ kind: 'out', reached: 0 }]);
    expect(attack.phase).toBe('out');
    expect(attack.left).toBe(0);
    expect(attack.update(1, ...across(0))).toEqual([]);
  });

  it('counts a ring reached in the frame the clock runs out, if it was reached before the clock ran out', () => {
    const run = (share: number) => {
      const attack = started();
      const here = course.route.samples[0].p;
      attack.update(attack.left - 0.1, here, here);
      // The ring is crossed `share` of the way through a frame of 0.2 s, half of which has time left on the clock
      const { at, normal } = course.gates[0];
      const from = at.clone().addScaledVector(normal, -share);
      const to = at.clone().addScaledVector(normal, 1 - share);
      return attack.update(0.2, from, to).map((e) => e.kind);
    };
    expect(run(0.25)).toEqual(['gate']);
    expect(run(0.75)).toEqual(['out']);
  });

  it('stops the clock at the finish, with what is left on it', () => {
    const { attack, events } = flyLine(course, 30);
    const finish = events[events.length - 1];
    expect(finish.kind).toBe('finish');
    expect(attack.phase).toBe('finished');
    if (finish.kind === 'finish') {
      expect(finish.left).toBeCloseTo(attack.left, 6);
      expect(finish.time).toBeCloseTo(attack.elapsed, 6);
    }
    // At a steady speed the line takes its length over that speed, and the clock has had its par for the same length
    expect(attack.left).toBeCloseTo(course.start + course.bonus.reduce((a, b) => a + b, 0) - attack.elapsed, 1);
  });
});

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

describe('what time attacks leave in the browser', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the most rings reached and the most time left for each year and ship', () => {
    const records = new AttackRecords('Octo-Dev');
    expect(records.record(2025, 'dart', 9, null)).toEqual({ most: true, quickest: false });
    expect(records.record(2025, 'dart', 7, null)).toEqual({ most: false, quickest: false });
    expect(records.finished(2025)).toBe(false);
    expect(records.record(2025, 'dart', 16, 2.5)).toEqual({ most: true, quickest: true });
    expect(records.record(2025, 'dart', 16, 1.2)).toEqual({ most: false, quickest: false });
    expect(records.record(2025, 'dart', 16, 4)).toEqual({ most: false, quickest: true });
    const again = new AttackRecords('octo-dev');
    expect(again.best(2025, 'dart')).toEqual({ rings: 16, left: 4 });
    expect(again.best(2025, 'brick')).toBeNull();
    expect(again.finished(2025)).toBe(true);
    expect(again.finished(2024)).toBe(false);
  });

  it('ignores whatever else is stored under its name', () => {
    localStorage.setItem(
      'contriscape:attack:octo-dev',
      JSON.stringify({ 2025: { dart: { rings: -1, left: null }, teapot: { rings: 3, left: 1 } }, x: 1 }),
    );
    expect(new AttackRecords('octo-dev').best(2025, 'dart')).toBeNull();
    localStorage.setItem('contriscape:attack:octo-dev', 'not json');
    expect(new AttackRecords('octo-dev').best(2025, 'dart')).toBeNull();
  });
});
