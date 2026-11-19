import { TOWER, type CityMap } from './map';
import type { Roof } from './sight';

/** The parts of a ship that striking a tower changes. */
export interface Hull {
  pos: { x: number; y: number; z: number };
  /** The way the ship is heading, as a unit vector. */
  fwd: { x: number; z: number };
  yaw: number;
  pitch: number;
}

/** A ship that has sunk no further than this into a roof is set down on it, instead of thrown out of a wall. */
const SKIM = 1.2;
/** A ship that meets a wall more squarely than this is turned to fly away from it. */
const HEAD_ON = -0.45;

/**
 * Moves a ship out of any tower it has flown into. One that came down onto a roof skims over it, and a dive is eased.
 * One that flew into a wall is pushed back out the short way and `bump` is told, and if it met the wall head on its
 * heading is turned away, like a ball off a cushion.
 */
export function pushOut(
  map: CityMap,
  roof: Roof,
  ship: Hull,
  radius: number,
  bump: (day: number, headOn: boolean) => void,
): void {
  map.towersNear(ship.pos.x, ship.pos.z, radius, (day) => {
    const top = roof(day);
    const sunk = top + radius - ship.pos.y;
    if (sunk <= 0) return;
    const dx = ship.pos.x - map.cx[day];
    const dz = ship.pos.z - map.cz[day];
    const px = TOWER / 2 + radius - Math.abs(dx);
    const pz = TOWER / 2 + radius - Math.abs(dz);
    if (sunk < Math.min(px, pz) && sunk < SKIM) {
      ship.pos.y = top + radius;
      if (ship.pitch < 0) ship.pitch *= 0.5;
      return;
    }
    const alongX = px < pz;
    const nx = alongX ? Math.sign(dx) || 1 : 0;
    const nz = alongX ? 0 : Math.sign(dz) || 1;
    const dot = ship.fwd.x * nx + ship.fwd.z * nz;
    if (alongX) ship.pos.x += nx * px;
    else ship.pos.z += nz * pz;
    const headOn = dot < HEAD_ON;
    if (headOn) ship.yaw = Math.atan2(-(ship.fwd.x - 2 * dot * nx), -(ship.fwd.z - 2 * dot * nz));
    bump(day, headOn);
  });
}
