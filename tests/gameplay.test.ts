import { Quaternion, Scene, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { holdsLock, LOCK_CONE, LOCK_RANGE, lockCone, lockOn, turnTowards } from '../src/aim';
import { BADGE_RADIUS, closestPass, TOUCH_REACH } from '../src/badges';
import { SHIP_HALF_SPAN, Weapons } from '../src/fighter';
import { flashLevel, Flashes, LIGHT_SLOTS, type Flash } from '../src/lights';
import { placeMarker, type Insets } from '../src/markers';
import { TRAIL_FRAGMENT } from '../src/shaders';
import { Trails } from '../src/trails';

const ahead = new Vector3(0, 0, -1);
const origin = new Vector3();

describe('lockOn', () => {
  const at = (degrees: number, distance: number) => {
    const a = (degrees * Math.PI) / 180;
    return new Vector3(Math.sin(a) * distance, 0, -Math.cos(a) * distance);
  };

  it('locks on to the target nearest the line of fire', () => {
    expect(lockOn(origin, ahead, [at(6, 40), at(2, 60), at(4, 20)])).toBe(1);
  });

  it('ignores targets outside the cone, out of range, behind, or gone', () => {
    const wide = ((LOCK_CONE * 180) / Math.PI) * 1.5;
    expect(lockOn(origin, ahead, [at(wide, 60), at(1, LOCK_RANGE + 5), at(180, 30), null])).toBe(-1);
  });

  it('holds a lock a little past the edge where it was taken, so it does not flicker', () => {
    const edge = ((LOCK_CONE * 180) / Math.PI) * 1.15;
    expect(lockOn(origin, ahead, [at(edge, 60)])).toBe(-1);
    expect(holdsLock(origin, ahead, at(edge, 60))).toBe(true);
    expect(holdsLock(origin, ahead, at(edge * 1.5, 60))).toBe(false);
    expect(holdsLock(origin, ahead, at(0, LOCK_RANGE * 1.5))).toBe(false);
  });

  it('widens the cone up close, where a badge fills more of the view', () => {
    expect(lockCone(4)).toBeGreaterThan(LOCK_CONE);
    expect(lockCone(LOCK_RANGE)).toBe(LOCK_CONE);
    expect(lockOn(origin, ahead, [at(20, 5)])).toBe(0);
    expect(lockOn(origin, ahead, [at(20, 60)])).toBe(-1);
  });
});

describe('turnTowards', () => {
  it('turns no further than the limit, and stays a unit vector', () => {
    const dir = ahead.clone();
    turnTowards(dir, new Vector3(1, 0, 0), 0.2);
    expect(dir.angleTo(ahead)).toBeCloseTo(0.2, 6);
    expect(dir.length()).toBeCloseTo(1, 9);
  });

  it('lands on the goal when it is within the limit', () => {
    const goal = new Vector3(0.05, 0, -1);
    const dir = turnTowards(ahead.clone(), goal, 0.5);
    expect(dir.angleTo(goal)).toBeLessThan(1e-6);
  });

  it('leaves the direction alone for a goal straight behind', () => {
    expect(turnTowards(ahead.clone(), new Vector3(0, 0, 1), 0.3)).toEqual(ahead);
  });
});

describe('Weapons', () => {
  /** Fires one volley and runs it until it lands or dies, reporting whether it came within reach of the target. */
  const volley = (target: Vector3 | null, aim: Vector3) => {
    const weapons = new Weapons(new Scene(), () => 0.5, { value: 1 });
    const goal = new Vector3(4, 0, -45);
    weapons.fire(origin, aim, new Quaternion(), target);
    let hit = false;
    for (let n = 0; n < 120 && weapons.activeBolts > 0; n++) {
      weapons.update(
        1 / 60,
        (p) => (p.distanceTo(goal) < 1.8 ? -1 : null),
        () => {
          hit = true;
        },
      );
    }
    return hit;
  };

  it('misses a badge a few degrees off the line of fire', () => {
    expect(volley(null, ahead)).toBe(false);
  });

  it('curves a shot fired while locked on into the badge', () => {
    expect(volley(new Vector3(4, 0, -45), ahead)).toBe(true);
  });
});

describe('closestPass', () => {
  const badge = new Vector3(10, 20, -30);
  const from = (dx: number, dy: number, dz: number) => new Vector3(badge.x + dx, badge.y + dy, badge.z + dz);

  it('is nothing for a move straight through a badge', () => {
    expect(closestPass(from(0, 0, 2), from(0, 0, -2), badge)).toBeCloseTo(0);
  });

  it('catches a fast frame that starts in front of a badge and ends past it', () => {
    // A Rocket on full boost covers about 3 units in the longest frame the game steps
    expect(closestPass(from(0.5, 0, 1.6), from(0.5, 0, -1.6), badge)).toBeCloseTo(0.5);
  });

  it('measures from the nearer end when the move stops short of a badge or starts past it', () => {
    expect(closestPass(from(0, 0, 6), from(0, 0, 3), badge)).toBeCloseTo(3);
    expect(closestPass(from(0, 0, -3), from(0, 0, -6), badge)).toBeCloseTo(3);
  });

  it('works for a ship standing still', () => {
    expect(closestPass(from(0, 1, 0), from(0, 1, 0), badge)).toBeCloseTo(1);
  });

  it('takes a wingtip brushing the rim as flying into a badge, and a wider pass as a miss', () => {
    const brush = BADGE_RADIUS + SHIP_HALF_SPAN * 0.9;
    expect(closestPass(from(brush, 0, 2), from(brush, 0, -2), badge)).toBeLessThanOrEqual(TOUCH_REACH);
    const wide = TOUCH_REACH + 0.2;
    expect(closestPass(from(0, wide, 2), from(0, wide, -2), badge)).toBeGreaterThan(TOUCH_REACH);
  });
});

describe('placeMarker', () => {
  const inset: Insets = { top: 80, right: 20, bottom: 140, left: 20 };
  const W = 1200;
  const H = 800;

  it('marks a point in view where it is', () => {
    const placed = placeMarker(0.5, 0.25, false, W, H, inset);
    expect(placed.inside).toBe(true);
    expect(placed.x).toBeCloseTo(900);
    expect(placed.y).toBeCloseTo(300);
  });

  it('pins a point off to the right to the right edge, on the line from the centre', () => {
    const placed = placeMarker(3, 0, false, W, H, inset);
    expect(placed.inside).toBe(false);
    expect(placed.x).toBeCloseTo(W - inset.right);
    expect(placed.y).toBeCloseTo(H / 2);
    expect(placed.angle).toBeCloseTo(0);
  });

  it('turns a point behind the camera back round, so it points the way to turn', () => {
    // Behind and to the right projects to the left, mirrored through the centre
    const placed = placeMarker(-0.4, 0, true, W, H, inset);
    expect(placed.inside).toBe(false);
    expect(placed.x).toBeCloseTo(W - inset.right);
  });

  it('points down for a point straight behind', () => {
    const placed = placeMarker(0, 0, true, W, H, inset);
    expect(placed.y).toBeCloseTo(H - inset.bottom);
    expect(placed.angle).toBeCloseTo(Math.PI / 2);
  });

  it('keeps every pinned marker inside the insets', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      for (const behind of [false, true]) {
        const placed = placeMarker(Math.cos(a) * 5, Math.sin(a) * 5, behind, W, H, inset);
        expect(placed.x).toBeGreaterThanOrEqual(inset.left - 1e-6);
        expect(placed.x).toBeLessThanOrEqual(W - inset.right + 1e-6);
        expect(placed.y).toBeGreaterThanOrEqual(inset.top - 1e-6);
        expect(placed.y).toBeLessThanOrEqual(H - inset.bottom + 1e-6);
      }
    }
  });
});

