import { AdditiveBlending, NormalBlending, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import * as glsl from '../src/shaders';
import { DEFAULT_SKIN, definesFor, dress, LOOKS, readSkin, screenGrid, SKINS } from '../src/skins';

/** The shaders that draw the scene, which branch on which scene it is. */
const SCENE_SHADERS = ['TOWER_FRAGMENT', 'SOLID_FRAGMENT', 'GROUND_FRAGMENT', 'SKY_FRAGMENT'] as const;
/** The small lights, the shadows and what the ship reflects, which mostly ask whether the sky is bright. */
const DAY_SHADERS = [
  'ENV_FRAGMENT',
  'SHADOW_FRAGMENT',
  'BEACON_VERTEX',
  'BEACON_FRAGMENT',
  'TRAFFIC_VERTEX',
  'TRAFFIC_FRAGMENT',
  'DUST_FRAGMENT',
  'WARP_FRAGMENT',
  'FIREWORK_VERTEX',
  'FIREWORK_FRAGMENT',
] as const;
/** The looks other than the night, which is what a shader draws when none of them is named. */
const SCENES = SKINS.filter((skin) => skin !== DEFAULT_SKIN).map((skin) => skin.toUpperCase());
/** Everything a look can define, each of which some shader has to answer to. */
const NAMES = [...SCENES, 'DAY', 'PIXELS', 'LEVELS'];

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;
const sources = Object.entries(glsl).filter((entry): entry is [string, string] => typeof entry[1] === 'string');

describe('readSkin', () => {
  it('keeps a saved look', () => {
    for (const skin of SKINS) expect(readSkin(skin)).toBe(skin);
  });

  it('falls back to the default for nothing saved, or anything that is not a look', () => {
    expect(DEFAULT_SKIN).toBe('night');
    for (const saved of [null, '', 'Blocks', 'day', '{"skin":"blocks"}']) expect(readSkin(saved)).toBe(DEFAULT_SKIN);
  });
});

describe('the looks', () => {
  it('have the night as it was before there was a choice, with nothing defined for its shaders', () => {
    expect(LOOKS.night).toMatchObject({
      dark: true,
      fog: [0.05, 0.115, 0.165],
      fogDensity: 0.0021,
      bloom: { strength: 0.38, radius: 0.6, threshold: 0.74 },
      shade: 0,
    });
    expect(definesFor('night')).toEqual({});
  });

  it('under a bright sky let only what is brighter than white glow, so the sky and the ground do not', () => {
    const bright = SKINS.filter((skin) => !LOOKS[skin].dark);
    expect(bright).toEqual(['blocks', 'poster', 'console']);
    for (const skin of bright) {
      // A look with no glow at all passes too
      expect(LOOKS[skin].bloom?.threshold ?? 1, skin).toBeGreaterThanOrEqual(1);
      for (const channel of LOOKS[skin].fog) expect(channel, skin).toBeLessThan(1);
    }
  });

  it('throw shadows where there is a sun, and nowhere else', () => {
    for (const skin of SKINS) expect(LOOKS[skin].shade > 0, skin).toBe(!LOOKS[skin].dark);
  });

  it('name each one for its button', () => {
    expect(SKINS.map((skin) => LOOKS[skin].label)).toEqual(['Night', 'Blocks', 'Poster', 'Vector', '16-bit', 'VGA']);
  });

  it('give the two old screens their own scenes, in the colours those machines had, with nothing dithered', () => {
    expect(LOOKS.console).toMatchObject({ dark: false, screen: { rows: 320, levels: 31 } });
    expect(LOOKS.shooter).toMatchObject({ dark: true, screen: { rows: 320, levels: 63 } });
    for (const skin of ['night', 'blocks', 'poster', 'vector'] as const) expect(LOOKS[skin].screen).toBeUndefined();
    // Dithering a small palette turned a dense city into noise, which is why the two looks before these went
    expect(glsl.FINISH_FRAGMENT).not.toMatch(/bayer|dither/i);
  });

  it('give an old screen no glow, which spread over big pixels is a blur, and every other look one', () => {
    for (const skin of SKINS) expect(LOOKS[skin].bloom === null, skin).toBe(LOOKS[skin].screen !== undefined);
  });

  it("scale an old screen's frame up with one reading to a pixel, so a big pixel is one flat colour", () => {
    const [, screen, rest] = glsl.FINISH_FRAGMENT.split(/#ifdef PIXELS|#else/);
    expect(count(screen, /texture2D\(/g)).toBe(1);
    // The streak and its red and blue fringes belong to the other looks
    expect(screen).not.toContain('uSpeed');
    expect(rest).toContain('uSpeed');
  });

  it('keep the stars off a sky that has hills painted on it', () => {
    expect(SKINS.filter((skin) => LOOKS[skin].backdrop)).toEqual(['console', 'shooter']);
  });
});

describe('definesFor', () => {
  it('names the scene, whether the sky is bright, and the screen', () => {
    expect(definesFor('blocks')).toEqual({ BLOCKS: 1, DAY: 1 });
    expect(definesFor('poster')).toEqual({ POSTER: 1, DAY: 1 });
    expect(definesFor('vector')).toEqual({ VECTOR: 1 });
    expect(definesFor('console')).toEqual({ CONSOLE: 1, DAY: 1, PIXELS: 1, LEVELS: 31 });
    expect(definesFor('shooter')).toEqual({ SHOOTER: 1, PIXELS: 1, LEVELS: 63 });
  });

  it('only ever defines a name some shader answers to', () => {
    const all = sources.map(([, source]) => source).join('\n');
    for (const skin of SKINS) {
      for (const name of Object.keys(definesFor(skin))) {
        expect(NAMES, name).toContain(name);
        expect(all, name).toMatch(new RegExp(`(#ifn?def |defined\\()${name}\\b`));
      }
    }
  });
});

describe('screenGrid', () => {
  /** Views in the display's own pixels: this laptop's, a desktop's, a phone's both ways up, and some awkward ones. */
  const VIEWS = [
    [1920, 1037],
    [1920, 950],
    [2880, 1600],
    [780, 1688],
    [1688, 780],
    [1603, 876],
    [1501, 919],
    [641, 401],
    [3, 2],
  ] as const;

  it('is nothing for a look without a screen', () => {
    for (const skin of ['night', 'blocks', 'poster', 'vector'] as const)
      expect(screenGrid(skin, 1920, 1080)).toBeNull();
  });

  it("makes a big pixel a whole number of the display's, and never a single one", () => {
    expect(screenGrid('console', 1920, 1037)?.side).toBe(3);
    expect(screenGrid('shooter', 1920, 1037)?.side).toBe(3);
    expect(screenGrid('console', 2880, 1600)?.side).toBe(5);
    expect(screenGrid('console', 640, 400)?.side).toBe(2);
    for (const [width, height] of VIEWS) {
      const side = screenGrid('console', width, height)?.side ?? 0;
      expect(Number.isInteger(side), `${width}x${height}`).toBe(true);
      expect(side, `${width}x${height}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('goes by the shorter side, so a phone held upright has as many big pixels across as one on its side has down', () => {
    expect(screenGrid('console', 780, 1688)).toMatchObject({ side: 2, cols: 390, rows: 844 });
    expect(screenGrid('console', 1688, 780)).toMatchObject({ side: 2, cols: 844, rows: 390 });
  });

  it('covers the view, overhanging it by less than one big pixel each way', () => {
    for (const [width, height] of VIEWS) {
      const { side, cols, rows } = screenGrid('shooter', width, height) ?? { side: 0, cols: 0, rows: 0 };
      expect(cols * side - width, `${width}x${height}`).toBeGreaterThanOrEqual(0);
      expect(cols * side - width, `${width}x${height}`).toBeLessThan(side);
      expect(rows * side - height, `${width}x${height}`).toBeGreaterThanOrEqual(0);
      expect(rows * side - height, `${width}x${height}`).toBeLessThan(side);
    }
  });

  it('starts a whole number of pixels outside the view, so no pixel sits on the line between two big ones', () => {
    expect(screenGrid('console', 1920, 1037)).toMatchObject({ cols: 640, rows: 346, left: 0, top: 0 });
    expect(screenGrid('console', 1501, 919)).toMatchObject({ cols: 501, rows: 307, left: 1, top: 1 });
    for (const [width, height] of VIEWS) {
      const { side, cols, rows, left, top } = screenGrid('console', width, height) ?? {
        side: 0,
        cols: 0,
        rows: 0,
        left: 0.5,
        top: 0.5,
      };
      for (const [start, over] of [
        [left, cols * side - width],
        [top, rows * side - height],
      ]) {
        expect(Number.isInteger(start), `${width}x${height}`).toBe(true);
        expect(start, `${width}x${height}`).toBeGreaterThanOrEqual(0);
        expect(start, `${width}x${height}`).toBeLessThanOrEqual(over);
      }
    }
  });
});

describe('dress', () => {
  it('compiles a shader for the look it is given', () => {
    const material = new ShaderMaterial();
    const before = material.version;
    dress(material, 'blocks');
    expect(material.defines).toEqual({ BLOCKS: 1, DAY: 1 });
    expect(material.version).toBeGreaterThan(before);
    dress(material, 'night');
    expect(material.defines).toEqual({});
  });

  it('lays a light over a bright sky and adds it to a dark one, and leaves other shaders alone', () => {
    const light = new ShaderMaterial({ blending: AdditiveBlending });
    dress(light, 'poster', true);
    expect(light.blending).toBe(NormalBlending);
    dress(light, 'vector', true);
    expect(light.blending).toBe(AdditiveBlending);

    const wall = new ShaderMaterial();
    dress(wall, 'blocks');
    expect(wall.blending).toBe(NormalBlending);
    const glow = new ShaderMaterial({ blending: AdditiveBlending });
    dress(glow, 'blocks');
    expect(glow.blending).toBe(AdditiveBlending);
  });
});

describe('the shaders that change with the look', () => {
  it('each close every block they open', () => {
    for (const [name, source] of sources) {
      expect(count(source, /#endif/g), name).toBe(count(source, /#if/g));
    }
  });

  it('draw every scene where the scene is drawn', () => {
    for (const name of SCENE_SHADERS) {
      for (const scene of SCENES) expect(glsl[name], `${name} ${scene}`).toContain(scene);
    }
  });

  it('are the only ones that ask about it', () => {
    const asking = sources.filter(([, source]) => NAMES.some((name) => source.includes(name))).map(([name]) => name);
    expect(asking.sort()).toEqual([...SCENE_SHADERS, ...DAY_SHADERS, 'FINISH_FRAGMENT'].sort());
  });
});
