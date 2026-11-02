import { CatmullRomCurve3, Vector3 } from 'three';
import type { Calendar } from './calendar';
import { CELL, DEPTH, ROWS, WIDTH, YEAR_PITCH, type CityMap } from './map';

/** Days a tower takes to rise. */
export const RISE = 14;
/** How far ahead of the ship the date runs, so towers go up in view. */
const LEAD = 56;
/** Alley runs in a flight. Older years are crossed at speed, so long histories stay watchable. */
const MAX_RUNS = 2;
const CROSSING_SECONDS = 10;
const CLEARANCE = 0.62;
const CLIMB_SLOPE = 0.45;
const RING_RADIUS = 13;
/** U-turns past the end of a block are at least this wide, which keeps them to a gentle bank. */
const TURN_WIDTH = 14;
const WALL_HEIGHT = 6;
const MAX_BANK = 0.85;
/** Radians a second. The ship slows for any corner that would turn it faster. */
const MAX_TURN_RATE = 2;
/** Spacing of route samples, and how far along the path each kind of smoothing reaches, in units. */
const STEP = 0.25;
const TURN_SMOOTHING = 3;
const LIFT_SMOOTHING = 3;
const BANK_SMOOTHING = 2;
const PACE_SMOOTHING = 20;
const BRAKING_DISTANCE = 8;

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  day: number;
  pace: number;
  gaze: number;
  g?: Vector3;
  spin?: number;
}

export interface Sample {
  p: Vector3;
  g: Vector3;
  len: number;
  day: number;
  pace: number;
  gaze: number;
  spin: number;
  roll: number;
}

export interface Route {
  samples: Sample[];
  len: number;
}

export type RouteScope = 'all' | number;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (k: number) => k * k * (3 - 2 * k);

/** Speed among the towers. One passes every 2.5 units, so this is about three towers a second. */
const paceAt = (cal: Calendar, day: number) => 10 - 3 * Math.sqrt(cal.windowSum(day) / cal.busiestWindow);

/** Picks an alley per week: it sweeps across the block, prefers tall walls either side, and hops where towers are low. */
export function alleyRoute(map: CityMap, year: number): number[] {
  const { cal } = map;
  const last = cal.cellOf(cal.span(year).b).week;
  const alleys = ROWS - 1;
  const switchCost = 12;
  const crossCost = 0.6;
  const sweep = 1.5;
  // A wall taller than the ship is wall enough, so extra height isn't worth a hop over the rooftops
  const side = (w: number, r: number) => Math.min(WALL_HEIGHT, map.heightAt(year, w, r));
  const wall = (w: number, a: number) =>
    side(w, a - 1) + side(w, a) - sweep * Math.abs(a - (3.5 + 2.5 * Math.sin(w * 0.22 + year)));

  let best = new Float64Array(alleys + 1).fill(Infinity);
  for (let a = 1; a <= alleys; a++) best[a] = -wall(0, a);
  const from: Int8Array[] = [];
  for (let w = 1; w <= last; w++) {
    const next = new Float64Array(alleys + 1).fill(Infinity);
    const back = new Int8Array(alleys + 1);
    for (let a = 1; a <= alleys; a++) {
      for (let p = 1; p <= alleys; p++) {
        let cost = best[p] - wall(w, a);
        if (p !== a) {
          cost += switchCost;
          for (let r = Math.min(a, p); r < Math.max(a, p); r++) {
            cost +=
              crossCost * (map.heightAt(year, w - 1, r) + map.heightAt(year, w, r) + map.heightAt(year, w + 1, r));
          }
        }
        if (cost < next[a]) {
          next[a] = cost;
          back[a] = p;
        }
      }
    }
    best = next;
    from.push(back);
  }

  let a = 1;
  for (let k = 1; k <= alleys; k++) if (best[k] < best[a]) a = k;
  const route = [a];
  for (let w = last - 1; w >= 0; w--) {
    a = from[w][a];
    route.unshift(a);
  }
  return route;
}

