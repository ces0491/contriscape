import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { holdsLock, LOCK_RANGE, lockOn } from '../src/aim';
import { cockpitMarkup } from '../src/cockpits';
import { DEFAULT_SHIP, EDITION_SHIP, halfSpan, readShip, SHIP_LABELS, SHIPS, type Design } from '../src/fighter';

/** The ships in Settings, and the year's own. */
const DESIGNS: Design[] = [...SHIPS, EDITION_SHIP];
import { POWERS, speedKept } from '../src/powers';

/**
 * The widest a ship's model may reach to either side, in its own units. The flight paths are tested to clear every
 * tower by 0.42 once the model is scaled to 0.8, which is this.
 */
const WIDEST = 0.52;

describe('the ships', () => {
  it.each(DESIGNS)('%s fits the width the flight paths leave it, lights and guns included', (ship) => {
    const reach = halfSpan(ship);
    expect(reach).toBeLessThanOrEqual(WIDEST);
    // Narrow enough to slip through anything would be a different game
    expect(reach).toBeGreaterThan(0.4);
  });

  it('each have a name for their button', () => {
    expect(SHIPS.map((ship) => SHIP_LABELS[ship])).toEqual(['Interceptor', 'Dart', 'Rocket', 'Saucer', 'Brick']);
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
