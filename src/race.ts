import { Vector3 } from 'three';
import { hashText } from '../shared/explore';
import type { Calendar } from './calendar';
import { readShip, SHIPS, type Ship } from './fighter';
import type { CityMap } from './map';
import { courseRoute, newPose, poseAt, type Route } from './routes';

/** A gate this far from a race's start is the first, on the straight in. */
export const FIRST_GATE = 30;
/** Units of course between gates, about a second apart at the rival's pace. */
export const GATE_GAP = 24;
/** A ship that passes this close to a gate's centre has flown through it. The ring is drawn smaller. */
export const GATE_REACH = 2.6;
export const GATE_RADIUS = 2.2;
/** Seconds counted down before a race starts. */
export const COUNTDOWN = 3;
/** How quickly the rival picks up speed, as Pilot's ship does: most of the way in a second. */
const RIVAL_PICKUP = 2.4;
/** Steps a second the rival's flight is worked out in, ahead of the race. */
const RIVAL_STEPS = 120;
/** A run is recorded for its ghost this many times a second, and for at most this long. */
export const GHOST_RATE = 10;
const GHOST_SECONDS = 180;
/** Numbers a ghost keeps for each moment: where the ship was, and its heading, pitch and bank. */
const GHOST_FIELDS = 6;
const GHOST_PLACE = 16;
const GHOST_TURN = 10000;
/** Ghosts kept in this browser, across every city, before the oldest goes. */
const GHOSTS_KEPT = 20;
const GHOST_INDEX = 'contriscape:ghosts';
/** The longest time a challenge link can set, in seconds. Anything longer isn't a time anyone needs to beat. */
const LONGEST_CHALLENGE = 3600;
/** A year is in the running for a day's course when it has at least this share of its busiest year's contributions. */
const DAILY_SHARE = 0.2;

export interface Gate {
  /** How far along the course it stands. */
  s: number;
  at: Vector3;
  /** The way through it, along the course. */
  normal: Vector3;
}

export interface Course {
  year: number;
  route: Route;
  /** The gates in order. The last is the finish. */
  gates: Gate[];
  /** The rival's flight: where along the course it is at each step of `1 / RIVAL_STEPS` seconds. */
  rivalPath: Float64Array;
  rivalTime: number;
  /** The rival's time at each gate. */
  rivalSplits: number[];
}

/** The time along a path of evenly spaced steps at which it first reaches `s`, between steps where it falls between. */
function timeAt(path: Float64Array, s: number): number {
  let lo = 0;
  let hi = path.length - 1;
  if (s >= path[hi]) return hi / RIVAL_STEPS;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (path[m] < s) lo = m;
    else hi = m;
  }
  const k = (s - path[lo]) / Math.max(1e-9, path[hi] - path[lo]);
  return (lo + Math.min(1, Math.max(0, k))) / RIVAL_STEPS;
}

/**
 * A year's race: its line, gates along it, and the rival's flight down it. The rival starts from a standstill, picks
 * up speed as Pilot's ship does, and takes each stretch at the pace the course allows, which slows it for corners.
 */
export function buildCourse(map: CityMap, year: number): Course {
  const route = courseRoute(map, year);
  const pose = newPose();
  const ahead = newPose();
  const gates: Gate[] = [];
  const finish = route.len - 1;
  const gateAt = (s: number): Gate => {
    poseAt(route, s, pose);
    poseAt(route, Math.min(route.len, s + 1), ahead);
    const normal = ahead.p.clone().sub(pose.p);
    if (normal.lengthSq() < 1e-9) normal.set(1, 0, 0);
    return { s, at: pose.p.clone(), normal: normal.normalize() };
  };
  for (let s = FIRST_GATE; s < finish - GATE_GAP / 2; s += GATE_GAP) gates.push(gateAt(s));
  gates.push(gateAt(finish));

  const path: number[] = [0];
  let s = 0;
  let speed = 0;
  const step = 1 / RIVAL_STEPS;
  while (s < route.len) {
    const pace = poseAt(route, s, pose).pace;
    // Picks up speed gradually, and slows for a corner as soon as the course asks
    speed = Math.min(pace, speed + (pace - speed) * (1 - Math.exp(-RIVAL_PICKUP * step)));
    s = Math.min(route.len, s + Math.max(speed, 0.5) * step);
    path.push(s);
  }
  const rivalPath = Float64Array.from(path);
  return {
    year,
    route,
    gates,
    rivalPath,
    rivalTime: timeAt(rivalPath, route.len),
    rivalSplits: gates.map((gate) => timeAt(rivalPath, gate.s)),
  };
}