function runPoints(map: CityMap, year: number, route: number[], phase: number): Waypoint[] {
  const { cal } = map;
  const { a, b } = cal.span(year);
  const jan1 = cal.dateOf(a).getUTCDay();
  const end = route.length;
  const out: Waypoint[] = [];
  for (let w = 0; ; w += 2) {
    const W = Math.min(w, end);
    const day = Math.min(b, a + W * 7 - jan1 + LEAD);
    out.push({
      x: W * CELL,
      y: 2.8 + 0.6 * Math.sin(W * 0.37 + phase),
      z: map.blockZ(year) + route[Math.min(W, end - 1)] * CELL,
      day,
      pace: paceAt(cal, day),
      gaze: 0,
    });
    if (W >= end) return out;
  }
}

function uTurn(x: number, z0: number, z1: number, dir: number, day: number, pace: number, y: number): Waypoint[] {
  const c = (z0 + z1) / 2;
  const r = Math.abs(z1 - z0) / 2;
  const out: Waypoint[] = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI;
    out.push({ x: x + dir * Math.sin(a) * Math.max(r, 5), y, z: c + (z0 - c) * Math.cos(a), day, pace, gaze: 0 });
  }
  return out;
}

/**
 * Swings left around the end of the run, joins a circle on its north side already heading along it,
 * climbs around the tower, and leaves straight for the jump.
 */
function ringPoints(map: CityMap, tower: number, last: Waypoint, day: number): Waypoint[] {
  const { cx, cz, top } = map;
  const radius = Math.max(RING_RADIUS, cz[tower] - last.z + 12);
  const swing = uTurn(Math.max(last.x + 8, cx[tower] + 10), last.z, cz[tower] - radius, 1, day, 10, 5);
  const turns = 0.9;
  const steps = 24;
  const entry = -Math.PI / 2;
  const ring: Waypoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const a = entry - t * turns * Math.PI * 2;
    ring.push({
      x: cx[tower] + Math.cos(a) * radius,
      y: 6 + t * (top[tower] + 4),
      z: cz[tower] + Math.sin(a) * radius,
      // Keeps counting past the end of the data, so the last towers finish their rise
      day: day + t * RISE * 5,
      pace: 12,
      gaze: 0.82 * Math.min(1, t * 6),
      g: new Vector3(cx[tower], Math.min(top[tower] - 1, 5 + t * top[tower]), cz[tower]),
    });
  }
  const a = entry - turns * Math.PI * 2;
  return [...swing, ...ring, ...exitPoints(ring[steps], Math.sin(a), -Math.cos(a))];
}

function exitPoints(last: Waypoint, tx: number, tz: number): Waypoint[] {
  return [
    { x: last.x + tx * 34, y: last.y + 7, z: last.z + tz * 34, day: last.day, pace: 26, gaze: 0 },
    { x: last.x + tx * 90, y: last.y + 18, z: last.z + tz * 90, day: last.day, pace: 40, gaze: 0 },
  ];
}

function finale(map: CityMap, year: number, last: Waypoint, day: number): Waypoint[] {
  const tower = map.cal.busiestIn(year);
  if (tower >= 0) return ringPoints(map, tower, last, day);
  return exitPoints({ x: last.x + 7, y: 4.5, z: last.z, day, pace: 10, gaze: 0 }, 1, 0);
}

