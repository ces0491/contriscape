import type { Vector3, Vector4 } from 'three';

/** How many flashes the building shaders light at once. */
export const LIGHT_SLOTS = 4;
/** Flashes kept waiting or burning at once. Past this the oldest are dropped. */
const KEPT = 48;

/** A short burst of light that brightens the towers and street around it, such as a badge going up. */
export interface Flash {
  x: number;
  y: number;
  z: number;
  /** Colour at full strength, which can run past 1 for a bright flash. */
  r: number;
  g: number;
  b: number;
  /** How far the light reaches, in the scene's units. */
  reach: number;
  /** Seconds, on the same clock as `fill`. A flash can be set to start later, like a firework shell. */
  start: number;
  life: number;
}

/** A flash's strength at a time: full at once, dying away over its life, and nothing before it starts. */
export function flashLevel(flash: Flash, time: number): number {
  const age = time - flash.start;
  if (age < 0 || age >= flash.life) return 0;
  const left = 1 - age / flash.life;
  return left * left;
}

/** The flashes in the scene, handed to the building shaders a few at a time, brightest first. */
export class Flashes {
  private list: Flash[] = [];

  get count(): number {
    return this.list.length;
  }

  add(flash: Flash): void {
    this.list.push(flash);
    if (this.list.length > KEPT) this.list.shift();
  }

  /**
   * Writes the strongest flashes at this time into the light slots and empties the rest, returning how many are lit.
   * Finished flashes are dropped.
   */
  fill(time: number, positions: Vector4[], colours: Vector3[]): number {
    this.list = this.list.filter((flash) => time - flash.start < flash.life);
    const lit = this.list
      .map((flash) => ({ flash, level: flashLevel(flash, time) }))
      .filter(({ level }) => level > 0)
      .sort((a, b) => b.level * b.flash.reach - a.level * a.flash.reach);
    for (let slot = 0; slot < positions.length; slot++) {
      const entry = lit[slot];
      if (!entry) {
        colours[slot].set(0, 0, 0);
        continue;
      }
      const { flash, level } = entry;
      positions[slot].set(flash.x, flash.y, flash.z, flash.reach);
      colours[slot].set(flash.r * level, flash.g * level, flash.b * level);
    }
    return Math.min(lit.length, positions.length);
  }
}