/** How far along its course the rival is this many seconds after the start. */
export function rivalAt(course: Course, seconds: number): number {
  const { rivalPath } = course;
  const k = Math.max(0, seconds) * RIVAL_STEPS;
  const i = Math.floor(k);
  if (i >= rivalPath.length - 1) return rivalPath[rivalPath.length - 1];
  return rivalPath[i] + (rivalPath[i + 1] - rivalPath[i]) * (k - i);
}

/**
 * Where, between 0 and 1 along a move from `from` to `to`, the ship went through a gate, or null if it didn't. It has to
 * cross the gate's plane going the right way, within reach of its centre, so a ship can't go through backwards or
 * round it, and a fast one can't skip it between frames.
 */
export function throughGate(gate: Gate, from: Vector3, to: Vector3): number | null {
  const a =
    (from.x - gate.at.x) * gate.normal.x + (from.y - gate.at.y) * gate.normal.y + (from.z - gate.at.z) * gate.normal.z;
  const b =
    (to.x - gate.at.x) * gate.normal.x + (to.y - gate.at.y) * gate.normal.y + (to.z - gate.at.z) * gate.normal.z;
  if (!(a < 0 && b >= 0)) return null;
  const k = a / (a - b);
  const x = from.x + (to.x - from.x) * k - gate.at.x;
  const y = from.y + (to.y - from.y) * k - gate.at.y;
  const z = from.z + (to.z - from.z) * k - gate.at.z;
  return Math.hypot(x, y, z) <= GATE_REACH ? k : null;
}

export type RaceEvent =
  { kind: 'count'; n: number } | { kind: 'go' } | { kind: 'gate'; index: number } | { kind: 'finish'; time: number };

/** A race in progress: the countdown, the clock, the gates passed and the rival's place. */
export class Race {
  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  /** Seconds since the start, which is 0 until the countdown ends. */
  elapsed = 0;
  /** The gate to fly through next. */
  next = 0;
  /** The ship's time at each gate it has passed. */
  readonly splits: number[] = [];
  private wait = COUNTDOWN;
  private counted = 0;

  constructor(readonly course: Course) {}

  /** The number the countdown shows, or 0 once it is over. */
  get count(): number {
    return this.phase === 'countdown' ? Math.max(1, Math.ceil(this.wait)) : 0;
  }

  get rivalS(): number {
    return rivalAt(this.course, this.elapsed);
  }

  /** Seconds the ship is behind the rival at the last gate it passed, or ahead where it is negative. */
  get gap(): number | null {
    const i = this.splits.length - 1;
    return i < 0 ? null : this.splits[i] - this.course.rivalSplits[i];
  }

  /** Runs the race on by `dt` seconds, in which the ship moved from `from` to `to`, and says what happened. */
  update(dt: number, from: Vector3, to: Vector3): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase === 'countdown') {
      if (this.count !== this.counted) {
        this.counted = this.count;
        events.push({ kind: 'count', n: this.counted });
      }
      this.wait -= dt;
      if (this.wait > 0) return events;
      this.phase = 'racing';
      // The share of this frame after the start is raced
      this.elapsed = -this.wait;
      events.push({ kind: 'go' });
      return events;
    }
    if (this.phase !== 'racing') return events;
    this.elapsed += dt;
    const gate = this.course.gates[this.next];
    const through = throughGate(gate, from, to);
    if (through === null) return events;
    const time = this.elapsed - dt * (1 - through);
    this.splits.push(time);
    this.next++;
    if (this.next < this.course.gates.length) {
      events.push({ kind: 'gate', index: this.next - 1 });
    } else {
      this.phase = 'finished';
      this.elapsed = time;
      events.push({ kind: 'finish', time });
    }
    return events;
  }
}

/* ---------- what a visitor's races leave in their browser ---------- */

export interface Best {
  /** Seconds. */
  time: number;
  points: number;
  /** Whether a race on this course with this ship has beaten the rival. */
  won: boolean;
}

