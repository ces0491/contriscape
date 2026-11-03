import * as THREE from 'three';
import { paintBadge } from './badge-art';
import type { CityMap } from './map';
import type { Milestone } from './milestones';
import { BADGE_GLOW_FRAGMENT, BADGE_GLOW_VERTEX } from './shaders';
import type { Shared } from './world';

const HIT_RADIUS = 1.8;
const RADIUS = 0.85;
const THICKNESS = 0.12;
const HOVER = 2.1;
const STACK = 2.1;
/** Keeps the white in the artwork under the bloom threshold, so a badge stays readable up close. */
const FACE_TINT = new THREE.Color(0.8, 0.8, 0.8);
const RIM = new THREE.Color(1.6, 1.15, 0.45);

function readEarned(key: string): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The milestones as medallions floating over their days. What a visitor earns stays in their own browser. */
export class Badges {
  readonly earned: Set<string>;
  private readonly key: string;
  private readonly places: THREE.Vector3[] = [];
  private readonly tokens: THREE.Group[] = [];
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly textures: THREE.CanvasTexture[] = [];
  private readonly glow = new THREE.BufferGeometry();
  private readonly lit: Float32Array;

  constructor(
    scene: THREE.Scene,
    map: CityMap,
    readonly milestones: Milestone[],
    login: string,
    shared: Shared,
  ) {
    this.key = `contriscape:badges:${login.toLowerCase()}`;
    this.earned = readEarned(this.key);

    const stacked = new Map<number, number>();
    const edge = new THREE.CylinderGeometry(RADIUS, RADIUS, THICKNESS, 40);
    edge.rotateX(Math.PI / 2);
    const face = new THREE.CircleGeometry(RADIUS, 40);
    const rim = new THREE.MeshBasicMaterial({ color: RIM });
    milestones.forEach(({ id, day }) => {
      const level = stacked.get(day) ?? 0;
      stacked.set(day, level + 1);
      const place = new THREE.Vector3(map.cx[day], map.top[day] + HOVER + level * STACK, map.cz[day]);
      this.places.push(place);

      const canvas = document.createElement('canvas');
      paintBadge(canvas, id);
      this.canvases.push(canvas);
      const texture = new THREE.CanvasTexture(canvas);
      this.textures.push(texture);
      const art = new THREE.MeshBasicMaterial({ map: texture, color: FACE_TINT });

      const token = new THREE.Group();
      const front = new THREE.Mesh(face, art);
      const back = new THREE.Mesh(face, art);
      front.position.z = THICKNESS / 2 + 0.01;
      back.position.z = -THICKNESS / 2 - 0.01;
      back.rotation.y = Math.PI;
      token.add(new THREE.Mesh(edge, rim), front, back);
      token.position.copy(place);
      scene.add(token);
      this.tokens.push(token);
    });

    const positions = new Float32Array(milestones.length * 3);
    this.places.forEach((p, i) => positions.set(p.toArray(), i * 3));
    this.lit = new Float32Array(milestones.length);
    this.glow.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.glow.setAttribute('aLit', new THREE.BufferAttribute(this.lit, 1));
    const points = new THREE.Points(
      this.glow,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPx: shared.uPx, uTime: shared.uTime },
        vertexShader: BADGE_GLOW_VERTEX,
        fragmentShader: BADGE_GLOW_FRAGMENT,
      }),
    );
    points.frustumCulled = false;
    points.renderOrder = 2;
    scene.add(points);
  }

  position(index: number): THREE.Vector3 {
    return this.places[index];
  }

  isEarned(index: number): boolean {
    return this.earned.has(this.milestones[index].id);
  }

  /** Whether this city is cleared. The ids in `earned` can outlast a milestone, so it can't just be counted. */
  get allEarned(): boolean {
    return this.milestones.every(({ id }) => this.earned.has(id));
  }

  picture(index: number): string {
    return this.canvases[index].toDataURL('image/png');
  }

  pictureFor(id: string): string {
    return this.picture(this.milestones.findIndex((m) => m.id === id));
  }

  /** Redraws the artwork, for the numerals once the display font has loaded. */
  repaint(): void {
    this.milestones.forEach(({ id }, i) => {
      paintBadge(this.canvases[i], id);
      this.textures[i].needsUpdate = true;
    });
  }

  /** The badge a laser bolt has reached at this point, marked as earned, or null. */
  hit(point: THREE.Vector3, play: number): Milestone | null {
    for (let i = 0; i < this.milestones.length; i++) {
      const badge = this.milestones[i];
      if (badge.day > play || this.earned.has(badge.id) || point.distanceTo(this.places[i]) > HIT_RADIUS) continue;
      this.earned.add(badge.id);
      try {
        localStorage.setItem(this.key, JSON.stringify([...this.earned]));
      } catch {
        // Private windows can refuse storage. The badge still counts for this visit.
      }
      return badge;
    }
    return null;
  }

  /** Forgets what this visitor has earned on this city, so the badges can be shot again. */
  reset(): void {
    this.earned.clear();
    try {
      localStorage.removeItem(this.key);
    } catch {
      // Storage that can't be reached has nothing saved in it.
    }
  }

  update(time: number, play: number): void {
    this.milestones.forEach((badge, i) => {
      // An earned badge has been blown up, until a reset brings it back
      const standing = badge.day <= play && !this.earned.has(badge.id);
      const token = this.tokens[i];
      token.visible = standing;
      token.rotation.y = time * 1.1 + i;
      this.lit[i] = standing ? 1 : 0;
    });
    this.glow.attributes.aLit.needsUpdate = true;
  }
}
