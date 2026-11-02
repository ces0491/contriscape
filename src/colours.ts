export type Rgb = [number, number, number];

export interface Colours {
  towers: string;
  hull: string;
  trim: string;
}

export interface TowerPalette {
  /** Four stops, from a quiet day to the busiest. */
  ramp: [Rgb, Rgb, Rgb, Rgb];
  /** The lit windows. */
  window: Rgb;
}

export interface ColourRow {
  key: keyof Colours;
  label: string;
  swatches: { name: string; hex: string }[];
}

export const DEFAULT_COLOURS: Colours = { towers: '#39d353', hull: '#9aa5b2', trim: '#ffb454' };

export const COLOUR_ROWS: ColourRow[] = [
  {
    key: 'towers',
    label: 'Buildings',
    swatches: [
      { name: 'Green', hex: DEFAULT_COLOURS.towers },
      { name: 'Blue', hex: '#58a6ff' },
      { name: 'Violet', hex: '#b083f0' },
      { name: 'Pink', hex: '#f778ba' },
      { name: 'Orange', hex: '#f0883e' },
      { name: 'Grey', hex: '#9aa5b2' },
    ],
  },
  {
    key: 'hull',
    label: 'Ship',
    swatches: [
      { name: 'Steel', hex: DEFAULT_COLOURS.hull },
      { name: 'White', hex: '#eef2f6' },
      { name: 'Graphite', hex: '#47505b' },
      { name: 'Red', hex: '#c8463c' },
      { name: 'Blue', hex: '#3d7fc9' },
      { name: 'Gold', hex: '#c9a227' },
    ],
  },
  {
    key: 'trim',
    label: 'Ship trim',
    swatches: [
      { name: 'Amber', hex: DEFAULT_COLOURS.trim },
      { name: 'Red', hex: '#ff5a4f' },
      { name: 'Cyan', hex: '#4fd8ff' },
      { name: 'Green', hex: '#39d353' },
      { name: 'Violet', hex: '#b083f0' },
      { name: 'White', hex: '#f5f7fa' },
    ],
  },
];

const HEX = /^#[0-9a-f]{6}$/;
const KEYS = Object.keys(DEFAULT_COLOURS) as (keyof Colours)[];

/** Tuned by eye and by measuring glare, so the default stays exactly as it was. */
const DEFAULT_PALETTE: TowerPalette = {
  ramp: [
    [0.055, 0.267, 0.161],
    [0, 0.427, 0.196],
    [0.149, 0.651, 0.255],
    [0.224, 0.827, 0.325],
  ],
  window: [0.82, 1, 0.86],
};
const WINDOW_WHITE = 0.75;

const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;

/** The weights the bloom pass reads brightness with, so a match here holds there. */
export const luma = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The nearest colour at this brightness: a darker shade, or a tint towards white. */
function atBrightness(colour: Rgb, target: number): Rgb {
  const now = luma(colour);
  if (now >= target) return colour.map((v) => (v * target) / now) as Rgb;
  const towardsWhite = (target - now) / (1 - now);
  return colour.map((v) => v + (1 - v) * towardsWhite) as Rgb;
}

/** A building ramp from one colour. Each stop keeps the default's brightness, which holds glare close to the default's. */
export function towerPalette(hex: string): TowerPalette {
  if (hex === DEFAULT_COLOURS.towers) return DEFAULT_PALETTE;
  const colour = hexToRgb(hex);
  const ramp = DEFAULT_PALETTE.ramp.map((stop) => atBrightness(colour, luma(stop))) as TowerPalette['ramp'];
  const glass = ramp[3].map((v) => v + (1 - v) * WINDOW_WHITE);
  const brightest = Math.max(...glass);
  return { ramp, window: glass.map((v) => v / brightest) as Rgb };
}

/** Saved choices, keeping what's valid and using the default for anything else. */
export function readColours(saved: string | null): Colours {
  let parsed: unknown;
  try {
    parsed = JSON.parse(saved ?? 'null');
  } catch {
    parsed = null;
  }
  const given = (parsed ?? {}) as Partial<Record<keyof Colours, unknown>>;
  const colours = { ...DEFAULT_COLOURS };
  KEYS.forEach((key) => {
    const value = given[key];
    if (typeof value === 'string' && HEX.test(value)) colours[key] = value;
  });
  return colours;
}
