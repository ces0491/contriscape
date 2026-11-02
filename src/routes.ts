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
const CLIMB_SLOPE = 0.8;
const RING_RADIUS = 13;
const WALL_HEIGHT = 6;

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

const paceAt = (cal: Calendar, day: number) => 19 - 6 * Math.sqrt(cal.windowSum(day) / cal.busiestWindow);

/** Picks an alley per week: it sweeps across the block, prefers tall walls either side, and hops where towers are low. */
export function alleyRoute(map: CityMap, year: number): number[] {
  const { cal } = map;
  const last = cal.cellOf(cal.span(year).b).week;
  const alleys = ROWS - 1;
  const switchCost = 7;
  const crossCost = 0.32;
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

/** A climbing turn around one tower, then straight out for the jump. */
function ringPoints(map: CityMap, tower: number, from: Waypoint): Waypoint[] {
  const { cx, cz, top } = map;
  const start = Math.atan2(from.z - cz[tower], from.x - cx[tower]);
  const turns = 1.2;
  const steps = 30;
  const out: Waypoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const a = start - t * turns * Math.PI * 2;
    out.push({
      x: cx[tower] + Math.cos(a) * RING_RADIUS,
      y: 7 + t * (top[tower] + 3),
      z: cz[tower] + Math.sin(a) * RING_RADIUS,
      // Keeps counting past the end of the data, so the last towers finish their rise
      day: from.day + t * RISE * 5,
      pace: 16,
      gaze: 0.82,
      g: new Vector3(cx[tower], Math.min(top[tower] - 1, 5 + t * top[tower]), cz[tower]),
    });
  }
  const a = start - turns * Math.PI * 2;
  out.push(...exitPoints(out[steps], Math.sin(a), -Math.cos(a)));
  return out;
}

function exitPoints(last: Waypoint, tx: number, tz: number): Waypoint[] {
  return [
    { x: last.x + tx * 34, y: last.y + 7, z: last.z + tz * 34, day: last.day, pace: 26, gaze: 0 },
    { x: last.x + tx * 90, y: last.y + 18, z: last.z + tz * 90, day: last.day, pace: 40, gaze: 0 },
  ];
}