describe('Flashes', () => {
  const flash = (over: Partial<Flash>): Flash => ({
    x: 0,
    y: 0,
    z: 0,
    r: 1,
    g: 1,
    b: 1,
    reach: 10,
    start: 0,
    life: 1,
    ...over,
  });
  const slots = () => ({
    positions: Array.from({ length: LIGHT_SLOTS }, () => new Vector4()),
    colours: Array.from({ length: LIGHT_SLOTS }, () => new Vector3()),
  });

  it('is brightest at once, and gone at the end of its life and before its start', () => {
    const f = flash({ start: 2, life: 1 });
    expect(flashLevel(f, 1.99)).toBe(0);
    expect(flashLevel(f, 2)).toBe(1);
    expect(flashLevel(f, 2.5)).toBeCloseTo(0.25);
    expect(flashLevel(f, 3)).toBe(0);
  });

  it('lights the strongest flashes first and leaves the other slots dark', () => {
    const flashes = new Flashes();
    flashes.add(flash({ x: 1, reach: 5 }));
    flashes.add(flash({ x: 2, reach: 30 }));
    const { positions, colours } = slots();
    expect(flashes.fill(0.1, positions, colours)).toBe(2);
    expect(positions[0].x).toBe(2);
    expect(positions[0].w).toBe(30);
    expect(positions[1].x).toBe(1);
    expect(colours[2].length()).toBe(0);
    expect(colours[3].length()).toBe(0);
  });

  it('waits for a delayed flash, like a firework shell, then forgets it once it has burned out', () => {
    const flashes = new Flashes();
    flashes.add(flash({ start: 1, life: 0.5 }));
    const { positions, colours } = slots();
    flashes.fill(0.5, positions, colours);
    expect(colours[0].length()).toBe(0);
    expect(flashes.count).toBe(1);
    flashes.fill(1.1, positions, colours);
    expect(colours[0].length()).toBeGreaterThan(0);
    flashes.fill(1.6, positions, colours);
    expect(flashes.count).toBe(0);
  });
});

describe('Trails', () => {
  const drawn = (scene: Scene) =>
    (scene.children[0] as unknown as { geometry: { drawRange: { count: number } } }).geometry.drawRange.count;

  it('lays a ribbon behind a moving wingtip', () => {
    const scene = new Scene();
    const trails = new Trails(scene);
    const camera = new Vector3(0, 3, 10);
    for (let n = 0; n < 10; n++) {
      trails.update(new Vector3(-1, 0, -n * 0.5), new Vector3(1, 0, -n * 0.5), 1, n / 60, camera);
    }
    expect(drawn(scene)).toBeGreaterThan(0);
  });

  it('clamps what its shader is handed, which multisampling can throw far out of range on a thin ribbon', () => {
    expect(TRAIL_FRAGMENT).toContain('clamp(vA,0.,1.)');
    expect(TRAIL_FRAGMENT).toContain('clamp(vSide,-1.,1.)');
    // Nothing but the clamped copies reaches the colour
    expect(TRAIL_FRAGMENT.split('gl_FragColor')[1]).not.toMatch(/vA|vSide/);
  });

  it('starts again after a jump instead of stretching across the city', () => {
    const scene = new Scene();
    const trails = new Trails(scene);
    const camera = new Vector3(0, 3, 10);
    for (let n = 0; n < 10; n++) {
      trails.update(new Vector3(-1, 0, -n * 0.5), new Vector3(1, 0, -n * 0.5), 1, n / 60, camera);
    }
    const before = drawn(scene);
    trails.update(new Vector3(-1, 0, -300), new Vector3(1, 0, -300), 1, 11 / 60, camera);
    expect(drawn(scene)).toBeLessThan(before);
  });
});
