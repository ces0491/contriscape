import { AdditiveBlending, NormalBlending, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import * as glsl from '../src/shaders';
import { DEFAULT_SKIN, definesFor, dress, LOOKS, pixelSize, readSkin, SKINS } from '../src/skins';

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
      expect(LOOKS[skin].bloom.threshold, skin).toBeGreaterThanOrEqual(1);
      for (const channel of LOOKS[skin].fog) expect(channel, skin).toBeLessThan(1);
    }
  });

  it('throw shadows where there is a sun, and nowhere else', () => {
    for (const skin of SKINS) expect(LOOKS[skin].shade > 0, skin).toBe(!LOOKS[skin].dark);
  });

  it('name each one for its button', () => {
    expect(SKINS.map((skin) => LOOKS[skin].label)).toEqual(['Night', 'Blocks', 'Poster', 'Vector', '16-bit', 'VGA']);
  });

  it('give the two old screens their own scenes, in the rows those machines had, with nothing dithered', () => {
    expect(LOOKS.console).toMatchObject({ dark: false, screen: { rows: 224, levels: 31 } });
    expect(LOOKS.shooter).toMatchObject({ dark: true, screen: { rows: 200, levels: 63 } });
    for (const skin of ['night', 'blocks', 'poster', 'vector'] as const) expect(LOOKS[skin].screen).toBeUndefined();
    // Dithering a small palette turned a dense city into noise, which is why the two looks before these went
    expect(glsl.FINISH_FRAGMENT).not.toMatch(/bayer|dither/i);
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

describe('pixelSize', () => {
  it('is nothing for a look without a screen', () => {
    for (const skin of ['night', 'blocks', 'poster', 'vector'] as const) expect(pixelSize(skin, 720)).toBe(0);
  });

  it('cuts the view into about as many rows as the screen had, and never into single pixels', () => {
    expect(pixelSize('console', 720)).toBe(3);
    expect(pixelSize('console', 1080)).toBe(5);
    expect(pixelSize('shooter', 720)).toBe(4);
    expect(pixelSize('shooter', 300)).toBe(2);
    expect(pixelSize('console', 1)).toBe(2);
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
