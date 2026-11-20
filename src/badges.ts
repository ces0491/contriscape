import * as THREE from 'three';
import { paintBadge } from './badge-art';
import { SHIP_HALF_SPAN } from './fighter';
import type { CityMap } from './map';
import type { Milestone } from './milestones';
import { BADGE_GLOW_FRAGMENT, BADGE_GLOW_VERTEX } from './shaders';
import type { Shared } from './world';

const HIT_RADIUS = 1.8;
export const BADGE_RADIUS = 0.85;
/** A ship whose centre passes this close to a badge's has flown into it. A badge spins, so its edge sweeps a ball. */
export const TOUCH_REACH = BADGE_RADIUS + SHIP_HALF_SPAN;

interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * How close a move from `from` to `to` comes to `at`. The whole move counts, so a fast ship can't skip a badge between
 * frames.
 */
export function closestPass(from: Point, to: Point, at: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = dx * dx + dy * dy + dz * dz;
  const along = length > 0 ? ((at.x - from.x) * dx + (at.y - from.y) * dy + (at.z - from.z) * dz) / length : 0;
  const k = Math.min(1, Math.max(0, along));
  return Math.hypot(from.x + dx * k - at.x, from.y + dy * k - at.y, from.z + dz * k - at.z);
}
const THICKNESS = 0.12;
const HOVER = 2.1;
const STACK = 2.1;
/** Keeps the white in the artwork under the bloom threshold, so a badge stays readable up close. */
const FACE_TINT = new THREE.Color(0.8, 0.8, 0.8);
const RIM = new THREE.Color(1.6, 1.15, 0.45);

function readIds(key: string): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function readSeconds(key: string): number | null {
  try {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

function saveIds(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Private windows can refuse storage. The badge still counts for this visit.
  }
}

/** The milestones as medallions floating over their days. What a visitor earns stays in their own browser. */
export class Badges {
  readonly earned: Set<string>;
  /** The earned badges this visitor flew to, rather than jumping to them from the list. */
  readonly flown: Set<string>;
  private readonly key: string;
  private readonly flownKey: string;
  private readonly bestKey: string;
  private fastest: number | null;
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
    this.earned = readIds(this.key);
    this.flownKey = `contriscape:flown:${login.toLowerCase()}`;
    this.flown = readIds(this.flownKey);
    this.bestKey = `contriscape:best:${login.toLowerCase()}`;
    this.fastest = readSeconds(this.bestKey);

    const stacked = new Map<number, number>();
    const edge = new THREE.CylinderGeometry(BADGE_RADIUS, BADGE_RADIUS, THICKNESS, 40);
    edge.rotateX(Math.PI / 2);
    const face = new THREE.CircleGeometry(BADGE_RADIUS, 40);
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

  /** Whether a badge is up to be shot: its day has come and it hasn't been blown up. */
  isStanding(index: number, play: number): boolean {
    return this.milestones[index].day <= play && !this.isEarned(index);
  }

  /** Whether this city is cleared. The ids in `earned` can outlast a milestone, so it can't just be counted. */
  get allEarned(): boolean {
    return this.milestones.every(({ id }) => this.earned.has(id));
  }

  isFlown(index: number): boolean {
    const { id } = this.milestones[index];
    return this.earned.has(id) && this.flown.has(id);
  }

  /** Whether every badge here was flown to. */
  get allFlown(): boolean {
    return this.milestones.every((_, i) => this.isFlown(i));
  }

  /** The fastest timed clear of this city in this browser, in seconds, or null. A reset leaves it standing. */
  get best(): number | null {
    return this.fastest;
  }

  /** Takes a timed clear, and says whether it is the fastest yet. */
  recordClear(seconds: number): boolean {
    if (this.fastest !== null && seconds >= this.fastest) return false;
    this.fastest = seconds;
    try {
      localStorage.setItem(this.bestKey, String(seconds));
    } catch {
      // Private windows can refuse storage. The time still stands for this visit.
    }
    return true;
  }

  /** Marks a badge as one the visitor flew to. */
  fly(index: number): void {
    this.flown.add(this.milestones[index].id);
    saveIds(this.flownKey, this.flown);
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
      if (this.isStanding(i, play) && point.distanceTo(this.places[i]) <= HIT_RADIUS) return this.claim(i);
    }
    return null;
  }

  /**
   * A badge the ship flew into on its move from `from` to `to`, marked as earned, or null. One at a time, so a ship that
   * takes two stacked badges at once earns the city's last only once: ask again until it says null.
   */
  touched(from: THREE.Vector3, to: THREE.Vector3, play: number): Milestone | null {
    for (let i = 0; i < this.milestones.length; i++) {
      if (this.isStanding(i, play) && closestPass(from, to, this.places[i]) <= TOUCH_REACH) return this.claim(i);
    }
    return null;
  }

  private claim(index: number): Milestone {
    const badge = this.milestones[index];
    this.earned.add(badge.id);
    saveIds(this.key, this.earned);
    return badge;
  }

  /** Forgets what this visitor has earned on this city, so the badges can be won again. */
  reset(): void {
    this.earned.clear();
    this.flown.clear();
    try {
      localStorage.removeItem(this.key);
      localStorage.removeItem(this.flownKey);
    } catch {
      // Storage that can't be reached has nothing saved in it.
    }
  }

  update(time: number, play: number): void {
    this.milestones.forEach((_, i) => {
      // An earned badge has been blown up, until a reset brings it back
      const standing = this.isStanding(i, play);
      const token = this.tokens[i];
      token.visible = standing;
      token.rotation.y = time * 1.1 + i;
      this.lit[i] = standing ? 1 : 0;
    });
    this.glow.attributes.aLit.needsUpdate = true;
  }
}
