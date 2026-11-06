/** A frame average above this is too slow for the current quality. */
export const SLOW_FRAME_MS = 38;
/** A hidden tab comes back with a gap of minutes. The cap stops one gap reading as a slow GPU. */
const LONGEST_FRAME_MS = 100;
const WEIGHT = 0.05;
/**
 * A quality level is judged after this many frames or this much frame time, whichever comes first. The frames
 * suit a fast GPU. The time suits a software renderer, where a frame can take a third of a second and a hundred
 * of them took half a minute for each step down.
 */
const JUDGE_AFTER_FRAMES = 100;
const JUDGE_AFTER_MS = 1000;

/** A frame's time as the quality check counts it. The cap makes a long stall count as one slow frame. */
export const countedFrame = (ms: number): number => Math.min(ms, LONGEST_FRAME_MS);

export const averageFrame = (average: number, ms: number): number => average + (countedFrame(ms) - average) * WEIGHT;

/** Whether the frames since quality last changed say it should drop a step. `countedMs` sums `countedFrame`. */
export const tooSlow = (average: number, frames: number, countedMs: number): boolean =>
  average >= SLOW_FRAME_MS && (frames >= JUDGE_AFTER_FRAMES || countedMs >= JUDGE_AFTER_MS);
