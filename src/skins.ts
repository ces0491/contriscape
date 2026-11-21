import { AdditiveBlending, NormalBlending, type ShaderMaterial } from 'three';
import type { Rgb } from './colours';

/**
 * The looks a city can be drawn in, in the order Settings lists them. The first is the default, and it is what a shader
 * draws with nothing defined. Each of the others has a branch of its own, under its name in capitals, in the shaders
 * that draw the city.
 */
export const SKINS = ['night', 'blocks', 'poster', 'vector', 'console', 'shooter'] as const;
export type Skin = (typeof SKINS)[number];
export const DEFAULT_SKIN: Skin = SKINS[0];

/**
 * What an old screen does to a frame: big square pixels with hard edges, and only so many levels each of red, green
 * and blue. Nothing is dithered. Two looks that dithered a small palette turned a city of thousands of towers into
 * noise.
 */
export interface Screen {
  /**
   * Rows of big pixels down a wide view, or across a tall one, near enough. It is more than those machines had. At
   * their 200 or so, a tower in a city of thousands is narrower than a big pixel from Orbit, and the city is specks.
   */
  rows: number;
  /** Steps each of red, green and blue above black: 31 for the 32 levels a 16-bit console had, 63 for VGA's 64. */
  levels: number;
}

export interface Look {
  /** The name on its button in Settings. */
  label: string;
  /**
   * Whether the scene is dark and lit by its own lights. Lights are drawn by adding to what is behind them, which shows
   * against the dark and vanishes into a bright sky, so by day the small ones are drawn as solid shapes.
   */
  dark: boolean;
  /** The haze that distance fades into, and how quickly it does. */
  fog: Rgb;
  fogDensity: number;
  /**
   * The glow around bright things: its strength, its spread, and the brightness it starts at. An old screen has none,
   * because a glow spread over big pixels is a blur.
   */
  bloom: { strength: number; radius: number; threshold: number } | null;
  /** Paint for the lettering on the ground: the months, each year and its total, and the name with the span under it. */
  ink: { months: string; year: string; total: string; name: string; span: string };
  /** How dark the towers' shadows lie on the ground, from 0 for none. Only a scene with a sun throws any. */
  shade: number;
  /** Lettering written the way a path is, `2026/` and `jan/`, where the others write `2026` and `JAN`. */
  paths?: boolean;
  /** The sky is a painted backdrop with hills of its own, so the stars aren't drawn over it. */
  backdrop?: boolean;
  screen?: Screen;
}

type Base = Omit<Look, 'label'>;

const NIGHT: Base = {
  dark: true,
  fog: [0.05, 0.115, 0.165],
  fogDensity: 0.0021,
  bloom: { strength: 0.38, radius: 0.6, threshold: 0.74 },
  shade: 0,
  ink: {
    months: 'rgba(150,205,175,.52)',
    year: 'rgba(205,235,218,.5)',
    total: 'rgba(150,205,175,.48)',
    name: 'rgba(225,242,232,.55)',
    span: 'rgba(150,205,175,.7)',
  },
};

// A daytime city of stacked blocks under a square sun. By day only what is brighter than white glows, which leaves
// the sky and the ground alone and keeps the glow for the sun, the lasers and anything exploding.
const BLOCKS: Base = {
  dark: false,
  fog: [0.8, 0.9, 0.98],
  fogDensity: 0.0017,
  bloom: { strength: 0.3, radius: 0.5, threshold: 1 },
  shade: 0.3,
  ink: {
    months: 'rgba(34,60,44,.7)',
    year: 'rgba(28,52,38,.55)',
    total: 'rgba(34,60,44,.6)',
    name: 'rgba(28,52,38,.6)',
    span: 'rgba(34,60,44,.75)',
  },
};

