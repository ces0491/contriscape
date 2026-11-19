import { Vector3 } from 'three';
import type { CityMap } from './map';

/** A tower's height at the moment, which is lower than its full height while it is still rising. */
export type Roof = (day: number) => number;

const probe = new Vector3();
const along = new Vector3();

/** The first tower a ray meets within `range`, or -1. A ray that reaches the ground has met nothing. */
export function towerAlong(
  map: CityMap,
  roof: Roof,
  from: Vector3,
  direction: Vector3,
  range: number,
  step = 0.6,
): number {
  probe.copy(from);
  for (let t = 0; t < range; t += step) {
    probe.addScaledVector(direction, step);
    if (probe.y < 0) return -1;
    const day = map.towerAt(probe.x, probe.y, probe.z, roof);
    if (day >= 0) return day;
  }
  return -1;
}

/**
 * Whether a tower stands between two points. The last `margin` before `to` isn't checked, so a target floating over a
 * roof isn't hidden by its own tower.
 */
export function blockedBetween(
  map: CityMap,
  roof: Roof,
  from: Vector3,
  to: Vector3,
  margin = 1.5,
  step = 0.6,
): boolean {
  along.subVectors(to, from);
  const span = along.length() - margin;
  along.normalize();
  for (let t = 1; t < span; t += step) {
    probe.copy(from).addScaledVector(along, t);
    if (map.towerAt(probe.x, probe.y, probe.z, roof) >= 0) return true;
  }
  return false;
}

/**
 * How far from `a` towards `b` stays clear of every tower by `margin`, as a fraction of the way. A chase camera pulled
 * in to this fraction never sits inside a wall.
 */
export function clearReach(map: CityMap, roof: Roof, a: Vector3, b: Vector3, margin = 0.24): number {
  const steps = Math.min(16, Math.ceil(a.distanceTo(b) / 0.7));
  let clear = 0;
  for (let k = 1; k <= steps; k++) {
    probe.lerpVectors(a, b, k / steps);
    let walled = false;
    map.towersNear(probe.x, probe.z, margin, (day) => {
      if (probe.y < roof(day) + margin) walled = true;
    });
    if (walled) break;
    clear = k / steps;
  }
  return clear;
}

/**
 * The height to come at a point from, starting `distance` to its south: the lowest from which the straight line in is
 * clear of the finished city, looking no more than `ceiling` above the point.
 */
export function approachHeight(
  map: CityMap,
  target: { x: number; y: number; z: number },
  distance: number,
  ceiling = 40,
): number {
  const clearFrom = (height: number) => {
    for (let k = 0; k <= 20; k++) {
      const y = height + ((target.y - height) * k) / 20;
      const z = target.z + (distance * (20 - k)) / 20;
      if (map.towerAt(target.x, y, z) >= 0) return false;
    }
    return true;
  };
  let height = target.y;
  while (height < target.y + ceiling && !clearFrom(height)) height += 1.5;
  return height;
}
