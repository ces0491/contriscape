import { AdditiveBlending, NormalBlending, type ShaderMaterial } from 'three';
import type { Rgb } from './colours';

/** The looks a city can be drawn in, in the order Settings lists them. The first is the default. */
export const SKINS = ['night', 'blocks', 'poster', 'vector', 'handheld', 'arcade'] as const;
export type Skin = (typeof SKINS)[number];
export const DEFAULT_SKIN: Skin = SKINS[0];

/**
 * How the city itself is drawn. Each has its own branch in the shaders that draw it. A look is a scene plus what is
 * done to the finished frame, so two looks can share a scene.
 */
export type Scene = 'night' | 'blocks' | 'poster' | 'vector';

/** What an old screen does to a frame: big square pixels, a small palette, and the gaps between scan lines. */
export interface Screen {
  /** Rows of big pixels down the view. */
  rows: number;
  /** `tones` is four shades of one colour, as on a handheld's screen. `depth` is a few levels each of red, green and blue. */
  palette: 'tones' | 'depth';
  scanlines: boolean;
}

export interface Look {
  /** The name on its button in Settings. */
  label: string;
  scene: Scene;
  /**
   * Whether the scene is dark and lit by its own lights. Lights are drawn by adding to what is behind them, which shows
   * against the dark and vanishes into a bright sky, so by day the small ones are drawn as solid shapes.
   */
  dark: boolean;
  /** The haze that distance fades into, and how quickly it does. */
  fog: Rgb;
  fogDensity: number;
  /** The glow around bright things: its strength, its spread, and the brightness it starts at. */
  bloom: { strength: number; radius: number; threshold: number };
  /** Paint for the lettering on the ground: the months, each year and its total, and the name with the span under it. */
  ink: { months: string; year: string; total: string; name: string; span: string };
  /** How dark the towers' shadows lie on the ground, from 0 for none. Only a scene with a sun throws any. */
  shade: number;
  /** Lettering written the way a path is, `2026/` and `jan/`, where the others write `2026` and `JAN`. */
  paths?: boolean;
  screen?: Screen;
}

type Base = Omit<Look, 'label'>;

const NIGHT: Base = {
  scene: 'night',
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
  scene: 'blocks',
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
    scene: 'poster',
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
    scene: 'vector',
    dark: true,
    fog: [0.004, 0.01, 0.014],
    fogDensity: 0.008,
    bloom: { strength: 0.65, radius: 0.55, threshold: 0.6 },
    shade: 0,
    ink: NIGHT.ink,
  },
  // The day city on a handheld's screen: big pixels in four shades of one olive green.
  handheld: { ...BLOCKS, label: 'Handheld', screen: { rows: 150, palette: 'tones', scanlines: false } },
  // The night city on an arcade cabinet's tube: big pixels, few colours, and dark gaps between the scan lines.
  arcade: { ...NIGHT, label: 'Arcade', screen: { rows: 224, palette: 'depth', scanlines: true } },
};

/**
 * What a shader is compiled with for a look. A scene shader branches on the scene's name, the small lights on `DAY`,
 * and the pass over the finished frame on the screen it imitates. Each look is then its own program, and the night's
 * shaders run as they did before there was a choice.
 */
export function definesFor(skin: Skin): Record<string, number> {
  const { scene, dark, screen } = LOOKS[skin];
  const defines: Record<string, number> = {};
  if (scene !== 'night') defines[scene.toUpperCase()] = 1;
  if (!dark) defines.DAY = 1;
  if (screen) {
    defines.PIXELS = 1;
    defines[screen.palette.toUpperCase()] = 1;
    if (screen.scanlines) defines.SCANLINES = 1;
  }
  return defines;
}

/** Compiles a shader for a look. `light` is for the small lights, which also change how they are laid over the view. */
export function dress(material: ShaderMaterial, skin: Skin, light = false): void {
  material.defines = definesFor(skin);
  if (light) material.blending = LOOKS[skin].dark ? AdditiveBlending : NormalBlending;
  material.needsUpdate = true;
}

/** The side of one big pixel in a view this many pixels tall, for a look with a screen, or 0 for one without. */
export function pixelSize(skin: Skin, viewHeight: number): number {
  const { screen } = LOOKS[skin];
  return screen ? Math.max(2, Math.round(viewHeight / screen.rows)) : 0;
}

/** A saved choice, or the default for anything that isn't one. */
export function readSkin(saved: string | null): Skin {
  return SKINS.find((skin) => skin === saved) ?? DEFAULT_SKIN;
}
