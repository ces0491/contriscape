import * as THREE from 'three';
import { TRAIL_FRAGMENT, TRAIL_VERTEX } from './shaders';

/** Points kept along each trail. */
const POINTS = 40;
/** A new point is laid down after the wingtip has moved this far. */
const SPACING = 0.2;
/** Seconds a point lasts. */
const LIFE = 0.45;
const WIDTH = 0.022;
/** Trails spread as they age, to this many times their width. */
const SPREAD = 2.2;
const COLOUR = new THREE.Color(0.42, 0.52, 0.66);
/** A wingtip that moves further than this in a frame has jumped, so its trail starts again. */
const JUMP = 6;

interface Point {
  at: THREE.Vector3;
  born: number;
  strength: number;
}

/** A ribbon of vapour from one wingtip, turned to face the camera, thinning and fading as it ages. */
class Ribbon {
  private readonly points: Point[] = [];
  private readonly head: Point = { at: new THREE.Vector3(), born: 0, strength: 0 };
  readonly geometry = new THREE.BufferGeometry();
  private readonly position = new Float32Array(POINTS * 2 * 3);
  private readonly alpha = new Float32Array(POINTS * 2);
  private readonly tangent = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor() {
    const sides = new Float32Array(POINTS * 2);
    for (let i = 0; i < POINTS; i++) {
      sides[i * 2] = -1;
      sides[i * 2 + 1] = 1;
    }
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    this.geometry.setDrawRange(0, 0);
  }

  update(tip: THREE.Vector3, strength: number, time: number, camera: THREE.Vector3): void {
    while (this.points.length && time - this.points[0].born > LIFE) this.points.shift();
    const laid = this.points[this.points.length - 1];
    // A jump moves the ship across the city in one frame, and a ribbon would stretch all the way
    if (laid && laid.at.distanceTo(tip) > JUMP) this.points.length = 0;
    if (!laid || laid.at.distanceTo(tip) >= SPACING) {
      this.points.push({ at: tip.clone(), born: time, strength });
      if (this.points.length > POINTS - 1) this.points.shift();
    }
    // A live point rides on the wingtip itself, so the ribbon stays attached between the laid ones
    this.head.at.copy(tip);
    this.head.born = time;
    this.head.strength = strength;

    const n = this.points.length + 1;
    const pointAt = (i: number) => (i < this.points.length ? this.points[i] : this.head);
    for (let i = 0; i < n; i++) {
      const point = pointAt(i);
      const before = pointAt(Math.max(0, i - 1)).at;
      const after = pointAt(Math.min(n - 1, i + 1)).at;
      this.tangent.subVectors(after, before);
      this.toCamera.subVectors(camera, point.at);
      this.side.crossVectors(this.tangent, this.toCamera);
      const age = Math.min(1, (time - point.born) / LIFE);
      const width = WIDTH * (1 + (SPREAD - 1) * age);
      if (this.side.lengthSq() > 1e-12) this.side.normalize().multiplyScalar(width);
      // Fades in from the wingtip, so the ribbon doesn't start as a hard edge
      const fadeIn = Math.min(1, (n - 1 - i) / 3);
      const a = point.strength * (1 - age) * (1 - age) * fadeIn;
      this.position.set([point.at.x - this.side.x, point.at.y - this.side.y, point.at.z - this.side.z], i * 6);
      this.position.set([point.at.x + this.side.x, point.at.y + this.side.y, point.at.z + this.side.z], i * 6 + 3);
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
    }
    this.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.points.length = 0;
    this.geometry.setDrawRange(0, 0);
  }
}

/** Vapour off both wingtips, strongest in hard turns and at speed. */
export class Trails {
  private readonly ribbons = [new Ribbon(), new Ribbon()];
  private readonly meshes: THREE.Mesh[];

  constructor(scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColour: { value: COLOUR } },
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
    });
    this.meshes = this.ribbons.map((ribbon) => {
      const mesh = new THREE.Mesh(ribbon.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      return mesh;
    });
  }

  /** Lays down this frame's points. `strength` runs from 0, no vapour, to 1. */
  update(left: THREE.Vector3, right: THREE.Vector3, strength: number, time: number, camera: THREE.Vector3): void {
    this.ribbons[0].update(left, strength, time, camera);
    this.ribbons[1].update(right, strength, time, camera);
  }

  /** Drops the trails, for a jump or a cut, where a ribbon would otherwise stretch across the city. */
  clear(): void {
    this.ribbons.forEach((ribbon) => ribbon.clear());
  }

  set visible(on: boolean) {
    this.meshes.forEach((mesh) => {
      mesh.visible = on;
    });
  }
}