function routeAll(map: CityMap, centre: Vector3): Route {
  const { cal } = map;
  const biggest = Math.max(...cal.years.map((y) => cal.yearTotal(y)));
  const busy = biggest ? cal.years.filter((y) => cal.yearTotal(y) >= biggest * 0.05) : [cal.lastYear];
  const runs = busy.slice(-MAX_RUNS);
  const opening = runs[0];
  const crossed = cal.years.filter((y) => y < opening);
  const lane = 24 * CELL;
  const zS = map.blockZ(opening) + DEPTH + (YEAR_PITCH - DEPTH) / 2;
  const south = map.depth;
  const crossingPace = Math.max(25, (crossed.length * YEAR_PITCH) / CROSSING_SECONDS);

  // Older years go by at speed, so they are crossed above the rooftops
  let roofs = 1;
  for (let i = 0; i < cal.span(opening).a; i++) roofs = Math.max(roofs, map.top[i]);
  const cruise = crossed.length ? roofs + 4 : 5;
  const descending = (k: number) => 3.6 + (cruise - 3.6) * k;

  const wp: Waypoint[] = [
    { x: lane + 16, y: Math.max(34, cruise + 6), z: south + 62, day: 0, pace: 32, gaze: 0.25, g: centre },
    { x: lane + 5, y: Math.max(14, cruise + 2), z: south + 26, day: 0, pace: 28, gaze: 0 },
    { x: lane, y: cruise, z: south + 5, day: 0, pace: 25, gaze: 0 },
  ];
  crossed.forEach((y) => {
    const { a } = cal.span(y);
    wp.push({ x: lane, y: cruise, z: map.blockZ(y) + DEPTH, day: a, pace: crossingPace, gaze: 0 });
    wp.push({ x: lane, y: cruise, z: map.blockZ(y) + DEPTH * 0.4, day: a + 180, pace: crossingPace, gaze: 0 });
  });
  wp.pop();

  const start = cal.span(opening).a;
  wp.push(
    { x: lane - 4, y: descending(0.75), z: zS + 11, day: start, pace: 20, gaze: 0 },
    { x: lane - 14, y: descending(0.45), z: zS + 2, day: start, pace: 16, gaze: 0 },
    { x: lane - 26, y: descending(0.2), z: zS, day: start, pace: 14, gaze: 0 },
    { x: 12, y: 3.6, z: zS, day: start, pace: 12, gaze: 0 },
  );

  let previousZ = zS;
  runs.forEach((y, i) => {
    const route = alleyRoute(map, y);
    const entry = map.blockZ(y) + route[0] * CELL;
    const { a, b } = cal.span(y);
    wp.push(...uTurn(-5, Math.max(previousZ, entry + TURN_WIDTH), entry, -1, a, 10, 3.4));
    wp.push(...runPoints(map, y, route, i * 1.7));
    if (i === runs.length - 1) return;

    const exit = map.blockZ(y) + route[route.length - 1] * CELL;
    const street = map.streetFor(y);
    const X = route.length * CELL;
    wp.push(
      ...uTurn(X + 5, exit, Math.min(street, exit - TURN_WIDTH), 1, b, 10, 4.2).map((p, k) => ({
        ...p,
        x: Math.max(p.x, WIDTH + k / 9),
      })),
    );
    for (let x = WIDTH - 14; x > 8; x -= 24) {
      const k = (WIDTH - x) / WIDTH;
      wp.push({
        x,
        y: 5 + 1.2 * Math.sin(k * 9),
        z: street + 1.5 * Math.sin(k * 11),
        day: b,
        pace: 22,
        gaze: 0,
        spin: smooth(clamp((k - 0.3) / 0.25, 0, 1)) * Math.PI * 2,
      });
    }
    previousZ = street;
  });

  const lastRun = runs[runs.length - 1];
  wp.push(...finale(map, lastRun, wp[wp.length - 1], cal.days - 1));
  return sampled(map, wp, centre);
}

function routeYear(map: CityMap, year: number, centre: Vector3): Route {
  const route = alleyRoute(map, year);
  const entry = map.blockZ(year) + route[0] * CELL;
  const { a, b } = map.cal.span(year);
  const wp: Waypoint[] = [
    { x: -70, y: 24, z: entry + 34, day: a, pace: 30, gaze: 0 },
    { x: -34, y: 9, z: entry + 10, day: a, pace: 20, gaze: 0 },
    { x: -8, y: 3.6, z: entry, day: a, pace: 12, gaze: 0 },
    ...runPoints(map, year, route, 0),
  ];
  wp.push(...finale(map, year, wp[wp.length - 1], b));
  return sampled(map, wp, centre);
}