type Bests = Record<string, Partial<Record<Ship, Best>>>;

const isBest = (value: unknown): value is Best => {
  const best = value as Best | null;
  return (
    typeof best === 'object' &&
    best !== null &&
    Number.isFinite(best.time) &&
    best.time > 0 &&
    Number.isFinite(best.points) &&
    best.points >= 0 &&
    typeof best.won === 'boolean'
  );
};

/** The fastest time and the highest score for each year and ship on one city, kept in this browser. */
export class RaceRecords {
  private readonly key: string;
  private readonly bests: Bests = {};

  constructor(login: string) {
    this.key = `contriscape:race:${login.toLowerCase()}`;
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

  best(year: number, ship: Ship): Best | null {
    return this.bests[year]?.[ship] ?? null;
  }

  /** Whether the rival has been beaten on a year's course in any ship. */
  won(year: number): boolean {
    return SHIPS.some((ship) => this.best(year, ship)?.won === true);
  }

  /** Takes a finished race, and says whether its time and its score are the best yet with this ship. */
  record(year: number, ship: Ship, time: number, points: number, won: boolean): { fastest: boolean; highest: boolean } {
    const before = this.best(year, ship);
    const fastest = before === null || time < before.time;
    const highest = before === null ? points > 0 : points > before.points;
    (this.bests[year] ??= {})[ship] = {
      time: fastest ? time : (before as Best).time,
      points: Math.max(points, before?.points ?? 0),
      won: won || (before?.won ?? false),
    };
    try {
      localStorage.setItem(this.key, JSON.stringify(this.bests));
    } catch {
      // Private windows can refuse storage. The best still stands for this visit.
    }
    return { fastest, highest };
  }
}

/* ---------- ghosts ---------- */

/** A recorded run: `GHOST_RATE` moments a second, each its position, heading, pitch and bank. */
export type Track = Float32Array;

/** Records a run as it is flown, until it is too long to keep. */
export class Recorder {
  private readonly values: number[] = [];
  /** Moments noted so far, counted whole, so the times they stand for don't drift. */
  private moments = 0;

  /** Notes where the ship is, `elapsed` seconds into the race, for each moment that has come due. */
  note(elapsed: number, x: number, y: number, z: number, yaw: number, pitch: number, bank: number): void {
    while (this.moments <= (elapsed + 1e-6) * GHOST_RATE && this.moments <= GHOST_SECONDS * GHOST_RATE) {
      this.values.push(x, y, z, yaw, pitch, bank);
      this.moments++;
    }
  }

