import { BufferAttribute, Camera, InstancedMesh, Matrix4, PerspectiveCamera, Points, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Blast } from '../src/blast';
import { COLOUR_ROWS, DEFAULT_COLOURS, luma, readColours, towerPalette, type Rgb } from '../src/colours';
import { FINALE_SECONDS, Fireworks } from '../src/fireworks';
import { averageFrame, SLOW_FRAME_MS } from '../src/quality';
import { keyTurn } from '../src/steering';
import { COCKPIT_BELOW, nextZoom, ZOOM_MAX, ZOOM_MIN } from '../src/zoom';

const NOTCH = Math.exp(100 * 0.0016);

describe('keyTurn', () => {
  const FRAME = 1 / 60;
  const held = (frames: number, goal = 1, from = 0) => {
    let turn = from;
    for (let n = 0; n < frames; n++) turn = keyTurn(turn, goal, FRAME);
    return turn;
  };

  it('keeps a tap to a small part of a full turn', () => {
    expect(held(4)).toBeLessThan(0.25);
  });

  it('builds to a full turn while held', () => {
    expect(held(120)).toBeGreaterThan(0.99);
  });

  it('stops dead when the key is let go', () => {
    expect(keyTurn(held(60), 0, FRAME)).toBe(0);
  });

  it('starts small again in the other direction', () => {
    expect(held(1, -1, 0.9)).toBeGreaterThan(-0.1);
  });
});

describe('averageFrame', () => {
  const after = (frames: number, ms: number, from = 16.7) => {
    let average = from;
    for (let n = 0; n < frames; n++) average = averageFrame(average, ms);
    return average;
  };

  it('takes one long gap, like a hidden tab coming back, as a hiccup', () => {
    expect(averageFrame(16.7, 600_000)).toBeLessThan(SLOW_FRAME_MS);
  });

  it('still takes that gap as a hiccup on a machine holding 30 frames a second', () => {
    expect(averageFrame(33, 600_000)).toBeLessThan(SLOW_FRAME_MS);
  });

  it('keeps a smooth machine under the limit', () => {
    expect(after(300, 16.7)).toBeLessThan(SLOW_FRAME_MS);
  });

  it('catches a GPU that really is slow, however slow', () => {
    expect(after(100, 60)).toBeGreaterThan(SLOW_FRAME_MS);
    expect(after(100, 1000)).toBeGreaterThan(SLOW_FRAME_MS);
  });
});

describe('Fireworks', () => {
  const start = () => {
    const scene = new Scene();
    const fireworks = new Fireworks(scene, { value: 1 }, () => 0.7);
    const points = scene.children[0] as Points;
    const camera = new PerspectiveCamera(58, 16 / 9, 0.1, 1000);
    camera.position.set(50, 6, 40);
    camera.lookAt(50, 6, 0);
    return { fireworks, points, camera };
  };
  const bursts = (points: Points) => {
    const { array, count } = points.geometry.attributes.position as BufferAttribute;
    return Array.from({ length: count }, (_, i) => new Vector3().fromArray(array, i * 3));
  };

  it('waits out of sight until a city is cleared', () => {
    const { fireworks, points } = start();
    expect(fireworks.active).toBe(false);
    expect(points.visible).toBe(false);
  });

  it('bursts ahead of the camera and inside its view', () => {
    const { fireworks, points, camera } = start();
    fireworks.start(camera, [0.2, 0.8, 0.3]);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    for (const burst of bursts(points)) {
      expect(burst.z).toBeLessThan(camera.position.z);
      const seen = burst.clone().project(camera);
      expect(Math.abs(seen.x)).toBeLessThan(1);
      expect(Math.abs(seen.y)).toBeLessThan(1);
    }
  });

  it('stays in the sky when the camera looks at the ground', () => {
    const { fireworks, points, camera } = start();
    camera.position.set(50, 2, 40);
    camera.lookAt(50, 0, 0);
    fireworks.start(camera, [0.2, 0.8, 0.3]);
    for (const burst of bursts(points)) expect(burst.y).toBeGreaterThan(10);
  });

  it('runs its course and then hides again', () => {
    const { fireworks, points, camera } = start();
    fireworks.start(camera, [0.2, 0.8, 0.3]);
    expect(fireworks.active).toBe(true);
    expect(points.visible).toBe(true);
    fireworks.update(FINALE_SECONDS - 0.01);
    expect(fireworks.active).toBe(true);
    fireworks.update(0.02);
    expect(fireworks.active).toBe(false);
    expect(points.visible).toBe(false);
  });

  it('can go off again once a city has been reset and cleared twice', () => {
    const { fireworks, camera } = start();
    fireworks.start(camera, [0.2, 0.8, 0.3]);
    fireworks.update(FINALE_SECONDS);
    fireworks.start(camera, [0.2, 0.8, 0.3]);
    expect(fireworks.active).toBe(true);
  });
});

describe('Blast', () => {
  const start = () => {
    const scene = new Scene();
    const blast = new Blast(scene, () => 0.7);
    return { blast, group: scene.children[0] };
  };
  const pieceAt = (group: Scene['children'][number], index: number) => {
    const pieces = group.children.find((child): child is InstancedMesh => child instanceof InstancedMesh);
    const matrix = new Matrix4();
    pieces?.getMatrixAt(index, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  };

  it('waits out of sight until a badge is shot', () => {
    const { blast, group } = start();
    expect(blast.active).toBe(false);
    expect(group.visible).toBe(false);
  });

  it('goes off where the badge was and throws its pieces outward', () => {
    const { blast, group } = start();
    const at = new Vector3(5, 12, -3);
    blast.start(at);
    expect(group.position).toEqual(at);
    blast.update(0.1, new Camera());
    const near = pieceAt(group, 0).length();
    blast.update(0.1, new Camera());
    expect(near).toBeGreaterThan(0);
    expect(pieceAt(group, 0).length()).toBeGreaterThan(near);
  });

  it('clears itself away', () => {
    const { blast, group } = start();
    blast.start(new Vector3());
    for (let n = 0; n < 100; n++) blast.update(0.05, new Camera());
    expect(blast.active).toBe(false);
    expect(group.visible).toBe(false);
  });
});

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
