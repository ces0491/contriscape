import * as THREE from 'three';
import type { TowerPalette } from './colours';
import { ENV_FRAGMENT, ENV_VERTEX } from './shaders';

/** A colour picker fires on every move, and each repaint renders a cube map, so repaints wait this long between them. */
const REPAINT_SECONDS = 0.25;

/**
 * What the ship's metal and glass reflect, rendered once into a prefiltered cube map: the night sky, the lit city around
 * the horizon in the buildings' colour, and the street. It's redrawn when the buildings change colour.
 */
export class Environment {
  private readonly generator: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly glow = new THREE.Color();
  private readonly window = new THREE.Color();
  private target: THREE.WebGLRenderTarget | null = null;
  private pending: TowerPalette | null = null;
  private paintedAt = -Infinity;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly onChange: (map: THREE.Texture) => void,
  ) {
    this.generator = new THREE.PMREMGenerator(renderer);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(10, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: ENV_VERTEX,
        fragmentShader: ENV_FRAGMENT,
        uniforms: { uGlow: { value: this.glow }, uWindow: { value: this.window } },
      }),
    );
    this.scene.add(sphere);
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
