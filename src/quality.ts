/** A frame average above this is too slow for the current quality. */
export const SLOW_FRAME_MS = 38;
/** A hidden tab comes back with a gap of minutes. The cap stops one gap reading as a slow GPU. */
const LONGEST_FRAME_MS = 100;
const WEIGHT = 0.05;

export const averageFrame = (average: number, ms: number): number =>
  average + (Math.min(ms, LONGEST_FRAME_MS) - average) * WEIGHT;
