import type { Ship } from './fighter';

/**
 * What sets a ship apart in Pilot, where it is flown by hand. Autopilot flies them all alike, so its routes hold for
 * any ship. Each ship has one power, and is otherwise the same as the rest.
 */
export interface Power {
  /** Its name, for Settings. */
  name: string;
  /** What it does, as a sentence for Settings and the Guide. */
  blurb: string;
  /** How far the target lock reaches, as a multiple of the usual range. */
  lock: number;
  /** How fast it turns and pitches, as a multiple. */
  turn: number;
  /** Its top speed on boost, as a multiple. */
  boost: number;
  /** Whether the brake brings it to a stop, where the others slow to a crawl and keep moving. */
  hover: boolean;
  /** Whether it keeps its speed when it clips a tower, and loses less running into one head-on. */
  tough: boolean;
}

const PLAIN = { lock: 1, turn: 1, boost: 1, hover: false, tough: false };

export const POWERS: Record<Ship, Power> = {
  interceptor: { ...PLAIN, name: 'Long lock', blurb: 'Locks on to a badge from half as far again.', lock: 1.5 },
  dart: { ...PLAIN, name: 'Quick turn', blurb: 'Turns and climbs 30% faster.', turn: 1.3 },
  rocket: { ...PLAIN, name: 'Afterburner', blurb: 'Boosts 30% faster.', boost: 1.3 },
  saucer: { ...PLAIN, name: 'Hover', blurb: 'Brakes to a stop and hangs in the air.', hover: true },
  brick: { ...PLAIN, name: 'Thick skin', blurb: 'Keeps its speed when it clips a tower.', tough: true },
};

/** The share of its speed a ship keeps after a bump: less head-on than glancing, and more of both for a tough one. */
export function speedKept(power: Power, headOn: boolean): number {
  if (power.tough) return headOn ? 0.75 : 1;
  return headOn ? 0.45 : 0.8;
}
