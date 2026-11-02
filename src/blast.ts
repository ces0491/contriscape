import * as THREE from 'three';
import { BLAST_FRAGMENT, BLAST_VERTEX } from './shaders';

const SECONDS = 1.2;
const PIECES = 40;
const PIECE_SIZE = 0.26;
const GRAVITY = 10;
const FIREBALL_REACH = 3.6;
const SHOCKWAVE_REACH = 9;
const GOLD = new THREE.Color(2.3, 1.55, 0.5);
const WAVE = new THREE.Color(1.5, 1, 0.45);

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

/** A badge going up: a fireball, a shockwave and its gold thrown out in pieces. */
export class Blast {
  private readonly group = new THREE.Group();
  private readonly fireball: THREE.Mesh;
  private readonly fade = { value: 0 };
  private readonly wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly pieces: THREE.InstancedMesh;
  private readonly flung = Array.from({ length: PIECES }, () => new THREE.Vector3());
  private readonly spun = Array.from({ length: PIECES }, () => new THREE.Vector3());
  private age = SECONDS;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly random: () => number,
  ) {
    this.fireball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uFade: this.fade },
        vertexShader: BLAST_VERTEX,
        fragmentShader: BLAST_FRAGMENT,
      }),
    );
    this.wave = new THREE.Mesh(
      new THREE.RingGeometry(0.93, 1, 48),
      new THREE.MeshBasicMaterial({
        color: WAVE,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.pieces = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(PIECE_SIZE),
      new THREE.MeshBasicMaterial({ color: GOLD }),
      PIECES,
    );
    this.pieces.frustumCulled = false;
    this.group.add(this.fireball, this.wave, this.pieces);
    this.group.visible = false;
    scene.add(this.group);
  }

  get active(): boolean {
    return this.age < SECONDS;
  }

  start(at: THREE.Vector3): void {
    this.age = 0;
    this.group.position.copy(at);
    this.group.visible = true;
    const { random } = this;
    this.flung.forEach((v, i) => {
      const y = random() * 2 - 1;
      const round = Math.sqrt(1 - y * y);
      const heading = random() * Math.PI * 2;
      v.set(Math.cos(heading) * round, y, Math.sin(heading) * round).multiplyScalar(4 + random() * 8);
      this.spun[i].set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(22);
    });
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.active) return;
    this.age = Math.min(SECONDS, this.age + dt);
    const t = this.age;
    const k = t / SECONDS;

    this.fireball.scale.setScalar(0.5 + FIREBALL_REACH * easeOut(Math.min(1, k * 2.4)));
    this.fade.value = Math.pow(1 - k, 2.2);
    this.wave.scale.setScalar(0.5 + SHOCKWAVE_REACH * easeOut(k));
    this.wave.quaternion.copy(camera.quaternion);
    this.wave.material.opacity = Math.pow(1 - k, 1.6);

    this.s.setScalar(Math.max(0, 1 - k * k));
    for (let i = 0; i < PIECES; i++) {
      const v = this.flung[i];
      const spin = this.spun[i];
      this.p.copy(v).multiplyScalar(t);
      this.p.y -= 0.5 * GRAVITY * t * t;
      this.q.setFromEuler(this.e.set(spin.x * t, spin.y * t, spin.z * t));
      this.m.compose(this.p, this.q, this.s);
      this.pieces.setMatrixAt(i, this.m);
    }
    this.pieces.instanceMatrix.needsUpdate = true;

    if (!this.active) this.group.visible = false;
  }
}
