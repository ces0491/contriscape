import { Vector3 } from 'three';
import { readShip, SHIPS, type Ship } from './fighter';
import { CELL, PLINTH, ROWS, WIDTH, type CityMap } from './map';
import { COUNTDOWN, GATE_RADIUS, throughGate, type Gate } from './race';
import { newPose, poseAt, sampled, type Route, type Shape, type Waypoint } from './routes';

/**
 * The pace the clock allows. Each ring adds the time the stretch to the next one takes at this speed, so a run that
 * averages less loses time. Pilot cruises at 17 and boosts at 46.
 */
export const PAR_PACE = 21;
/** Seconds on the clock at the start beyond what the first stretch takes at that pace, for getting up to speed. */
export const GRACE = 3;
/** Where a time attack starts, west of its block as a race does, so the ship is up to speed for the first ring. */
const START_X = -36;
/** Where it finishes, on the straight back out of the block to the west. */
const FINISH_X = -14;
/** A low run down an alley, level, with its ring in the middle. */
const LOW_RUN = 16;
/** A low ring sits this share of the way up the lower wall beside it, and no lower or higher than these. */
const LOW_SHARE = 0.4;
const LOW_FLOOR = 2.2;
const LOW_CAP = 5;
/** A high ring, up an alley whose roofs are too tall to hop, sits this share of the way up its lower wall. */
const HIGH_SHARE = 0.75;
/** A high ring is at least this far above the low run before it, and no higher than the cap. */
const HIGH_RISE = 3;
const HIGH_CAP = 12;
/** A ring over the roofs clears the highest it crosses by this, so the whole ring is above them. */
const OVER_ROOFS = GATE_RADIUS + 0.5;
/** A hop is only made over roofs this low, so it never climbs the busiest towers. Above it, the ring goes up the alley. */
const HOP_CAP = 20;
/** Units up or down for each unit along, climbing out of a low run or dropping into one. */
const SLOPE = 0.7;
/** Units along a hop takes at the top to move across from one alley to the next. */
const ACROSS = 8;
/** A hop can start this many weeks further down the alley, to cross where the roofs are lower. */
const HOP_SEARCH = 10;
/** Waypoints along a straight are no further apart than this, so the line doesn't bow out of its alley between them. */
const STRAIGHT = 4;
/** The turn for home loops round past the east end of the block, at a radius a ship at cruise can hold. */
const TURN_RADIUS = 9;
/** Alleys between the way out and the way back at the turn, so it is wide enough to fly round. */
const TURN_ALLEYS = 3;
/** A time attack's line is sharper than Autopilot's, because a pilot flies it and no camera rides it. */
const SHARP: Shape = { turn: 1, lift: 1, climb: 0.8 };

export type RingKind = 'low' | 'high' | 'over' | 'turn' | 'finish';

export interface AttackCourse {
  year: number;
  route: Route;
  /** The rings in order. The last is the finish. */
  gates: Gate[];
  /** Where each ring is: low down an alley, high up one, over the roofs, or round the turn for home. */
  kinds: RingKind[];
  /** Seconds on the clock at the start. */
  start: number;
  /** Seconds each ring adds as it is passed. The finish adds none. */
  bonus: number[];
}

interface Planned {
  at: Vector3;
  kind: RingKind;
}

/**
 * Plans a year's time attack: in from the west, east through the block, round a loop past the far end, and back west
 * through it to finish where it started. Each way it weaves, between rings low down an alley and rings over the roofs
 * of the row beside it, hopping across to the next alley. Where the roofs are too tall to hop, the ring is high up the
 * alley's own walls instead.
 */
