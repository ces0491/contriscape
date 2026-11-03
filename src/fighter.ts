import * as THREE from 'three';
import type { Colours } from './colours';

const MAX_BOLTS = 30;
const SPARKS = 70;
const BOLT_SPEED = 130;
const COOLDOWN = 0.13;
const BOLT_LIFE = 1.3;

/** A flat outline, extruded thin and laid in the ship's horizontal plane. */
function plate(outline: [number, number][], thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function engineGlow(): THREE.Points {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(120,205,255,.75)');
    gradient.addColorStop(1, 'rgba(30,110,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.1, 0, 0.56, 0.1, 0, 0.56]), 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(canvas),
      size: 0.24,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

/** A swept delta interceptor, nose towards -Z, about 0.84 wide once scaled. */
export function buildFighter(): { fighter: THREE.Group; paintFighter: (colours: Colours) => void } {
  const hull = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a3038 });
  const trim = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const fighter = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y = 0, z = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, y, z);
    mesh.rotation.z = rz;
    fighter.add(mesh);
  };

  const nose = new THREE.ConeGeometry(0.15, 1.3, 4);
  nose.rotateY(Math.PI / 4);
  nose.rotateX(-Math.PI / 2);
  nose.scale(1, 0.5, 1);
  add(nose, hull, 0, -0.1);

  const canopy = new THREE.ConeGeometry(0.06, 0.34, 4);
  canopy.rotateY(Math.PI / 4);
  canopy.rotateX(-Math.PI / 2);
  add(canopy, dark, 0.05, -0.22);

  [-1, 1].forEach((side) => {
    const w = side;
    add(
      plate(
        [
          [0.05 * w, -0.34],
          [0.52 * w, 0.42],
          [0.42 * w, 0.46],
          [0.05 * w, 0.42],
        ],
        0.018,
      ),
      hull,
      0,
      0,
      side * -0.06,
    );
    add(
      plate(
        [
          [0.39 * w, 0.2],
          [0.52 * w, 0.42],
          [0.42 * w, 0.46],
          [0.33 * w, 0.31],
        ],
        0.022,
      ),
      trim,
      0.002,
      0,
      side * -0.06,
    );
    const fin = plate(
      [
        [0, 0.12],
        [0.2, 0.46],
        [0.07, 0.46],
        [0, 0.34],
      ],
      0.016,
    );
    fin.rotateZ(side > 0 ? Math.PI / 2 - 0.3 : Math.PI / 2 + 0.3);
    fin.translate(side * 0.12, 0.03, 0);
    add(fin, trim);
    const engine = new THREE.CylinderGeometry(0.05, 0.06, 0.34, 10);
    engine.rotateX(Math.PI / 2);
    engine.translate(side * 0.1, 0, 0.36);
    add(engine, dark);
  });

  fighter.add(engineGlow());
  fighter.scale.setScalar(0.8);
  fighter.visible = false;
  return {
    fighter,
    paintFighter(colours) {
      hull.color.set(colours.hull);
      trim.color.set(colours.trim);
    },
  };
}

/** Lasers and the sparks they throw. Bolts report each hit through `onHit`, with the day of a tower or -1. */
export class Weapons {
  private readonly bolts: { pos: THREE.Vector3; dir: THREE.Vector3; life: number }[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly positions = new Float32Array(SPARKS * 3);
  private readonly colours = new Float32Array(SPARKS * 3);
  private readonly velocities = new Float32Array(SPARKS * 3);
  private readonly life = new Float32Array(SPARKS);
  private readonly sparks = new THREE.BufferGeometry();
  private nextSpark = 0;
  private cooldown = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly unit = new THREE.Vector3(1, 1, 1);
  private readonly along = new THREE.Vector3(0, 0, 1);

  constructor(
    scene: THREE.Scene,
    private readonly random: () => number,
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.04, 0.04, 2.4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 0.5, 0.36) }),
      MAX_BOLTS,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);

    this.sparks.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.sparks.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    const points = new THREE.Points(
      this.sparks,
      new THREE.PointsMaterial({
        size: 0.2,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);
  }

  get activeBolts(): number {
    return this.bolts.length;
  }

  /** Whether the guns fired, because they cool down between shots. */
  fire(origin: THREE.Vector3, direction: THREE.Vector3, orientation: THREE.Quaternion): boolean {
    if (this.cooldown > 0 || this.bolts.length >= MAX_BOLTS - 1) return false;
    this.cooldown = COOLDOWN;
    [-1, 1].forEach((side) => {
      const pos = new THREE.Vector3(side * 0.34, 0, -0.1).applyQuaternion(orientation).add(origin);
      this.bolts.push({ pos, dir: direction.clone(), life: BOLT_LIFE });
    });
    return true;
  }

  private burst(p: THREE.Vector3): void {
    for (let n = 0; n < 10; n++) {
      const k = (this.nextSpark = (this.nextSpark + 1) % SPARKS);
      this.positions.set([p.x, p.y, p.z], k * 3);
      this.velocities.set([(this.random() - 0.5) * 9, (this.random() - 0.2) * 8, (this.random() - 0.5) * 9], k * 3);
      this.life[k] = 0.45 + this.random() * 0.35;
    }
  }

  update(
    dt: number,
    solid: (p: THREE.Vector3) => number | null,
    onHit: (hit: number, at: THREE.Vector3) => void,
  ): void {
    this.cooldown -= dt;
    for (let b = this.bolts.length - 1; b >= 0; b--) {
      const bolt = this.bolts[b];
      const steps = Math.ceil((BOLT_SPEED * dt) / 0.5);
      let gone = false;
      for (let n = 0; n < steps && !gone; n++) {
        bolt.pos.addScaledVector(bolt.dir, (BOLT_SPEED * dt) / steps);
        const hit = solid(bolt.pos);
        if (hit !== null) {
          this.burst(bolt.pos);
          gone = true;
          onHit(hit, bolt.pos);
        }
      }
      bolt.life -= dt;
      if (gone || bolt.life <= 0) this.bolts.splice(b, 1);
    }

    for (let n = 0; n < MAX_BOLTS; n++) {
      const bolt = this.bolts[n];
      if (bolt) {
        this.q.setFromUnitVectors(this.along, bolt.dir);
        this.m.compose(bolt.pos, this.q, this.unit);
      } else {
        this.m.makeScale(0, 0, 0);
      }
      this.mesh.setMatrixAt(n, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    for (let k = 0; k < SPARKS; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      for (let a = 0; a < 3; a++) this.positions[k * 3 + a] += this.velocities[k * 3 + a] * dt;
      this.velocities[k * 3 + 1] -= 14 * dt;
      const f = Math.max(0, this.life[k]) * 2.6;
      this.colours.set([f, f * 0.62, f * 0.22], k * 3);
    }
    this.sparks.attributes.position.needsUpdate = true;
    this.sparks.attributes.color.needsUpdate = true;
  }
}
