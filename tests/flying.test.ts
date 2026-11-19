import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Calendar } from '../src/calendar';
import { pushOut, type Hull } from '../src/collision';
import { CELL, CityMap, TOWER, WIDTH } from '../src/map';
import { chooseMarkers, type Candidate } from '../src/markers';
import { approachHeight, blockedBetween, clearReach, towerAlong } from '../src/sight';

const RADIUS = 0.3;
/** Sun 1 March 2026, with a week of empty days round it and empty alleys on every side. */
const TALL = 59;
/** The day after, one row south of it in the same week. */
const LOW = TALL + 1;
/** Two rows south of the tall tower. */
const MIDDLE = TALL + 2;

/** A year that is empty but for the days given, so each test has towers exactly where it wants them. */
function city(counts: Record<number, number>): CityMap {
  const year = Array.from({ length: 365 }, (_, day) => counts[day] ?? 0);
  return new CityMap(new Calendar({ login: 'fixture', name: null, snapshot: '2026-12-31', years: { '2026': year } }));
}

const map = city({ [TALL]: 100, [LOW]: 1 });
const full = (day: number) => map.top[day];
const at = (day: number, y: number, dx = 0, dz = 0) => new Vector3(map.cx[day] + dx, y, map.cz[day] + dz);
const EAST = new Vector3(1, 0, 0);

describe('CityMap.towerAt', () => {
  it('finds the tower a point is inside, up to its roof', () => {
    expect(map.towerAt(map.cx[TALL], 10, map.cz[TALL])).toBe(TALL);
    expect(map.towerAt(map.cx[TALL], map.top[TALL] + 0.1, map.cz[TALL])).toBe(-1);
  });

  it('finds nothing in an alley, or on a day with no contributions', () => {
    expect(map.towerAt(map.cx[TALL] + CELL / 2, 1, map.cz[TALL])).toBe(-1);
    expect(map.towerAt(map.cx[TALL] + CELL, 0.25, map.cz[TALL])).toBe(-1);
  });

  it('measures a tower still rising by the height it has reached', () => {
    expect(map.towerAt(map.cx[TALL], 10, map.cz[TALL], () => 4)).toBe(-1);
    expect(map.towerAt(map.cx[TALL], 3, map.cz[TALL], () => 4)).toBe(TALL);
  });
});

describe('CityMap.outside', () => {
  it('is nothing among the blocks, and the distance to the nearest edge beyond them', () => {
    expect(map.outside(10, 5)).toBe(0);
    expect(map.outside(-30, 5)).toBeCloseTo(30);
    expect(map.outside(WIDTH + 12, 5)).toBeCloseTo(12);
    expect(map.outside(-30, map.depth + 40)).toBeCloseTo(50);
  });
});

describe('towerAlong', () => {
  it('reads the tower the ship is aimed at', () => {
    expect(towerAlong(map, full, at(TALL, 10, -20), EAST, 95)).toBe(TALL);
  });

  it('reads nothing aimed over the roof, into the ground, or from out of range', () => {
    expect(towerAlong(map, full, at(TALL, map.top[TALL] + 2, -20), EAST, 95)).toBe(-1);
    expect(towerAlong(map, full, at(TALL, 6, -20), new Vector3(0.6, -0.8, 0), 95)).toBe(-1);
    expect(towerAlong(map, full, at(TALL, 10, -20), EAST, 12)).toBe(-1);
  });

  it('sees past a tower that has not risen that far yet', () => {
    expect(towerAlong(map, () => 2, at(TALL, 10, -20), EAST, 95)).toBe(-1);
  });
});

describe('blockedBetween', () => {
  it('is blocked by a tower in the way, and clear over its roof', () => {
    expect(blockedBetween(map, full, at(TALL, 10, -12), at(TALL, 10, 12))).toBe(true);
    expect(blockedBetween(map, full, at(TALL, map.top[TALL] + 3, -12), at(TALL, map.top[TALL] + 3, 12))).toBe(false);
  });

  it('does not count the tower a badge floats over as in the way', () => {
    const badge = at(TALL, map.top[TALL] + 0.5);
    expect(blockedBetween(map, full, at(TALL, map.top[TALL] + 0.5, 0, 12), badge)).toBe(false);
  });
});

describe('clearReach', () => {
  it('lets a chase camera sit all the way back in the open', () => {
    expect(clearReach(map, full, at(TALL, 40), at(TALL, 40, -6))).toBe(1);
  });

  it('pulls the camera in to the near side of a wall', () => {
    const ship = at(TALL, 10, -3);
    const wanted = at(TALL, 10, 3);
    const reach = clearReach(map, full, ship, wanted);
    expect(reach).toBeGreaterThan(0);
    expect(reach).toBeLessThan(0.5);
    expect(map.towerAt(ship.x + (wanted.x - ship.x) * reach, 10, ship.z)).toBe(-1);
  });

  it('ignores a wall the line passes over', () => {
    expect(clearReach(map, full, at(LOW, map.top[LOW] + 1, -3), at(LOW, map.top[LOW] + 1, 3))).toBe(1);
  });
});

