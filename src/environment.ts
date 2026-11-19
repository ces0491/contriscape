import * as THREE from 'three';
import type { TowerPalette } from './colours';
import { ENV_FRAGMENT, ENV_VERTEX } from './shaders';
import { dress, type Skin } from './skins';

/** A colour picker fires on every move, and each repaint renders a cube map, so repaints wait this long between them. */
const REPAINT_SECONDS = 0.25;

/**
 * What the ship's metal and glass reflect, rendered once into a prefiltered cube map: the night sky, the lit city around
 * the horizon in the buildings' colour, and the street. It's redrawn when the buildings change colour, and when the
 * look changes, since by day the ship reflects a day.
 */
export class Environment {
  private readonly generator: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly glow = new THREE.Color();
  private readonly window = new THREE.Color();
  private readonly material: THREE.ShaderMaterial;
  private target: THREE.WebGLRenderTarget | null = null;
  private pending: TowerPalette | null = null;
  private painted: TowerPalette | null = null;
  private paintedAt = -Infinity;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly onChange: (map: THREE.Texture) => void,
  ) {
    this.generator = new THREE.PMREMGenerator(renderer);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: ENV_VERTEX,
      fragmentShader: ENV_FRAGMENT,
      uniforms: { uGlow: { value: this.glow }, uWindow: { value: this.window } },
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.material));
  }

  /** Switches what there is to reflect, and repaints at once if anything has been painted. */
  setSkin(skin: Skin, now: number): void {
    dress(this.material, skin);
    if (!this.painted) return;
    this.pending ??= this.painted;
    this.paintedAt = -Infinity;
    this.flush(now);
  }

  /** Asks for a repaint in this palette. The first one happens straight away, so the ship never shows unlit. */
  paint(palette: TowerPalette, now: number): void {
    this.pending = palette;
    if (!this.target) this.flush(now);
  }

  /** Repaints if one is waiting and the last was long enough ago. Called each frame. */
  flush(now: number): void {
    if (!this.pending || now - this.paintedAt < REPAINT_SECONDS) return;
    const { ramp, window } = this.pending;
    this.painted = this.pending;
    this.pending = null;
    this.paintedAt = now;
    this.glow.fromArray(ramp[2]);
    this.window.fromArray(window);
    const previous = this.target;
    this.target = this.generator.fromScene(this.scene, 0, 0.1, 100, { size: 256 });
    this.onChange(this.target.texture);
    previous?.dispose();
  }
}
