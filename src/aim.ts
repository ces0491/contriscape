import { Vector3 } from 'three';

/** A badge inside this angle of the line of fire can be locked on to, in radians. About eight degrees. */
export const LOCK_CONE = 0.14;
/** Badges further away than this can't be locked on to. */
export const LOCK_RANGE = 90;
/** Up close a badge fills more of the view than the cone, so the cone widens to cover this much of it. */
const LOCK_REACH = 2.2;
/** A lock already held lasts out to this much wider a cone and longer a range, so it doesn't flicker at the edge. */
const HOLD = 1.35;

const towards = new Vector3();
const axis = new Vector3();

/** The angle within which a target this far away locks on. */
export const lockCone = (distance: number): number => Math.max(LOCK_CONE, Math.atan2(LOCK_REACH, distance));

/**
 * The target closest to the line of fire, among those inside the lock cone and in range, or -1. A null target is one
 * that can't be locked on to, such as a badge already blown up.
 */
export function lockOn(from: Vector3, forward: Vector3, targets: readonly (Vector3 | null)[]): number {
  let best = -1;
  let bestAngle = Infinity;
  targets.forEach((target, i) => {
    if (!target) return;
    towards.subVectors(target, from);
    const distance = towards.length();
    if (distance > LOCK_RANGE || distance < 1e-6) return;
    const angle = forward.angleTo(towards);
    if (angle <= lockCone(distance) && angle < bestAngle) {
      best = i;
      bestAngle = angle;
    }
  });
  return best;
}

/** Whether a lock already held on a target still holds, inside the looser cone and range that keep it steady. */
export function holdsLock(from: Vector3, forward: Vector3, target: Vector3): boolean {
  towards.subVectors(target, from);
  const distance = towards.length();
  if (distance > LOCK_RANGE * HOLD || distance < 1e-6) return false;
  return forward.angleTo(towards) <= lockCone(distance) * HOLD;
}

/** Turns a unit direction towards another direction by at most `limit` radians. It stays a unit vector. */
export function turnTowards(direction: Vector3, goal: Vector3, limit: number): Vector3 {
  const angle = direction.angleTo(goal);
  if (angle <= limit) return direction.copy(goal).normalize();
  axis.crossVectors(direction, goal);
  // Pointing exactly away leaves no single way to turn, and a bolt never homes on something behind it
  if (axis.lengthSq() < 1e-12) return direction;
  return direction.applyAxisAngle(axis.normalize(), limit).normalize();
}