  /** The run as a track, or null if it ran past the longest a ghost keeps. */
  finish(elapsed: number): Track | null {
    return elapsed > GHOST_SECONDS || this.values.length === 0 ? null : Float32Array.from(this.values);
  }
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A track as text for storage: each number rounded into 16 bits, then Base64. */
export function encodeTrack(track: Track): string {
  const packed = new Int16Array(track.length);
  for (let i = 0; i < track.length; i++) {
    const field = i % GHOST_FIELDS;
    const value = field < 3 ? track[i] * GHOST_PLACE : (field === 3 ? wrapAngle(track[i]) : track[i]) * GHOST_TURN;
    packed[i] = Math.max(-32768, Math.min(32767, Math.round(value)));
  }
  let text = '';
  const bytes = new Uint8Array(packed.buffer);
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

/** A track read back from storage, or null if the text isn't one. */
export function decodeTrack(text: string): Track | null {
  try {
    const raw = atob(text);
    if (raw.length === 0 || raw.length % (GHOST_FIELDS * 2) !== 0) return null;
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const packed = new Int16Array(bytes.buffer);
    const track = new Float32Array(packed.length);
    for (let i = 0; i < packed.length; i++) {
      track[i] = packed[i] / (i % GHOST_FIELDS < 3 ? GHOST_PLACE : GHOST_TURN);
    }
    return track;
  } catch {
    return null;
  }
}

export interface GhostPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  bank: number;
}

/** Where a track's ship was `seconds` into its run, between its moments. False once the run is over. */
export function ghostAt(track: Track, seconds: number, out: GhostPose): boolean {
  const moments = track.length / GHOST_FIELDS;
  const k = Math.max(0, seconds) * GHOST_RATE;
  const i = Math.floor(k);
  if (i >= moments - 1) return false;
  const t = k - i;
  const a = i * GHOST_FIELDS;
  const b = a + GHOST_FIELDS;
  const mix = (n: number) => track[a + n] + (track[b + n] - track[a + n]) * t;
  out.x = mix(0);
  out.y = mix(1);
  out.z = mix(2);
  out.yaw = track[a + 3] + wrapAngle(track[b + 3] - track[a + 3]) * t;
  out.pitch = mix(4);
  out.bank = mix(5);
  return true;
}

const ghostKey = (login: string, year: number, ship: Ship) =>
  `contriscape:ghost:${login.toLowerCase()}:${year}:${ship}`;

function readIndex(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(GHOST_INDEX) ?? '[]');
    return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/** The ghost of the fastest run on a year's course with a ship, in this browser, or null. */
export function readGhost(login: string, year: number, ship: Ship): Track | null {
  try {
    const text = localStorage.getItem(ghostKey(login, year, ship));
    return text === null ? null : decodeTrack(text);
  } catch {
    return null;
  }
}

/** Keeps a run as the ghost for its course and ship, and lets the oldest ghosts go to make room. */
export function saveGhost(login: string, year: number, ship: Ship, track: Track): void {
  const key = ghostKey(login, year, ship);
  try {
    const index = [...readIndex().filter((other) => other !== key), key];
    while (index.length > GHOSTS_KEPT) localStorage.removeItem(index.shift() as string);
    localStorage.setItem(key, encodeTrack(track));
    localStorage.setItem(GHOST_INDEX, JSON.stringify(index));
  } catch {
    // A full or blocked store only costs the ghost
  }
}

/* ---------- challenges and the day's course ---------- */

export interface Challenge {
  year: number;
  /** The time to beat, in seconds, or null for a course with no time set. */
  beat: number | null;
  /** The ship the time was set in. */
  ship: Ship | null;
  /** The day a day's course was set for, as `YYYY-MM-DD`, or null. */
  daily: string | null;
}

/**
 * A challenge from a link's fragment: `#race=2024&beat=41.2&ship=rocket` for a time to beat, or `#daily=2026-11-20` for
 * a day's course. Anything that doesn't fit this city is ignored. `years` are the years that can be raced here.
 */
export function readChallenge(hash: string, years: number[], cal: Calendar, login: string): Challenge | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const daily = params.get('daily');
  if (daily !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(daily) || Number.isNaN(Date.parse(daily))) return null;
    const year = dailyYear(cal, daily, login);
    return year === null ? null : { year, beat: null, ship: null, daily };
  }
  const year = Number(params.get('race'));
  if (!years.includes(year)) return null;
  const beat = Number(params.get('beat'));
  const ship = params.get('ship');
  return {
    year,
    beat: Number.isFinite(beat) && beat > 0 && beat <= LONGEST_CHALLENGE ? beat : null,
    ship: ship !== null && readShip(ship) === ship ? (ship as Ship) : null,
    daily: null,
  };
}

/** The fragment of a link that sets a time to beat on a year's course, in tenths, cut off as the race clock shows it. */
export function challengeHash(year: number, seconds: number, ship: Ship): string {
  return `#race=${year}&beat=${(Math.floor(seconds * 10 + 1e-6) / 10).toFixed(1)}&ship=${ship}`;
}

/** Today as `YYYY-MM-DD`, in UTC, so a day's course is the same everywhere. */
export const today = (now = new Date()): string => now.toISOString().slice(0, 10);

/**
 * The year a day's course flies on a city: one of its busier years, picked by the day, so everyone who opens the course
 * that day gets the same one. Null for a city with nothing to race.
 */
export function dailyYear(cal: Calendar, day: string, login: string): number | null {
  const totals = cal.years.map((year) => cal.yearTotal(year));
  const busiest = Math.max(0, ...totals);
  if (!busiest) return null;
  const eligible = cal.years.filter((_, i) => totals[i] >= busiest * DAILY_SHARE);
  return eligible[hashText(`${day}:${login.toLowerCase()}`) % eligible.length];
}

/** The years a city's races are run on: those with any contributions, newest first. */
export function raceYears(cal: Calendar): number[] {
  return cal.years.filter((year) => cal.yearTotal(year) > 0).reverse();
}
