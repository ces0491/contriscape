/** Minutes and seconds, as a clock shows them. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Minutes, seconds and tenths, for a race: 0:41.2. The hundredths are cut off, so 0:41.2 means 41.2 seconds have passed. */
export function formatLap(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`;
}

/**
 * The clock on clearing a city by flying. It starts from a city with no badge earned and counts the time the ship is
 * flown. A jump from the Badges list ends the timing, because it carries the ship across the city in no time, and so
 * does a visit that starts with badges already earned, because nothing timed how those were won.
 */
export class Run {
  private elapsed = 0;
  private live: boolean;

  constructor(fresh: boolean) {
    this.live = fresh;
  }

  /** Whether the clock is still running on a clear that will count. */
  get timed(): boolean {
    return this.live;
  }

  get seconds(): number {
    return this.elapsed;
  }

  /** Counts a stretch of flying. */
  tick(dt: number): void {
    if (this.live) this.elapsed += dt;
  }

  /** A jump from the Badges list was taken. */
  jumped(): void {
    this.live = false;
  }

  /** The city is cleared: the time it took if the clear was timed, or null. The clock stops either way. */
  finish(): number | null {
    const time = this.live ? this.elapsed : null;
    this.live = false;
    return time;
  }

  /** Starts over from nothing, as when the badges are reset. */
  reset(): void {
    this.elapsed = 0;
    this.live = true;
  }
}