function plan(map: CityMap, year: number): { wp: Waypoint[]; rings: Planned[] } {
  const { cal } = map;
  const { b } = cal.span(year);
  const block = map.blockZ(year);
  const alley = (a: number) => block + a * CELL;
  const wp: Waypoint[] = [];
  const rings: Planned[] = [];
  const at = (x: number, y: number, z: number) => wp.push({ x, y, z, day: b, pace: PAR_PACE, gaze: 0 });

  const weeks = (x0: number, x1: number) => {
    const out: number[] = [];
    for (let w = Math.floor(Math.min(x0, x1) / CELL); w <= Math.floor(Math.max(x0, x1) / CELL); w++) out.push(w);
    return out;
  };
  /** The lower of an alley's two walls, on average over a stretch of it. */
  const wall = (a: number, x0: number, x1: number) => {
    const span = weeks(x0, x1);
    const sum = span.reduce((total, w) => total + Math.min(map.heightAt(year, w, a - 1), map.heightAt(year, w, a)), 0);
    return PLINTH + sum / span.length;
  };
  const low = (a: number, x0: number, x1: number) =>
    Math.min(LOW_CAP, Math.max(LOW_FLOOR, LOW_SHARE * wall(a, x0, x1)));
  /** The highest roof on the rows between two alleys, over a stretch. */
  const roofs = (a0: number, a1: number, x0: number, x1: number) => {
    let top = 0;
    for (const w of weeks(x0, x1)) {
      for (let r = Math.min(a0, a1); r < Math.max(a0, a1); r++) top = Math.max(top, PLINTH + map.heightAt(year, w, r));
    }
    return top;
  };

  /** Weaves along the block from `x` to `end`, starting down alley `a`, and gives the alley and height it ends on. */
  const weave = (dir: 1 | -1, start: number, end: number, first: number, turn: 1 | -1) => {
    let x = start;
    let a = first;
    let step = turn;
    let y = low(a, x, x + dir * LOW_RUN);
    at(x, y, alley(a));
    /** On to `x1` down the alley, from the height the line is at to `y1`, easing between them. */
    const along = (x1: number, y1: number, z1 = alley(a)) => {
      const x0 = x;
      const y0 = y;
      const z0 = wp[wp.length - 1].z;
      const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / STRAIGHT));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const ease = t * t * (3 - 2 * t);
        at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * ease, z0 + (z1 - z0) * ease);
      }
      x = x1;
      y = y1;
    };
    /** How far along a climb or drop between two heights takes. */
    const ramp = (from: number, to: number) => Math.abs(to - from) / SLOPE;
    const left = (length: number) => dir * (end - x) >= length;

    for (;;) {
      along(x + (dir * LOW_RUN) / 2, y);
      rings.push({ at: new Vector3(x, y, alley(a)), kind: 'low' });
      along(x + (dir * LOW_RUN) / 2, y);

      // Over the row beside it to the next alley, where the roofs are low enough and soon enough
      if (a + step < 1 || a + step > ROWS - 1) step = step > 0 ? -1 : 1;
      const next = a + step;
      let hop: { wait: number; top: number; up: number; down: number; after: number } | null = null;
      for (let wait = 0; wait <= HOP_SEARCH; wait++) {
        const from = x + dir * wait * CELL;
        const reach = ramp(y, HOP_CAP) + ACROSS;
        const top = roofs(a, next, from, from + dir * reach) + OVER_ROOFS;
        if (top > HOP_CAP + OVER_ROOFS) continue;
        const up = ramp(y, top);
        const after = low(next, from + dir * (up + ACROSS), from + dir * (up + ACROSS + LOW_RUN));
        const down = ramp(top, after);
        if (!hop || top < hop.top) hop = { wait, top, up, down, after };
      }
      if (hop && left(hop.wait * CELL + hop.up + ACROSS + hop.down + LOW_RUN)) {
        along(x + dir * hop.wait * CELL, y);
        along(x + dir * hop.up, hop.top);
        const middle = new Vector3(x + (dir * ACROSS) / 2, hop.top, (alley(a) + alley(next)) / 2);
        along(x + dir * ACROSS, hop.top, alley(next));
        rings.push({ at: middle, kind: 'over' });
        a = next;
        along(x + dir * hop.down, hop.after);
        continue;
      }

      // Or up the walls of this alley and down again
      const high = Math.min(HIGH_CAP, Math.max(y + HIGH_RISE, HIGH_SHARE * wall(a, x, x + dir * 2 * LOW_RUN)));
      const after = low(a, x + dir * 2 * ramp(y, high), x + dir * (2 * ramp(y, high) + LOW_RUN));
      if (!left(ramp(y, high) + ramp(high, after) + LOW_RUN)) break;
      along(x + dir * ramp(y, high), high);
      rings.push({ at: new Vector3(x, high, alley(a)), kind: 'high' });
      along(x + dir * ramp(high, after), after);
    }
    along(end, y);
    return { a, y };
  };

  const first = 2 + (year % 2);
  const y0 = low(first, 0, LOW_RUN);
  for (let x = START_X; x < 0; x += STRAIGHT) at(x, y0, alley(first));
  const out = weave(1, 0, WIDTH + 2, first, 1);

  // Round a loop past the east end, out over open ground, and back into the block three alleys over
  const home = out.a + TURN_ALLEYS <= ROWS - 1 ? out.a + TURN_ALLEYS : out.a - TURN_ALLEYS;
  const back = low(home, WIDTH, WIDTH - LOW_RUN);
  const x0 = WIDTH + 2;
  const x1 = x0 + STRAIGHT * 2;
  const z0 = alley(out.a);
  const z1 = alley(home);
  const zc = (z0 + z1) / 2;
  const h = Math.sign(z1 - z0);
  const loop: [number, number][] = [
    [x1 + TURN_RADIUS / 2, z0 - 2 * h],
    ...[-90, -45, 0, 45, 90].map((deg): [number, number] => {
      const t = (deg * Math.PI) / 180;
      return [x1 + TURN_RADIUS * (1 + Math.cos(t)), zc + h * TURN_RADIUS * Math.sin(t)];
    }),
    [x1 + TURN_RADIUS / 2, z1 + 2 * h],
  ];
  // It swings out and back in clear of the block, so the line is straight down each alley by the time it meets towers
  at(x1, out.y, z0);
  loop.forEach(([x, z], k) => {
    const y = out.y + ((back - out.y) * (k + 1)) / (loop.length + 1);
    at(x, y, z);
    if (k === 3) rings.push({ at: new Vector3(x, y, z), kind: 'turn' });
  });
  at(x1, back, z1);
  const end = weave(-1, x0, -2, home, home > out.a ? -1 : 1);
  for (let x = -2 - STRAIGHT; x > FINISH_X; x -= STRAIGHT) at(x, end.y, alley(end.a));
  at(FINISH_X, end.y, alley(end.a));
  return { wp, rings };
}

