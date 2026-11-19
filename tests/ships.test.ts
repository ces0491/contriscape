import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIP, halfSpan, readShip, SHIP_LABELS, SHIPS } from '../src/fighter';

/**
 * The widest a ship's model may reach to either side, in its own units. The flight paths are tested to clear every
 * tower by 0.42 once the model is scaled to 0.8, which is this.
 */
const WIDEST = 0.52;

describe('the ships', () => {
  it.each(SHIPS)('%s fits the width the flight paths leave it, lights and guns included', (ship) => {
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