/** A moving average, with the window shortened at each end. */
function blurred(values: number[], radius: number): number[] {
  const running = new Float64Array(values.length + 1);
  values.forEach((v, i) => {
    running[i + 1] = running[i] + v;
  });
  return values.map((_, i) => {
    const a = Math.max(0, i - radius);
    const b = Math.min(values.length - 1, i + radius);
    return (running[b + 1] - running[a]) / (b - a + 1);
  });
}

const blurredTwice = (values: number[], radius: number) => blurred(blurred(values, radius), radius);

function dilated(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let peak = -Infinity;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k++) {
      peak = Math.max(peak, values[k]);
    }
    return peak;
  });
}

const samplesWithin = (units: number) => Math.max(1, Math.round(units / STEP));

/** The waypoints as a curve with evenly spaced samples, so a smoothing distance means the same thing everywhere. */
function evenlySpaced(wp: Waypoint[]) {
  const curve = new CatmullRomCurve3(
    wp.map((w) => new Vector3(w.x, w.y, w.z)),
    false,
    'centripetal',
  );
  const segments = wp.length - 1;
  const steps = segments * 20;
  const points = curve.getPoints(steps);
  const lengths = [0];
  for (let i = 1; i <= steps; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));

  const out = {
    x: [] as number[],
    y: [] as number[],
    z: [] as number[],
    gx: [] as number[],
    gy: [] as number[],
    gz: [] as number[],
    day: [] as number[],
    pace: [] as number[],
    gaze: [] as number[],
    spin: [] as number[],
  };
  const count = Math.ceil(lengths[steps] / STEP) + 1;
  let at = 0;
  for (let i = 0; i < count; i++) {
    const target = Math.min(lengths[steps], i * STEP);
    while (at < steps - 1 && lengths[at + 1] < target) at++;
    const k = clamp((target - lengths[at]) / Math.max(1e-6, lengths[at + 1] - lengths[at]), 0, 1);
    const u = ((at + k) / steps) * segments;
    const s = Math.min(segments - 1, Math.floor(u));
    const t = u - s;
    const A = wp[s];
    const B = wp[s + 1];
    const g = (A.g as Vector3).clone().lerp(B.g as Vector3, t);
    const p = points[at].clone().lerp(points[at + 1], k);
    out.x.push(p.x);
    out.y.push(p.y);
    out.z.push(p.z);
    out.gx.push(g.x);
    out.gy.push(g.y);
    out.gz.push(g.z);
    out.day.push(A.day + (B.day - A.day) * t);
    out.pace.push(A.pace + (B.pace - A.pace) * t);
    out.gaze.push(A.gaze + (B.gaze - A.gaze) * t);
    out.spin.push((A.spin as number) + ((B.spin as number) - (A.spin as number)) * t);
  }
  return out;
}