/** A year's time attack: its line, the rings along it, and the time on the clock. */
export function buildAttack(map: CityMap, year: number): AttackCourse {
  const { wp, rings } = plan(map, year);
  const route = sampled(map, wp, new Vector3(), SHARP);
  const pose = newPose();
  const ahead = newPose();
  const gateAt = (s: number): Gate => {
    poseAt(route, s, pose);
    poseAt(route, Math.min(route.len, s + 1), ahead);
    const normal = ahead.p.clone().sub(pose.p);
    if (normal.lengthSq() < 1e-9) normal.set(-1, 0, 0);
    return { s, at: pose.p.clone(), normal: normal.normalize() };
  };

  // Each ring stands on the line where it comes nearest the planned spot, taken in order along it
  const gates: Gate[] = [];
  const kinds: RingKind[] = [];
  const { samples } = route;
  let from = 0;
  for (const ring of rings) {
    let best = from;
    for (let i = from; i < samples.length; i++) {
      if (samples[i].p.distanceToSquared(ring.at) < samples[best].p.distanceToSquared(ring.at)) best = i;
      // Far enough past the spot to have left it behind
      if (samples[i].len > samples[best].len + LOW_RUN * 2) break;
    }
    gates.push(gateAt(samples[best].len));
    kinds.push(ring.kind);
    from = best + 1;
  }
  gates.push(gateAt(route.len - 1));
  kinds.push('finish');

  const bonus = gates.map((gate, i) => (i + 1 < gates.length ? (gates[i + 1].s - gate.s) / PAR_PACE : 0));
  return { year, route, gates, kinds, start: gates[0].s / PAR_PACE + GRACE, bonus };
}

export type AttackEvent =
  | { kind: 'count'; n: number }
  | { kind: 'go' }
  | { kind: 'gate'; index: number; bonus: number }
  | { kind: 'finish'; time: number; left: number }
  | { kind: 'out'; reached: number };

/** A time attack in progress: the countdown, the clock running down, and the rings passed. */
export class TimeAttack {
  phase: 'countdown' | 'racing' | 'finished' | 'out' = 'countdown';
  /** Seconds since the start, which is 0 until the countdown ends. */
  elapsed = 0;
  /** Seconds left on the clock. */
  left: number;
  /** The ring to fly through next. */
  next = 0;
  private wait = COUNTDOWN;
  private counted = 0;

