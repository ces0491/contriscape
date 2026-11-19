import { AdditiveBlending, NormalBlending, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import * as glsl from '../src/shaders';
import { DEFAULT_SKIN, definesFor, dress, LOOKS, pixelSize, readSkin, SKINS, type Look } from '../src/skins';

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
/** Everything a look can define, each of which some shader has to answer to. */
const NAMES = ['BLOCKS', 'POSTER', 'VECTOR', 'DAY', 'PIXELS', 'TONES', 'DEPTH', 'SCANLINES'];

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
      scene: 'night',
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
    expect(bright).toEqual(['blocks', 'poster', 'handheld']);
    for (const skin of bright) {
      expect(LOOKS[skin].bloom.threshold, skin).toBeGreaterThanOrEqual(1);
      for (const channel of LOOKS[skin].fog) expect(channel, skin).toBeLessThan(1);
    }
  });

  it('throw shadows where there is a sun, and nowhere else', () => {
    for (const skin of SKINS) expect(LOOKS[skin].shade > 0, skin).toBe(!LOOKS[skin].dark);
  });

  it('name each one for its button', () => {
    expect(SKINS.map((skin) => LOOKS[skin].label)).toEqual([
      'Night',
      'Blocks',
      'Poster',
      'Vector',
      'Handheld',
      'Arcade',
    ]);
  });

  it('draw the handheld from the day city and the arcade from the night one, and differ only in the screen', () => {
    const scene = (look: Look) => {
      const rest: Partial<Look> = { ...look };
      delete rest.label;
      delete rest.screen;
      return rest;
    };
    expect(scene(LOOKS.handheld)).toEqual(scene(LOOKS.blocks));
    expect(LOOKS.handheld.screen).toEqual({ rows: 150, palette: 'tones', scanlines: false });
    expect(scene(LOOKS.arcade)).toEqual(scene(LOOKS.night));
    expect(LOOKS.arcade.screen).toEqual({ rows: 224, palette: 'depth', scanlines: true });
    expect(LOOKS.blocks.screen).toBeUndefined();
  });
});

describe('definesFor', () => {
  it('names the scene, whether the sky is bright, and the screen', () => {
    expect(definesFor('blocks')).toEqual({ BLOCKS: 1, DAY: 1 });
    expect(definesFor('poster')).toEqual({ POSTER: 1, DAY: 1 });
    expect(definesFor('vector')).toEqual({ VECTOR: 1 });
    expect(definesFor('handheld')).toEqual({ BLOCKS: 1, DAY: 1, PIXELS: 1, TONES: 1 });
    expect(definesFor('arcade')).toEqual({ PIXELS: 1, DEPTH: 1, SCANLINES: 1 });
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
    expect(pixelSize('handheld', 720)).toBe(5);
    expect(pixelSize('arcade', 720)).toBe(3);
    expect(pixelSize('arcade', 1080)).toBe(5);
    expect(pixelSize('arcade', 300)).toBe(2);
    expect(pixelSize('handheld', 1)).toBe(2);
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
      for (const scene of ['BLOCKS', 'POSTER', 'VECTOR']) expect(glsl[name], `${name} ${scene}`).toContain(scene);
    }
  });

  it('are the only ones that ask about it', () => {
    const asking = sources.filter(([, source]) => NAMES.some((name) => source.includes(name))).map(([name]) => name);
    expect(asking.sort()).toEqual([...SCENE_SHADERS, ...DAY_SHADERS, 'FINISH_FRAGMENT'].sort());
  });
});
