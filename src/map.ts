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
  private readonly scale: number;

  constructor(readonly cal: Calendar) {
    const { days } = cal;
    this.scale = cal.peak ? TALLEST / Math.sqrt(cal.peak) : 1;
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

  towerHeight(count: number): number {
    return count ? this.scale * Math.sqrt(count) : 0.1;
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

  /** The street beside a year's block, on the side of its busier neighbour. */
  streetFor(year: number): number {
    const { cal } = this;
    const north = year < cal.lastYear ? cal.yearTotal(year + 1) : -1;
    const south = year > cal.firstYear ? cal.yearTotal(year - 1) : -1;
    return north > south ? this.blockZ(year) - ROAD / 2 : this.blockZ(year) + DEPTH + ROAD / 2;
  }
}