function finale(map: CityMap, year: number, last: Waypoint, day: number): Waypoint[] {
  const from: Waypoint = { x: last.x + 7, y: 4.5, z: last.z, day, pace: 15, gaze: 0 };
  const tower = map.cal.busiestIn(year);
  return [from, ...(tower >= 0 ? ringPoints(map, tower, from) : exitPoints(from, 1, 0))];
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

  const wp: Waypoint[] = [
    { x: lane + 16, y: 34, z: south + 62, day: 0, pace: 32, gaze: 0.25, g: centre },
    { x: lane + 5, y: 14, z: south + 26, day: 0, pace: 28, gaze: 0 },
    { x: lane, y: 5, z: south + 5, day: 0, pace: 25, gaze: 0 },
  ];
  crossed.forEach((y) => {
    const { a } = cal.span(y);
    wp.push({ x: lane, y: 4.5, z: map.blockZ(y) + DEPTH, day: a, pace: crossingPace, gaze: 0 });
    wp.push({ x: lane, y: 4.5, z: map.blockZ(y) + DEPTH * 0.4, day: a + 180, pace: crossingPace, gaze: 0 });
  });
  wp.pop();

  const start = cal.span(opening).a;
  wp.push(
    { x: lane - 4, y: 4.2, z: zS + 11, day: start, pace: 22, gaze: 0 },
    { x: lane - 14, y: 3.8, z: zS + 2, day: start, pace: 20, gaze: 0 },
    { x: lane - 26, y: 3.6, z: zS, day: start, pace: 20, gaze: 0 },
    { x: 12, y: 3.6, z: zS, day: start, pace: 20, gaze: 0 },
  );

  let previousZ = zS;
  runs.forEach((y, i) => {
    const route = alleyRoute(map, y);
    const entry = map.blockZ(y) + route[0] * CELL;
    const { a, b } = cal.span(y);
    wp.push(...uTurn(-5, previousZ, entry, -1, a, 15, 3.4));
    wp.push(...runPoints(map, y, route, i * 1.7));
    if (i === runs.length - 1) return;

    const exit = map.blockZ(y) + route[route.length - 1] * CELL;
    const street = map.streetFor(y);
    const X = route.length * CELL;
    wp.push(...uTurn(X + 5, exit, street, 1, b, 15, 4.2).map((p, k) => ({ ...p, x: Math.max(p.x, WIDTH + k / 9) })));
    for (let x = WIDTH - 14; x > 8; x -= 24) {
      const k = (WIDTH - x) / WIDTH;
      wp.push({
        x,
        y: 5 + 1.2 * Math.sin(k * 9),
        z: street + 1.5 * Math.sin(k * 11),
        day: b,
        pace: 27,
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
    { x: -34, y: 9, z: entry + 10, day: a, pace: 24, gaze: 0 },
    { x: -8, y: 3.6, z: entry, day: a, pace: 18, gaze: 0 },
    ...runPoints(map, year, route, 0),
  ];
  wp.push(...finale(map, year, wp[wp.length - 1], b));
  return sampled(map, wp, centre);
}

function sampled(map: CityMap, wp: Waypoint[], centre: Vector3): Route {
  wp.forEach((w, i) => {
    w.g ??= i ? wp[i - 1].g : centre;
    w.spin ??= i ? wp[i - 1].spin : 0;
  });
  const curve = new CatmullRomCurve3(
    wp.map((w) => new Vector3(w.x, w.y, w.z)),
    false,
    'centripetal',
  );
  const segments = wp.length - 1;
  const steps = segments * 14;
  const S: Sample[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const f = u * segments;
    const s = Math.min(segments - 1, Math.floor(f));
    const k = f - s;
    const A = wp[s];
    const B = wp[s + 1];
    S.push({
      p: curve.getPoint(u),
      g: (A.g as Vector3).clone().lerp(B.g as Vector3, k),
      len: 0,
      day: A.day + (B.day - A.day) * k,
      pace: A.pace + (B.pace - A.pace) * k,
      gaze: A.gaze + (B.gaze - A.gaze) * k,
      spin: (A.spin as number) + ((B.spin as number) - (A.spin as number)) * k,
      roll: 0,
    });
  }

  // Lift the path over anything in its way, with a slope limit so it pops up and settles smoothly
  const safe = S.map((s) => {
    let h = 1;
    map.towersNear(s.p.x, s.p.z, CLEARANCE, (i) => {
      h = Math.max(h, map.top[i] + CLEARANCE);
    });
    return h;
  });
  const gap = (i: number) => S[i].p.distanceTo(S[i - 1].p);
  for (let i = 1; i < S.length; i++) safe[i] = Math.max(safe[i], safe[i - 1] - gap(i) * CLIMB_SLOPE);
  for (let i = S.length - 2; i >= 0; i--) safe[i] = Math.max(safe[i], safe[i + 1] - gap(i + 1) * CLIMB_SLOPE);
  S.forEach((s, i) => {
    s.p.y = Math.max(s.p.y, safe[i]);
  });

  let len = 0;
  S.forEach((s, i) => {
    if (i) len += s.p.distanceTo(S[i - 1].p);
    s.len = len;
  });

  // Bank from the turn rate
  const last = S.length - 1;
  const raw = S.map((s, i) => {
    const a = S[Math.max(0, i - 3)];
    const b = S[Math.min(last, i + 3)];
    const c = S[Math.min(last, i + 6)];
    let d = Math.atan2(c.p.x - s.p.x, c.p.z - s.p.z) - Math.atan2(b.p.x - a.p.x, b.p.z - a.p.z);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return clamp((d / Math.max(0.05, c.len - s.len + 1e-3)) * s.pace * 0.42, -1.2, 1.2);
  });
  S.forEach((s, i) => {
    let total = 0;
    let n = 0;
    for (let k = Math.max(0, i - 9); k <= Math.min(last, i + 9); k++) {
      total += raw[k];
      n++;
    }
    s.roll = total / n;
  });
  return { samples: S, len };
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