describe('approachHeight', () => {
  it('comes in level when nothing stands to the south', () => {
    const target = at(LOW, map.top[LOW] + 2);
    expect(approachHeight(map, target, 10)).toBe(target.y);
  });

  it('comes in from higher when a tower stands on the way in, high enough to clear it', () => {
    // The badge floats over a low tower, with a taller one two rows south of it. The tallest is weeks away.
    const walled = city({ [TALL]: 1, [MIDDLE]: 25, [TALL + 21]: 100 });
    const target = { x: walled.cx[TALL], y: walled.top[TALL] + 2, z: walled.cz[TALL] };
    expect(walled.cz[MIDDLE] - target.z).toBeCloseTo(CELL * 2);
    expect(walled.top[MIDDLE]).toBeGreaterThan(target.y + 5);
    const height = approachHeight(walled, target, 10);
    expect(height).toBeGreaterThan(target.y);
    expect(height).toBeLessThan(target.y + 40);
    for (let k = 0; k <= 20; k++) {
      const y = height + ((target.y - height) * k) / 20;
      expect(walled.towerAt(target.x, y, target.z + (10 * (20 - k)) / 20)).toBe(-1);
    }
  });

  it('stops looking at its ceiling', () => {
    const target = at(LOW, 4, 0, -CELL * 2);
    const height = approachHeight(map, target, 10, 6);
    expect(height).toBeGreaterThanOrEqual(target.y + 6);
    expect(height).toBeLessThan(target.y + 8);
  });
});

describe('pushOut', () => {
  const hull = (pos: Vector3, heading: Vector3, pitch = 0): Hull => ({
    pos,
    fwd: { x: heading.x, z: heading.z },
    yaw: Math.atan2(-heading.x, -heading.z),
    pitch,
  });
  const bumps = (ship: Hull, roof = full) => {
    const seen: [number, boolean][] = [];
    pushOut(map, roof, ship, RADIUS, (day, headOn) => seen.push([day, headOn]));
    return seen;
  };

  it('leaves a ship in an alley, or over the roofs, alone', () => {
    const alley = hull(at(TALL, 5, CELL / 2), EAST);
    expect(bumps(alley)).toEqual([]);
    expect(alley.pos.x).toBeCloseTo(map.cx[TALL] + CELL / 2);
    const above = hull(at(TALL, map.top[TALL] + RADIUS + 0.1), EAST, -0.3);
    expect(bumps(above)).toEqual([]);
    expect(above.pitch).toBe(-0.3);
  });

  it('sets a ship that came down onto a roof on top of it, and eases its dive', () => {
    const ship = hull(at(LOW, map.top[LOW] + 0.1), EAST, -0.4);
    expect(bumps(ship)).toEqual([]);
    expect(ship.pos.y).toBeCloseTo(map.top[LOW] + RADIUS);
    expect(ship.pitch).toBeCloseTo(-0.2);
  });

  it('pushes a ship that clipped a wall back out the short way, and says it glanced off', () => {
    const north = new Vector3(0, 0, -1);
    const ship = hull(at(TALL, 10, -(TOWER / 2 + RADIUS) + 0.1), north);
    expect(bumps(ship)).toEqual([[TALL, false]]);
    expect(map.cx[TALL] - ship.pos.x).toBeCloseTo(TOWER / 2 + RADIUS);
    expect(ship.pos.z).toBeCloseTo(map.cz[TALL]);
    expect(ship.yaw).toBeCloseTo(0);
  });

  it('turns a ship that met a wall head on to fly back the way it came', () => {
    const ship = hull(at(TALL, 10, -(TOWER / 2 + RADIUS) + 0.1), EAST);
    expect(bumps(ship)).toEqual([[TALL, true]]);
    expect(map.cx[TALL] - ship.pos.x).toBeCloseTo(TOWER / 2 + RADIUS);
    // Heading west now: the mirror of east in the wall it struck
    expect(-Math.sin(ship.yaw)).toBeCloseTo(-1);
    expect(-Math.cos(ship.yaw)).toBeCloseTo(0);
  });

  it('lets a ship through where a tower has not risen that far yet', () => {
    const ship = hull(at(TALL, 10), EAST);
    expect(bumps(ship, () => 2)).toEqual([]);
    expect(ship.pos.y).toBe(10);
  });
});

describe('chooseMarkers', () => {
  const marker = (i: number, x: number, y: number, distance: number, inside = false): Candidate => ({
    i,
    placed: { x, y, inside, angle: 0 },
    distance,
  });
  const shown = (candidates: Candidate[], edgeLimit = 4) => chooseMarkers(candidates, 44, edgeLimit).map((c) => c.i);

  it('lists the nearest badge first', () => {
    expect(shown([marker(0, 0, 0, 90), marker(1, 200, 0, 20), marker(2, 400, 0, 50)])).toEqual([1, 2, 0]);
  });

  it('keeps the nearer badge where two markers would sit on one another', () => {
    expect(shown([marker(0, 100, 100, 80), marker(1, 120, 110, 30)])).toEqual([1]);
  });

  it('gives markers in view half the room of those at the edge', () => {
    const apart = (inside: boolean) => [marker(0, 100, 100, 30, inside), marker(1, 130, 100, 60, inside)];
    expect(shown(apart(true))).toEqual([0, 1]);
    expect(shown(apart(false))).toEqual([0]);
  });

  it('pins only so many to the edge, and still marks every badge in view', () => {
    const edge = [0, 1, 2, 3, 4, 5].map((i) => marker(i, i * 100, 0, 10 + i));
    const inView = [6, 7].map((i) => marker(i, i * 100, 300, 500 + i, true));
    expect(shown([...edge, ...inView], 4)).toEqual([0, 1, 2, 3, 6, 7]);
  });

  it('leaves the list it was given as it was', () => {
    const given = [marker(0, 0, 0, 90), marker(1, 200, 0, 20)];
    chooseMarkers(given, 44, 4);
    expect(given.map((c) => c.i)).toEqual([0, 1]);
  });
});
