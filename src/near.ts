import { TOWER, type CityMap } from './map';
import type { Roof } from './sight';

/** A tower whose wall or roof passes within this of the ship's centre is a near miss. Under CELL, as `towersNear` needs. */
export const NEAR_GAP = 0.9;
/** The ship strikes a tower closer than this, so the closest a near miss can be. */
const CONTACT = 0.3;
/** Below this speed nothing is near-missed, only flown past. */
const NEAR_SPEED = 8;
const CRUISE = 17;
/** Points for a tower at cruise speed, at the edge of the near zone. Closer and faster scores up to three and 2.7 times as much. */
const BASE_POINTS = 10;
/** A chain banks once this long has passed without another near miss. */
export const CHAIN_SECONDS = 2;
/** Each near miss in a chain adds this to what the chain is multiplied by, up to the most it can be. */
const CHAIN_STEP = 0.1;
const MOST_MULTIPLIED = 3;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** How far a point is from a tower's box, which runs from the ground to its roof. */
export function gapToTower(map: CityMap, roof: Roof, day: number, x: number, y: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - map.cx[day]) - TOWER / 2);
  const dz = Math.max(0, Math.abs(z - map.cz[day]) - TOWER / 2);
  const dy = Math.max(0, y - roof(day));
  return Math.hypot(dx, dy, dz);
}

/** What a near miss is worth: more the closer it was, and the faster the ship was going. */
export function nearPoints(gap: number, speed: number): number {
  if (speed < NEAR_SPEED || gap >= NEAR_GAP) return 0;
  const closeness = clamp((NEAR_GAP - gap) / (NEAR_GAP - CONTACT), 0, 1);
  return BASE_POINTS * clamp(speed / CRUISE, 0.5, 2.7) * (1 + 2 * closeness);
}

/** How much a chain of this many near misses is multiplied by when it banks. */
export const multiplier = (count: number): number => Math.min(MOST_MULTIPLIED, 1 + CHAIN_STEP * Math.max(0, count - 1));

/**
 * Near misses in a race: points for passing close to towers at speed. Each tower counts once a race, at its closest,
 * once the ship has left it behind. Near misses in quick succession make a chain, which banks once a couple of seconds
 * go by without another or it reaches its top multiplier, and which a clip loses.
 */
export class NearMisses {
  /** Points banked. */
  score = 0;
  /** Points in the chain not yet banked, before its multiplier. */
  chain = 0;
  /** Near misses in the chain. */
  count = 0;
  private quiet = 0;
  /** Towers in the near zone now, with the most each is worth so far. */
  private readonly close = new Map<number, number>();
  private readonly counted = new Set<number>();
  private readonly here = new Set<number>();

  /** What the chain would bank for now. */
  get pending(): number {
    return Math.round(this.chain * multiplier(this.count));
  }

  /**
   * Looks at the towers near the ship this frame. A tower that has left the near zone counts, at the most it was worth
   * while in it. Returns the points the chain gained.
   */
  update(dt: number, map: CityMap, roof: Roof, x: number, y: number, z: number, speed: number): number {
    this.here.clear();
    map.towersNear(x, z, NEAR_GAP, (day) => {
      if (this.counted.has(day)) return;
      const worth = nearPoints(gapToTower(map, roof, day, x, y, z), speed);
      if (worth <= 0) return;
      this.here.add(day);
      this.close.set(day, Math.max(worth, this.close.get(day) ?? 0));
    });
    let gained = 0;
    for (const [day, worth] of this.close) {
      if (this.here.has(day)) continue;
      this.close.delete(day);
      this.counted.add(day);
      gained += worth;
      this.count++;
    }
    this.chain += gained;
    this.quiet = gained > 0 ? 0 : this.quiet + dt;
    // A chain that has reached its top multiplier has nothing more to gain by waiting. Banking it then also stops a
    // dense city, where near misses never let up, from risking a whole race's points on one clip.
    if (this.count && (this.quiet >= CHAIN_SECONDS || multiplier(this.count) >= MOST_MULTIPLIED)) this.bank();
    return gained;
  }

  /** Adds the chain to the score. Returns what it banked. */
  bank(): number {
    const banked = this.pending;
    this.score += banked;
    this.chain = 0;
    this.count = 0;
    return banked;
  }

  /**
   * The ship struck a tower: the chain is lost, with the towers it was passing at the time, and the tower it struck.
   * Returns the points lost.
   */
  clip(day: number): number {
    const lost = this.pending;
    this.chain = 0;
    this.count = 0;
    for (const passing of this.close.keys()) this.counted.add(passing);
    this.close.clear();
    this.counted.add(day);
    return lost;
  }
}
