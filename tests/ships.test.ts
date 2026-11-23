import { describe, expect, it } from 'vitest';
import { Vector3, type BufferGeometry } from 'three';
import { holdsLock, LOCK_RANGE, lockOn } from '../src/aim';
import { cockpitMarkup } from '../src/cockpits';
import {
  DEFAULT_SHIP,
  EDITION_SHIP,
  halfSpan,
  mirrored,
  muzzleOf,
  readShip,
  SHIP_HALF_SPAN,
  SHIP_LABELS,
  SHIPS,
  WIDEST,
  wing,
  type Design,
} from '../src/fighter';

/** The ships in Settings, and the year's own. */
const DESIGNS: Design[] = [...SHIPS, EDITION_SHIP];
import { POWERS, speedKept } from '../src/powers';

describe('the ships', () => {
  it.each(DESIGNS)('%s fits the width the flight paths leave it, lights and guns included', (ship) => {
    const reach = halfSpan(ship);
    expect(reach).toBeLessThanOrEqual(WIDEST);
    // Narrow enough to slip through anything would be a different game
    expect(reach).toBeGreaterThan(0.4);
  });

  it.each(DESIGNS)('%s fires from muzzles of its own, ahead of its centre and inside its width', (ship) => {
    const muzzle = muzzleOf(ship);
    expect(muzzle.z).toBeLessThan(0);
    expect(muzzle.x).toBeGreaterThan(0);
    expect(muzzle.x).toBeLessThan(SHIP_HALF_SPAN);
  });

  it('reach no further once scaled than the 0.42 the flight paths clear every tower by', () => {
    expect(SHIP_HALF_SPAN).toBeLessThanOrEqual(0.42);
  });

  it('each have a name for their button', () => {
    expect(SHIPS.map((ship) => SHIP_LABELS[ship])).toEqual(['Interceptor', 'Dart', 'Rocket', 'Saucer', 'Brick']);
  });
});

describe('a lofted wing', () => {
  /** The volume a closed surface holds, which comes out negative if its triangles face inwards. */
  const volume = (geometry: BufferGeometry) => {
    const p = geometry.getAttribute('position');
    const index = geometry.getIndex();
    let total = 0;
    for (let i = 0; index && i < index.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(p, index.getX(i + k)));
      total += a.dot(b.cross(c)) / 6;
    }
    return total;
  };
  const stations = [
    { x: 0.1, le: -0.3, te: 0.4, t: 0.04 },
    { x: 0.5, le: 0.3, te: 0.42, t: 0.008 },
  ];

  it('faces outwards, and so does its mirror image on the other side', () => {
    const right = wing(stations);
    expect(volume(right)).toBeGreaterThan(0);
    expect(volume(mirrored(right))).toBeCloseTo(volume(right), 9);
  });

  it('splits along the chord into two finishes that hold the whole wing between them', () => {
    const whole = volume(wing(stations));
    const front = volume(wing(stations, [0, 0.22]));
    const back = volume(wing(stations, [0.22, 1]));
    expect(front).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(0);
    // Within the little the extra section line at the split adds
    expect((front + back) / whole).toBeCloseTo(1, 2);
  });
});

describe('readShip', () => {
  it('keeps a saved ship', () => {
    for (const ship of SHIPS) expect(readShip(ship)).toBe(ship);
  });

  it('falls back to the default for nothing saved, or anything that is not a ship', () => {
    expect(DEFAULT_SHIP).toBe('interceptor');
    for (const saved of [null, '', 'Rocket', 'x-wing', '{"ship":"dart"}']) expect(readShip(saved)).toBe(DEFAULT_SHIP);
  });
});

describe("the ships' powers", () => {
  const plain = { lock: 1, turn: 1, boost: 1, hover: false, tough: false };
  const changed = (ship: (typeof SHIPS)[number]) =>
    (Object.keys(plain) as (keyof typeof plain)[]).filter((key) => POWERS[ship][key] !== plain[key]);

  it('give each ship one thing the others lack', () => {
    expect(SHIPS.map(changed)).toEqual([['lock'], ['turn'], ['boost'], ['hover'], ['tough']]);
    expect(new Set(SHIPS.map((ship) => POWERS[ship].name)).size).toBe(SHIPS.length);
  });

  it('say in a sentence what the numbers do', () => {
    expect(POWERS.interceptor).toMatchObject({ lock: 1.5, blurb: 'Locks on to a badge from half as far again.' });
    expect(POWERS.dart).toMatchObject({ turn: 1.3, blurb: 'Turns and climbs 30% faster.' });
    expect(POWERS.rocket).toMatchObject({ boost: 1.3, blurb: 'Boosts 30% faster.' });
    for (const ship of SHIPS) expect(POWERS[ship].blurb, ship).toMatch(/^[A-Z].*\.$/);
  });

  it('let the Interceptor lock on from further away, and hold that lock as far again as the others hold theirs', () => {
    const origin = new Vector3();
    const ahead = new Vector3(0, 0, -1);
    const far = new Vector3(0, 0, -(LOCK_RANGE + 30));
    expect(lockOn(origin, ahead, [far])).toBe(-1);
    expect(lockOn(origin, ahead, [far], POWERS.dart.lock)).toBe(-1);
    expect(lockOn(origin, ahead, [far], POWERS.interceptor.lock)).toBe(0);
    const further = new Vector3(0, 0, -LOCK_RANGE * 1.9);
    expect(holdsLock(origin, ahead, further)).toBe(false);
    expect(holdsLock(origin, ahead, further, POWERS.interceptor.lock)).toBe(true);
  });

  it('cost the Brick nothing for clipping a tower and less than the others for running into one', () => {
    expect(speedKept(POWERS.brick, false)).toBe(1);
    expect(speedKept(POWERS.brick, true)).toBeGreaterThan(speedKept(POWERS.dart, true));
    expect(speedKept(POWERS.dart, false)).toBe(0.8);
    expect(speedKept(POWERS.dart, true)).toBe(0.45);
  });
});

describe('the cockpits', () => {
  const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

  const designs = DESIGNS;

  it("are a different one for each ship, the year's own included", () => {
    expect(new Set(designs.map(cockpitMarkup)).size).toBe(designs.length);
    // The glass itself differs, and not only the instruments
    const frames = designs.map((ship) => /class="frame"[^>]* d="([^"]+)"/.exec(cockpitMarkup(ship))?.[1]);
    expect(new Set(frames).size).toBe(designs.length);
  });

  it.each(designs)(
    '%s has a frame with glass cut out of it, one speed needle and a lamp each for lock and boost',
    (ship) => {
      const markup = cockpitMarkup(ship);
      expect(markup).toMatch(/^<path class="frame" fill-rule="evenodd" d="M0 0H1600V900H0Z[Mm]/);
      expect(count(markup, /data-live="speed"/g)).toBe(1);
      expect(count(markup, /data-live="lock"/g)).toBe(1);
      expect(count(markup, /data-live="boost"/g)).toBe(1);
      // Nothing the page's content security policy would refuse
      expect(markup).not.toMatch(/style=|<style|<script|on[a-z]+=/);
    },
  );
});