function sampled(map: CityMap, wp: Waypoint[], centre: Vector3): Route {
  wp.forEach((w, i) => {
    w.g ??= i ? wp[i - 1].g : centre;
    w.spin ??= i ? wp[i - 1].spin : 0;
  });
  const raw = evenlySpaced(wp);
  const turn = samplesWithin(TURN_SMOOTHING);
  const x = blurredTwice(raw.x, turn);
  const z = blurredTwice(raw.z, turn);

  // Lift the path over anything in its way. Widening the peaks by as much as the blur reaches keeps every
  // point at or above what it needs, so the ramps have no corners and the path never dips into a roof.
  const needed = x.map((px, i) => {
    let h = Math.max(1, raw.y[i]);
    map.towersNear(px, z[i], CLEARANCE, (day) => {
      h = Math.max(h, map.top[day] + CLEARANCE);
    });
    return h;
  });
  for (let i = 1; i < needed.length; i++) needed[i] = Math.max(needed[i], needed[i - 1] - STEP * CLIMB_SLOPE);
  for (let i = needed.length - 2; i >= 0; i--) needed[i] = Math.max(needed[i], needed[i + 1] - STEP * CLIMB_SLOPE);
  const lift = samplesWithin(LIFT_SMOOTHING);
  const y = blurredTwice(dilated(needed, lift * 2), lift);

  // How sharply the path bends at each point, in radians per unit
  const last = x.length - 1;
  const span = samplesWithin(1.5);
  const bend = x.map((_, i) => {
    const a = Math.max(0, i - span);
    const b = Math.min(last, i + span);
    if (a === i || b === i) return 0;
    let d = Math.atan2(x[b] - x[i], z[b] - z[i]) - Math.atan2(x[i] - x[a], z[i] - z[a]);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d / (((b - a) / 2) * STEP);
  });

  // Slow down in good time for corners. As with the lift, widening the dips keeps every point under its limit.
  const braking = samplesWithin(BRAKING_DISTANCE);
  const cornering = bend.map((b) => -MAX_TURN_RATE / Math.max(Math.abs(b), 1e-3));
  const limit = blurredTwice(dilated(cornering, braking * 2), braking);
  const cruising = blurredTwice(raw.pace, samplesWithin(PACE_SMOOTHING));
  const pace = cruising.map((v, i) => Math.min(v, -limit[i]));

  const gaze = blurredTwice(raw.gaze, turn);
  const spin = blurredTwice(raw.spin, turn);
  const gx = blurredTwice(raw.gx, turn);
  const gy = blurredTwice(raw.gy, turn);
  const gz = blurredTwice(raw.gz, turn);

  // Bank from the turn rate
  const bank = bend.map((b, i) => clamp(b * pace[i] * 0.42, -MAX_BANK, MAX_BANK));
  const roll = blurredTwice(bank, samplesWithin(BANK_SMOOTHING));

  let len = 0;
  const samples: Sample[] = x.map((px, i) => {
    const p = new Vector3(px, y[i], z[i]);
    if (i) len += Math.hypot(px - x[i - 1], y[i] - y[i - 1], z[i] - z[i - 1]);
    return {
      p,
      g: new Vector3(gx[i], gy[i], gz[i]),
      len,
      day: raw.day[i],
      pace: pace[i],
      gaze: gaze[i],
      spin: spin[i],
      roll: roll[i],
    };
  });
  return { samples, len };
}

export function buildRoute(map: CityMap, scope: RouteScope, centre: Vector3): Route {
  return scope === 'all' ? routeAll(map, centre) : routeYear(map, scope, centre);
}

export interface Pose {
  p: Vector3;
  g: Vector3;
  day: number;
  pace: number;
  gaze: number;
  roll: number;
  spin: number;
}

export const newPose = (): Pose => ({ p: new Vector3(), g: new Vector3(), day: 0, pace: 0, gaze: 0, roll: 0, spin: 0 });

export function poseAt(route: Route, s: number, out: Pose): Pose {
  const S = route.samples;
  let lo = 0;
  let hi = S.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (S[m].len <= s) lo = m;
    else hi = m;
  }
  const A = S[lo];
  const B = S[hi];
  const k = clamp((s - A.len) / Math.max(1e-6, B.len - A.len), 0, 1);
  out.p.copy(A.p).lerp(B.p, k);
  out.g.copy(A.g).lerp(B.g, k);
  out.day = A.day + (B.day - A.day) * k;
  out.pace = A.pace + (B.pace - A.pace) * k;
  out.gaze = A.gaze + (B.gaze - A.gaze) * k;
  out.roll = A.roll + (B.roll - A.roll) * k;
  out.spin = A.spin + (B.spin - A.spin) * k;
  return out;
}

/** The first point on a route at or after a date. */
export function lengthAtDay(route: Route, day: number): number {
  const S = route.samples;
  let lo = 0;
  let hi = S.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (S[m].day < day) lo = m + 1;
    else hi = m;
  }
  return S[lo].len;
}