export const LOOKS: Record<Skin, Look> = {
  night: { ...NIGHT, label: 'Night' },
  blocks: { ...BLOCKS, label: 'Blocks' },
  // Flat colour on pale paper with heavy black lettering, after the site for GitHub Universe '26: seven colours, one to
  // a tower, and hairlines for a grid. The haze is the paper itself, so the far city fades into the page.
  poster: {
    label: 'Poster',
    dark: false,
    fog: [0.914, 0.929, 0.925],
    fogDensity: 0.0019,
    bloom: { strength: 0.25, radius: 0.4, threshold: 1 },
    shade: 0.16,
    ink: {
      months: 'rgba(0,0,0,.78)',
      year: 'rgba(0,0,0,.86)',
      total: 'rgba(88,99,91,.9)',
      name: 'rgba(0,0,0,.86)',
      span: 'rgba(88,99,91,.95)',
    },
    paths: true,
  },
  // The city as an old vector display drew things: glowing outlines on black, with the hidden lines taken out. The
  // glow is the look, so it starts low and spreads wide. The haze is thick, because far towers are all outline, and
  // without it the end of every street glows white.
  vector: {
    label: 'Vector',
    dark: true,
    fog: [0.004, 0.01, 0.014],
    fogDensity: 0.008,
    bloom: { strength: 0.65, radius: 0.55, threshold: 0.6 },
    shade: 0,
    ink: NIGHT.ink,
  },
  // An afternoon as a 16-bit console drew one: flat bands of colour, hard edges and a sky in stripes, in the 32 levels
  // of each colour those machines had. It is a bright scene, so it follows the rules the other bright ones do.
  console: {
    label: '16-bit',
    dark: false,
    fog: [0.72, 0.9, 0.98],
    fogDensity: 0.0016,
    bloom: null,
    shade: 0.26,
    ink: {
      months: 'rgba(92,48,22,.85)',
      year: 'rgba(92,48,22,.8)',
      total: 'rgba(150,64,30,.9)',
      name: 'rgba(92,48,22,.85)',
      span: 'rgba(150,64,30,.95)',
    },
    backdrop: true,
    screen: { rows: 320, levels: 31 },
  },
  // The city as a shooter of the early 1990s drew a level: bolted metal walls, light that dims with distance in
  // steps, and a painted dusk behind it, in VGA's 64 levels of each colour. It is dark, so its lights are added as
  // the night's are.
  shooter: {
    label: 'VGA',
    dark: true,
    fog: [0.06, 0.04, 0.055],
    fogDensity: 0.0016,
    bloom: null,
    shade: 0,
    ink: {
      months: 'rgba(236,224,196,.6)',
      year: 'rgba(236,224,196,.55)',
      total: 'rgba(214,170,60,.7)',
      name: 'rgba(236,224,196,.62)',
      span: 'rgba(214,170,60,.8)',
    },
    backdrop: true,
    screen: { rows: 320, levels: 63 },
  },
};

/**
 * What a shader is compiled with for a look. A scene shader branches on the scene's name, the small lights on `DAY`,
 * and the pass over the finished frame on the screen it imitates. Each look is then its own program, and the night's
 * shaders run as they did before there was a choice.
 */
export function definesFor(skin: Skin): Record<string, number> {
  const { dark, screen } = LOOKS[skin];
  const defines: Record<string, number> = {};
  if (skin !== DEFAULT_SKIN) defines[skin.toUpperCase()] = 1;
  if (!dark) defines.DAY = 1;
  if (screen) {
    defines.PIXELS = 1;
    defines.LEVELS = screen.levels;
  }
  return defines;
}

/** Compiles a shader for a look. `light` is for the small lights, which also change how they are laid over the view. */
export function dress(material: ShaderMaterial, skin: Skin, light = false): void {
  material.defines = definesFor(skin);
  if (light) material.blending = LOOKS[skin].dark ? AdditiveBlending : NormalBlending;
  material.needsUpdate = true;
}

/** How an old screen is laid over a view. */
export interface Grid {
  /** The side of one big pixel, as a whole number of the display's own. */
  side: number;
  /** Big pixels across and down. They cover the view, and overhang it where it isn't a whole number of them. */
  cols: number;
  rows: number;
  /**
   * How far the first big pixel starts before the view's left edge, and above its top, in the display's pixels: half
   * the overhang, as a whole number. Half a pixel would put the middle of the display's pixels on the lines between
   * big ones, where rounding gives a pixel to either side.
   */
  left: number;
  top: number;
}

/**
 * The big pixels of a look's screen over a view of this many of the display's pixels, or null for a look without one.
 * A big pixel is a whole number of the display's, because a part of one makes some rows and columns fatter than others.
 */
export function screenGrid(skin: Skin, width: number, height: number): Grid | null {
  const { screen } = LOOKS[skin];
  if (!screen) return null;
  const side = Math.max(2, Math.round(Math.min(width, height) / screen.rows));
  const cols = Math.ceil(width / side);
  const rows = Math.ceil(height / side);
  return { side, cols, rows, left: Math.floor((cols * side - width) / 2), top: Math.floor((rows * side - height) / 2) };
}

/** A saved choice, or the default for anything that isn't one. */
export function readSkin(saved: string | null): Skin {
  return SKINS.find((skin) => skin === saved) ?? DEFAULT_SKIN;
}