  constructor(readonly course: AttackCourse) {
    this.left = course.start;
  }

  /** The number the countdown shows, or 0 once it is over. */
  get count(): number {
    return this.phase === 'countdown' ? Math.max(1, Math.ceil(this.wait)) : 0;
  }

  /** Runs the clock on by `dt` seconds, in which the ship moved from `from` to `to`, and says what happened. */
  update(dt: number, from: Vector3, to: Vector3): AttackEvent[] {
    const events: AttackEvent[] = [];
    if (this.phase === 'countdown') {
      if (this.count !== this.counted) {
        this.counted = this.count;
        events.push({ kind: 'count', n: this.counted });
      }
      this.wait -= dt;
      if (this.wait > 0) return events;
      this.phase = 'racing';
      // The share of this frame after the start is flown, and comes off the clock
      this.elapsed = -this.wait;
      this.left -= -this.wait;
      events.push({ kind: 'go' });
      return events;
    }
    if (this.phase !== 'racing') return events;
    const { gates, bonus } = this.course;
    const through = throughGate(gates[this.next], from, to);
    // A ring reached in the same frame the clock runs out still counts, if it was reached first
    if (through !== null && this.left - dt * through >= 0) {
      const time = this.elapsed + dt * through;
      const index = this.next++;
      if (this.next === gates.length) {
        this.phase = 'finished';
        this.left -= dt * through;
        this.elapsed = time;
        events.push({ kind: 'finish', time, left: this.left });
        return events;
      }
      this.left += bonus[index];
      events.push({ kind: 'gate', index, bonus: bonus[index] });
    }
    this.elapsed += dt;
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.phase = 'out';
      events.push({ kind: 'out', reached: this.next });
    }
    return events;
  }
}

/* ---------- what a visitor's time attacks leave in their browser ---------- */

export interface AttackBest {
  /** The most rings reached in one run, the finish included. */
  rings: number;
  /** The most seconds left on the clock at the finish, or null if it hasn't been finished. */
  left: number | null;
}

type Bests = Record<string, Partial<Record<Ship, AttackBest>>>;

const isBest = (value: unknown): value is AttackBest => {
  const best = value as AttackBest | null;
  return (
    typeof best === 'object' &&
    best !== null &&
    Number.isInteger(best.rings) &&
    best.rings >= 0 &&
    (best.left === null || (Number.isFinite(best.left) && best.left >= 0))
  );
};

/** The most rings and the most time left for each year and ship on one city, kept in this browser. */
export class AttackRecords {
  private readonly key: string;
  private readonly bests: Bests = {};

  constructor(login: string) {
    this.key = `contriscape:attack:${login.toLowerCase()}`;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(this.key) ?? '{}');
      for (const [year, ships] of Object.entries(saved as Record<string, unknown>)) {
        if (!/^\d{4}$/.test(year) || typeof ships !== 'object' || ships === null) continue;
        for (const [ship, best] of Object.entries(ships)) {
          if (readShip(ship) === ship && isBest(best)) (this.bests[year] ??= {})[ship as Ship] = best;
        }
      }
    } catch {
      // Nothing readable saved means no bests yet
    }
  }

  best(year: number, ship: Ship): AttackBest | null {
    return this.bests[year]?.[ship] ?? null;
  }

  /** Whether a year's time attack has been finished in any ship. */
  finished(year: number): boolean {
    return SHIPS.some((ship) => this.best(year, ship)?.left != null);
  }

  /**
   * Takes a run that reached `rings` rings, with `left` seconds on the clock if it finished. Says whether it reached
   * more rings than before with this ship, and whether it finished with more time left.
   */
  record(year: number, ship: Ship, rings: number, left: number | null): { most: boolean; quickest: boolean } {
    const before = this.best(year, ship);
    const most = before === null || rings > before.rings;
    const quickest = left !== null && (before?.left == null || left > before.left);
    (this.bests[year] ??= {})[ship] = {
      rings: Math.max(rings, before?.rings ?? 0),
      left: quickest ? left : (before?.left ?? null),
    };
    try {
      localStorage.setItem(this.key, JSON.stringify(this.bests));
    } catch {
      // Private windows can refuse storage. The best still stands for this visit.
    }
    return { most, quickest };
  }
}
