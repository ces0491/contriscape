import type { Calendar } from './calendar';

export const CELL = 2.5;
export const TOWER = 1.15;
export const ROWS = 7;
export const WEEKS = 53;
export const ROAD = 7;
export const PLINTH = 0.2;
export const DEPTH = ROWS * CELL;
export const WIDTH = WEEKS * CELL;
export const YEAR_PITCH = DEPTH + ROAD;
const TALLEST = 28;
/**
 * How far past a benchmark day the busiest day can stand, as a share of the benchmark's height. Days above the
 * benchmark ease towards this, so one enormous day adds a little height and doesn't flatten every other tower.
 */
const OVERSHOOT = 1 / 3;

/**
 * A day's height against a benchmark day's, given the square root of the ratio of their counts. It rises in step up to
 * the benchmark and eases off above it, always climbing, so a busier day is still a taller tower.
 */
const standing = (ratio: number): number =>
  ratio <= 1 ? ratio : 1 + OVERSHOOT * (1 - Math.exp(-(ratio - 1) / OVERSHOOT));
/** The last week of a leap year starting on a Saturday spills into a 54th column. */
const GRID_WEEKS = WEEKS + 1;

/** Where every day stands: the calendar opened out into a street grid, newest year furthest north. */
export class CityMap {
  readonly cx: Float32Array;
  readonly cz: Float32Array;
  /** Roof height of each day's tower, including the plinth. */
  readonly top: Float32Array;
  readonly depth: number;
  private readonly grid: Int32Array;
  /** The busiest day's standing against the benchmark, which every height is divided by so that day is the tallest. */
  private readonly crest: number;

  constructor(readonly cal: Calendar) {
    const { days } = cal;
    this.crest = cal.peak ? standing(Math.sqrt(cal.peak / cal.benchmark)) : 1;
    this.depth = this.blockZ(cal.firstYear) + DEPTH;
    this.grid = new Int32Array(cal.years.length * GRID_WEEKS * ROWS).fill(-1);
    this.cx = new Float32Array(days);
    this.cz = new Float32Array(days);
    this.top = new Float32Array(days);
    for (let i = 0; i < days; i++) {
      const c = cal.cellOf(i);
      this.grid[this.slot(c.year, c.week, c.row)] = i;
      this.cx[i] = (c.week + 0.5) * CELL;
      this.cz[i] = this.blockZ(c.year) + (c.row + 0.5) * CELL;
      this.top[i] = PLINTH + this.towerHeight(cal.counts[i]);
    }
  }

  private slot(year: number, week: number, row: number): number {
    return (year - this.cal.firstYear) * GRID_WEEKS * ROWS + week * ROWS + row;
  }

  blockZ(year: number): number {
    return (this.cal.lastYear - year) * YEAR_PITCH;
  }

  /** A day's height as a share of the tallest tower's: 0 with no contributions, 1 on the busiest day. */
  share(count: number): number {
    return count ? standing(Math.sqrt(count / this.cal.benchmark)) / this.crest : 0;
  }

  towerHeight(count: number): number {
    return count ? TALLEST * this.share(count) : 0.1;
  }

  /**
   * The count that would stand as tall as the tallest tower if days above the benchmark weren't eased. The music takes
   * its top note from this, so its notes spread over the scale as the towers spread over the heights.
   */
  get fullCount(): number {
    return this.cal.benchmark * this.crest * this.crest;
  }

  /** The tower height at a grid position, or 0 where there is no tower. */
  heightAt(year: number, week: number, row: number): number {
    if (week < 0 || week >= GRID_WEEKS || row < 0 || row >= ROWS) return 0;
    const i = this.grid[this.slot(year, week, row)];
    return i >= 0 ? this.towerHeight(this.cal.counts[i]) : 0;
  }

  /** The day whose grid square contains a point, or -1 outside every block. */
  cellIndex(x: number, z: number): number {
    const k = Math.floor(z / YEAR_PITCH);
    const year = this.cal.lastYear - k;
    const local = z - k * YEAR_PITCH;
    if (year < this.cal.firstYear || year > this.cal.lastYear || local < 0 || local >= DEPTH) return -1;
    const week = Math.floor(x / CELL);
    return week < 0 || week >= GRID_WEEKS ? -1 : this.grid[this.slot(year, week, Math.floor(local / CELL))];
  }

  /**
   * The tower a point is inside, or -1. `roof` gives each tower's height at the moment, which is lower while it is
   * still rising. Without it the finished city is used.
   */
  towerAt(x: number, y: number, z: number, roof: (day: number) => number = (day) => this.top[day]): number {
    const i = this.cellIndex(x, z);
    if (i < 0 || !this.cal.counts[i]) return -1;
    const inside = Math.abs(x - this.cx[i]) < TOWER / 2 && Math.abs(z - this.cz[i]) < TOWER / 2;
    return inside && y < roof(i) ? i : -1;
  }

  /** Calls `visit` for each tower whose footprint lies within `radius` of a point. Radius must be under CELL. */
  towersNear(x: number, z: number, radius: number, visit: (day: number) => void): void {
    const reach = TOWER / 2 + radius;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const i = this.cellIndex(x + a * CELL, z + b * CELL);
        if (i >= 0 && this.cal.counts[i] && Math.abs(x - this.cx[i]) < reach && Math.abs(z - this.cz[i]) < reach) {
          visit(i);
        }
      }
    }
  }

  /** How far a point on the ground is outside the city's blocks, or 0 among them. */
  outside(x: number, z: number): number {
    return Math.hypot(Math.max(-x, 0, x - WIDTH), Math.max(-z, 0, z - this.depth));
  }

  /** The street beside a year's block, on the side of its busier neighbour. */
  streetFor(year: number): number {
    const { cal } = this;
    const north = year < cal.lastYear ? cal.yearTotal(year + 1) : -1;
    const south = year > cal.firstYear ? cal.yearTotal(year - 1) : -1;
    return north > south ? this.blockZ(year) - ROAD / 2 : this.blockZ(year) + DEPTH + ROAD / 2;
  }
}
