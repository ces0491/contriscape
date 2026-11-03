import * as THREE from 'three';
import type { Rgb } from './colours';
import { FIREWORK_FRAGMENT, FIREWORK_VERTEX } from './shaders';

export const SHELLS = 9;
const SPARKS = 120;
export const BETWEEN_SHELLS = 0.45;
const SPARK_SECONDS = 2.2;
const NEAREST = 60;
const FURTHEST = 90;
const LOWEST = 14;
const GOLD: Rgb = [1, 0.72, 0.28];
const WHITE: Rgb = [1, 0.95, 0.88];

/** First shell to last spark. */
export const FINALE_SECONDS = BETWEEN_SHELLS * (SHELLS - 1) + SPARK_SECONDS;

/** The show for clearing a city: shells bursting one after another across the view. */
export class Fireworks {
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly age = { value: FINALE_SECONDS };
  private readonly burst = new Float32Array(SHELLS * SPARKS * 3);
  private readonly flung = new Float32Array(SHELLS * SPARKS * 3);
  private readonly colours = new Float32Array(SHELLS * SPARKS * 3);
  private readonly delays = new Float32Array(SHELLS * SPARKS);
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    uPx: { value: number },
    private readonly random: () => number,
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.burst, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(this.flung, 3));
    geometry.setAttribute('aColour', new THREE.BufferAttribute(this.colours, 3));
    geometry.setAttribute('aDelay', new THREE.BufferAttribute(this.delays, 1));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        // A show hidden behind a tower would be no celebration at all
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPx, uAge: this.age, uLife: { value: SPARK_SECONDS } },
        vertexShader: FIREWORK_VERTEX,
        fragmentShader: FIREWORK_FRAGMENT,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
    scene.add(this.points);
  }

  get active(): boolean {
    return this.age.value < FINALE_SECONDS;
  }

  /** Spreads the shells across what the camera sees, in gold, white and the city's own colour. */
  start(camera: THREE.PerspectiveCamera, accent: Rgb): void {
    const { random } = this;
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(this.right, this.up, this.back);
    const reach = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const palette = [GOLD, accent, WHITE];

    for (let shell = 0; shell < SHELLS; shell++) {
      const distance = NEAREST + random() * (FURTHEST - NEAREST);
      const tall = reach * distance;
      this.centre
        .copy(camera.position)
        .addScaledVector(this.back, -distance)
        .addScaledVector(this.right, (random() * 1.3 - 0.65) * tall * camera.aspect)
        .addScaledVector(this.up, (0.1 + random() * 0.55) * tall);
      this.centre.y = Math.max(this.centre.y, LOWEST);
      const colour = palette[shell % palette.length];

      for (let spark = 0; spark < SPARKS; spark++) {
        const i = shell * SPARKS + spark;
        const y = random() * 2 - 1;
        const round = Math.sqrt(1 - y * y);
        const heading = random() * Math.PI * 2;
        const speed = distance * (0.45 + random() * 0.2);
        this.centre.toArray(this.burst, i * 3);
        this.flung.set([Math.cos(heading) * round * speed, y * speed, Math.sin(heading) * round * speed], i * 3);
        this.colours.set(colour, i * 3);
        this.delays[i] = shell * BETWEEN_SHELLS;
      }
    }

    const { geometry } = this.points;
    for (const name of ['position', 'aVelocity', 'aColour', 'aDelay']) geometry.attributes[name].needsUpdate = true;
    this.age.value = 0;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age.value = Math.min(FINALE_SECONDS, this.age.value + dt);
    if (!this.active) this.points.visible = false;
  }
}
