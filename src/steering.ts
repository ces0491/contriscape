/** How quickly a held key builds to a full turn. */
const BUILD_UP = 3.5;
/** Two presses of one direction this close together, in seconds, are a double tap. */
export const DOUBLE_TAP = 0.3;
/** Seconds a barrel roll takes. */
export const ROLL_SECONDS = 0.6;
/** How far a barrel roll carries the ship to the side: one alley, a tower's pitch. */
export const ROLL_SHIFT = 2.5;
/** The bank a ship flies at on its side. */
export const ON_EDGE = Math.PI / 2;
/** How much faster a ship on its side turns than one that is level. */
export const EDGE_TURN = 1.5;

const smooth = (k: number) => k * k * (3 - 2 * k);

/** Steering from a key, from -1 to 1. A tap nudges the nose, holding builds to a full turn, and letting go stops it dead. */
export function keyTurn(current: number, goal: number, dt: number): number {
  if (!goal) return 0;
  const from = current * goal > 0 ? current : 0;
  return from + (goal - from) * (1 - Math.exp(-BUILD_UP * dt));
}

/** Tells a double tap of left or right from two presses of it apart, or of left then right. */
export class DoubleTap {
  private side = 0;
  private at = -Infinity;

  /** Takes a press of a direction, -1 for left and 1 for right, at a time in seconds. True when it makes a double tap. */
  press(side: -1 | 1, now: number): boolean {
    const double = side === this.side && now - this.at <= DOUBLE_TAP;
    // A third press starts counting again, so holding on through a roll doesn't set off another
    this.side = double ? 0 : side;
    this.at = now;
    return double;
  }
}

/** How far round a barrel roll has turned, in radians, `t` of the way through it. It eases in and out. */
export const rollSpin = (t: number): number => Math.PI * 2 * smooth(Math.min(1, Math.max(0, t)));

/**
 * How fast a barrel roll carries the ship sideways, `t` of the way through it, in units a second. It rises and falls
 * with the roll, and adds up to `ROLL_SHIFT` over it.
 */
export const rollDrift = (t: number): number =>
  t <= 0 || t >= 1 ? 0 : ((Math.PI / 2) * Math.sin(Math.PI * t) * ROLL_SHIFT) / ROLL_SECONDS;
