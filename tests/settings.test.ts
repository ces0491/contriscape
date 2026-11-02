import { describe, expect, it } from 'vitest';
import { COLOUR_ROWS, DEFAULT_COLOURS, luma, readColours, towerPalette, type Rgb } from '../src/colours';
import { COCKPIT_BELOW, nextZoom, ZOOM_MAX, ZOOM_MIN } from '../src/zoom';

const NOTCH = Math.exp(100 * 0.0016);

describe('nextZoom', () => {
  it('leaves the cockpit on one notch of a mouse wheel', () => {
    expect(nextZoom(ZOOM_MIN, NOTCH)).toBeGreaterThanOrEqual(COCKPIT_BELOW);
  });

  it('leaves the cockpit on the smallest trackpad or pinch movement', () => {
    expect(nextZoom(ZOOM_MIN, 1.001)).toBeGreaterThanOrEqual(COCKPIT_BELOW);
  });

  it('stays put when the movement has no size', () => {
    expect(nextZoom(ZOOM_MIN, 1)).toBe(ZOOM_MIN);
  });

  it('settles in the cockpit on the way in', () => {
    expect(nextZoom(COCKPIT_BELOW * 1.05, 1 / NOTCH)).toBe(ZOOM_MIN);
    expect(nextZoom(ZOOM_MIN, 1 / NOTCH)).toBe(ZOOM_MIN);
  });

  it('walks the whole range in both directions', () => {
    let zoom = 1;
    while (zoom > ZOOM_MIN) zoom = nextZoom(zoom, 1 / NOTCH);
    let notches = 0;
    while (zoom < ZOOM_MAX && notches < 100) {
      zoom = nextZoom(zoom, NOTCH);
      notches++;
    }
    expect(zoom).toBe(ZOOM_MAX);
  });
});

describe('towerPalette', () => {
  const asHex = (r: number, g: number, b: number) =>
    `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const levels = [0, 51, 102, 153, 204, 255];
  const everyColour = levels.flatMap((r) => levels.flatMap((g) => levels.map((b) => asHex(r, g, b))));
  const original = towerPalette(DEFAULT_COLOURS.towers);

  it('leaves the default exactly as tuned', () => {
    expect(original.ramp[3]).toEqual([0.224, 0.827, 0.325]);
    expect(original.window).toEqual([0.82, 1, 0.86]);
  });

  it('matches the default brightness at each stop, whatever is picked', () => {
    for (const hex of everyColour) {
      towerPalette(hex).ramp.forEach((stop, i) => {
        expect(luma(stop), `${hex} stop ${i}`).toBeCloseTo(luma(original.ramp[i]), 6);
      });
    }
  });

  it('keeps every channel displayable', () => {
    const inRange = (colour: Rgb) => colour.every((v) => v >= 0 && v <= 1);
    for (const hex of everyColour) {
      const { ramp, window } = towerPalette(hex);
      expect([...ramp, window].every(inRange), hex).toBe(true);
    }
  });

  it('keeps the hue the visitor picked', () => {
    const [r, g, b] = towerPalette('#ff0000').ramp[1];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeCloseTo(b, 6);
    const blue = towerPalette('#58a6ff').ramp[3];
    expect(blue[2]).toBeGreaterThan(blue[0]);
  });

  it('offers only swatches that differ from one another in each row', () => {
    for (const { swatches } of COLOUR_ROWS) {
      expect(new Set(swatches.map((s) => s.hex)).size).toBe(swatches.length);
    }
  });

  it('starts each row on its default', () => {
    for (const { key, swatches } of COLOUR_ROWS) expect(swatches[0].hex).toBe(DEFAULT_COLOURS[key]);
  });
});

describe('readColours', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(readColours(null)).toEqual(DEFAULT_COLOURS);
  });

  it('keeps a saved choice', () => {
    const saved = JSON.stringify({ towers: '#58a6ff', hull: '#c8463c', trim: '#4fd8ff' });
    expect(readColours(saved)).toEqual({ towers: '#58a6ff', hull: '#c8463c', trim: '#4fd8ff' });
  });

  it('falls back for each field on its own', () => {
    const saved = JSON.stringify({ towers: 'url(evil)', hull: '#c8463c', trim: 7 });
    expect(readColours(saved)).toEqual({ ...DEFAULT_COLOURS, hull: '#c8463c' });
  });

  it('survives damaged storage', () => {
    expect(readColours('{not json')).toEqual(DEFAULT_COLOURS);
    expect(readColours('null')).toEqual(DEFAULT_COLOURS);
    expect(readColours('[1,2]')).toEqual(DEFAULT_COLOURS);
    expect(readColours('"#123456"')).toEqual(DEFAULT_COLOURS);
  });
});
