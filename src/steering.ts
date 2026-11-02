/** How quickly a held key builds to a full turn. */
const BUILD_UP = 3.5;

/** Steering from a key, from -1 to 1. A tap nudges the nose, holding builds to a full turn, and letting go stops it dead. */
export function keyTurn(current: number, goal: number, dt: number): number {
  if (!goal) return 0;
  const from = current * goal > 0 ? current : 0;
  return from + (goal - from) * (1 - Math.exp(-BUILD_UP * dt));
}
