import type { Calendar } from './calendar';
import { busyYears } from './routes';
import { ZOOM_MIN } from './zoom';

/** A flight the screensaver shows: one year, or the whole history. */
export type SaverScope = 'all' | number;

export interface Shot {
  scope: SaverScope;
  /** How far behind the ship the flight is watched from, as Autopilot's zoom. */
  zoom: number;
}

/** Seconds without a key press, click, tap, scroll or move of the mouse before the screensaver starts by itself. */
export const IDLE_SECONDS = 120;
/** Seconds the screensaver orbits the city after a flight before it flies the next. */
export const ORBIT_SECONDS = 20;
/** Seconds the line naming the city and its years stays up at the start of each flight. */
export const NAME_SECONDS = 8;
/** For this long after it starts, the mouse can move without ending it, so the hand that pressed Start can let go. */
export const SETTLE_SECONDS = 1;
/** Pixels the mouse has to move to end it, so a knock of the desk doesn't. */
export const WAKE_PIXELS = 10;
/** The flights are watched from behind the ship, from further back, and from the cockpit, in turn. */
export const SHOT_ZOOMS = [1, 2.6, ZOOM_MIN];

/** What the screensaver flies: each busy year, and the whole history where there is more than one year. */
export function saverScopes(cal: Calendar): SaverScope[] {
  const busy = busyYears(cal);
  const years: SaverScope[] = busy.length ? busy : [cal.lastYear];
  return cal.years.length > 1 ? ['all', ...years] : years;
}

/**
 * The order of the screensaver's flights: all of them in a shuffled round, then another round, with no flight twice
 * running. The zoom steps round on its own.
 */
export class Programme {
  private round: SaverScope[] = [];
  private last: SaverScope | null = null;
  private shots = 0;

  constructor(
    private readonly scopes: readonly SaverScope[],
    private readonly random: () => number,
  ) {}

  next(): Shot {
    if (!this.round.length) this.round = this.shuffled();
    const scope = this.round.shift() as SaverScope;
    this.last = scope;
    return { scope, zoom: SHOT_ZOOMS[this.shots++ % SHOT_ZOOMS.length] };
  }

  private shuffled(): SaverScope[] {
    const round = [...this.scopes];
    for (let i = round.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [round[i], round[j]] = [round[j], round[i]];
    }
    // A round doesn't open on the flight the one before it closed with
    const end = round.length - 1;
    if (end > 0 && round[0] === this.last) [round[0], round[end]] = [round[end], round[0]];
    return round;
  }
}

/** Tells a move of the mouse that ends the screensaver from the drift of a hand letting go of it. */
export class Wake {
  private rest: { x: number; y: number } | null = null;

  /** `since` is when the screensaver started, in milliseconds. */
  constructor(private readonly since: number) {}

  /** Whether the mouse at `x`, `y` in screen pixels, at `now` in milliseconds, ends the screensaver. */
  moved(now: number, x: number, y: number): boolean {
    if (now - this.since < SETTLE_SECONDS * 1000) return false;
    if (!this.rest) {
      this.rest = { x, y };
      return false;
    }
    return Math.hypot(x - this.rest.x, y - this.rest.y) > WAKE_PIXELS;
  }
}
