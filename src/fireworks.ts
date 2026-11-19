import * as THREE from 'three';
import type { Rgb } from './colours';
import { FIREWORK_FRAGMENT, FIREWORK_VERTEX } from './shaders';

export const SHELLS = 9;
const SPARKS = 150;
/** Each spark draws a few fainter copies of itself a moment behind, which reads as a streak. */
const LAGS = [0, 0.04, 0.08, 0.12];
/** Points in a rocket's climbing trail, head first. */
const ROCKET_POINTS = 6;
export const BETWEEN_SHELLS = 0.45;
/** Seconds a rocket climbs before its shell bursts. */
export const CLIMB_SECONDS = 0.6;
const CLIMB = 26;
const SPARK_SECONDS = 2.2;
/** Willow shells hang in the air longer. */
const WILLOW_SECONDS = 3;
const NEAREST = 60;
const FURTHEST = 90;
const LOWEST = 14;
const GOLD: Rgb = [1, 0.72, 0.28];
const WHITE: Rgb = [1, 0.95, 0.88];
/** What a point is, in the shader's `aKind`. */
const SPARK = 0;
const ROCKET = 1;
const FLASH = 2;

/** First rocket to last spark. */
export const FINALE_SECONDS =
  BETWEEN_SHELLS * (SHELLS - 1) + CLIMB_SECONDS + WILLOW_SECONDS + LAGS[LAGS.length - 1] + 0.05;

/** One shell of the show, for the sound and the light it throws on the city. */
export interface Shell {
  /** Seconds after the start when it bursts. */
  at: number;
  centre: THREE.Vector3;
  colour: Rgb;
  /** Across the view, from -1 at the left edge to 1 at the right, for stereo. */
  pan: number;
}

type Pattern = 'sphere' | 'ring' | 'willow';
const PATTERNS: Pattern[] = ['sphere', 'ring', 'sphere', 'willow'];
const POINTS_PER_SHELL = SPARKS * LAGS.length + ROCKET_POINTS + 1;

/** The show for clearing a city: rockets climbing and bursting one after another across the view. */
export class Fireworks {
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly age = { value: FINALE_SECONDS };
  private readonly burst = new Float32Array(SHELLS * POINTS_PER_SHELL * 3);
  private readonly flung = new Float32Array(SHELLS * POINTS_PER_SHELL * 3);
  private readonly colours = new Float32Array(SHELLS * POINTS_PER_SHELL * 3);
  private readonly delays = new Float32Array(SHELLS * POINTS_PER_SHELL);
  private readonly lags = new Float32Array(SHELLS * POINTS_PER_SHELL);
  private readonly kinds = new Float32Array(SHELLS * POINTS_PER_SHELL);
  private readonly lives = new Float32Array(SHELLS * POINTS_PER_SHELL);
  private readonly seeds = new Float32Array(SHELLS * POINTS_PER_SHELL);
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    uPx: { value: number },
    private readonly random: () => number,
  ) {
    const geometry = new THREE.BufferGeometry();
    // Every point's position is its shell's burst, and the shader works out where it is from there
    geometry.setAttribute('position', new THREE.BufferAttribute(this.burst, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(this.flung, 3));
    geometry.setAttribute('aColour', new THREE.BufferAttribute(this.colours, 3));
    geometry.setAttribute('aDelay', new THREE.BufferAttribute(this.delays, 1));
    geometry.setAttribute('aLag', new THREE.BufferAttribute(this.lags, 1));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(this.kinds, 1));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        // A show hidden behind a tower would be no celebration at all
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPx, uAge: this.age, uClimb: { value: CLIMB_SECONDS }, uRise: { value: CLIMB } },
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

  /**
   * Spreads the shells across the view ahead of the camera, in gold, white and the city's own colour. They're placed
   * as if the camera looked level along its heading, because one tipped down at a badge would put them in the towers,
   * and the camera lifts to level for the show.
   */
  start(camera: THREE.PerspectiveCamera, accent: Rgb): Shell[] {
    const { random } = this;
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.back).setY(0);
    if (this.back.lengthSq() < 1e-6) this.back.set(0, 0, -1);
    this.back.normalize().negate();
    this.up.set(0, 1, 0);
    this.right.crossVectors(this.up, this.back);
    const reach = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const palette = [GOLD, accent, WHITE];
    const shells: Shell[] = [];

    for (let shell = 0; shell < SHELLS; shell++) {
      const distance = NEAREST + random() * (FURTHEST - NEAREST);
      const tall = reach * distance;
      const across = random() * 1.3 - 0.65;
      this.centre
        .copy(camera.position)
        .addScaledVector(this.back, -distance)
        .addScaledVector(this.right, across * tall * camera.aspect)
        .addScaledVector(this.up, (0.05 + random() * 0.4) * tall);
      this.centre.y = Math.max(this.centre.y, LOWEST);
      const pattern = PATTERNS[shell % PATTERNS.length];
      const colour = pattern === 'willow' ? GOLD : palette[shell % palette.length];
      const at = shell * BETWEEN_SHELLS + CLIMB_SECONDS;
      const life = pattern === 'willow' ? WILLOW_SECONDS : SPARK_SECONDS;
      shells.push({ at, centre: this.centre.clone(), colour, pan: Math.max(-1, Math.min(1, across / 0.65)) });

      // A ring bursts in a plane facing the camera, turned and tipped a little so each one differs
      const turn = random() * Math.PI;
      this.a.copy(this.right).multiplyScalar(Math.cos(turn)).addScaledVector(this.up, Math.sin(turn));
      this.b.copy(this.up).multiplyScalar(Math.cos(turn)).addScaledVector(this.right, -Math.sin(turn));
      this.b.addScaledVector(this.back, 0.45).normalize();

      const first = shell * POINTS_PER_SHELL;
      for (let spark = 0; spark < SPARKS; spark++) {
        const speed = distance * (pattern === 'willow' ? 0.32 + random() * 0.12 : 0.45 + random() * 0.2);
        let vx: number;
        let vy: number;
        let vz: number;
        if (pattern === 'ring') {
          const turn = (spark / SPARKS) * Math.PI * 2;
          vx = (Math.cos(turn) * this.a.x + Math.sin(turn) * this.b.x) * speed;
          vy = (Math.cos(turn) * this.a.y + Math.sin(turn) * this.b.y) * speed;
          vz = (Math.cos(turn) * this.a.z + Math.sin(turn) * this.b.z) * speed;
        } else {
          const y = random() * 2 - 1;
          const round = Math.sqrt(1 - y * y);
          const heading = random() * Math.PI * 2;
          vx = Math.cos(heading) * round * speed;
          vy = y * speed;
          vz = Math.sin(heading) * round * speed;
        }
        const seed = random();
        LAGS.forEach((lag, k) => {
          const i = first + spark * LAGS.length + k;
          this.place(i, SPARK, at, lag, life, seed, colour, vx, vy, vz);
        });
      }
      // The rocket: its head and a short trail behind it, climbing to the burst
      const rocket = first + SPARKS * LAGS.length;
      for (let k = 0; k < ROCKET_POINTS; k++) {
        this.place(rocket + k, ROCKET, at, k * 0.035, CLIMB_SECONDS, random(), WHITE, 0, 0, 0);
      }
      this.place(rocket + ROCKET_POINTS, FLASH, at, 0, 0.16, 0, colour, 0, 0, 0);
    }

    const { geometry } = this.points;
    for (const name of ['position', 'aVelocity', 'aColour', 'aDelay', 'aLag', 'aKind', 'aLife', 'aSeed']) {
      geometry.attributes[name].needsUpdate = true;
    }
    this.age.value = 0;
    this.points.visible = true;
    return shells;
  }

  private place(
    i: number,
    kind: number,
    at: number,
    lag: number,
    life: number,
    seed: number,
    colour: Rgb,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    this.centre.toArray(this.burst, i * 3);
    this.flung.set([vx, vy, vz], i * 3);
    this.colours.set(colour, i * 3);
    this.delays[i] = at;
    this.lags[i] = lag;
    this.kinds[i] = kind;
    this.lives[i] = life;
    this.seeds[i] = seed;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age.value = Math.min(FINALE_SECONDS, this.age.value + dt);
    if (!this.active) this.points.visible = false;
  }
}
