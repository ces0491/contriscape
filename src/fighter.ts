import * as THREE from 'three';
import { turnTowards } from './aim';
import type { Colours } from './colours';
import * as glsl from './shaders';

const MAX_BOLTS = 30;
const SPARKS = 70;
const IMPACTS = 8;
const BOLT_SPEED = 130;
const COOLDOWN = 0.13;
const BOLT_LIFE = 1.3;
const BOLT_RADIUS = 0.06;
const BOLT_LENGTH = 3;
const IMPACT_SECONDS = 0.2;
const MUZZLE_SECONDS = 0.07;
/** Radians a second that a bolt fired at a locked badge turns towards it. */
export const HOMING = 3;
/** The model is drawn a little larger than the ship's footprint, then scaled down to it. */
const SCALE = 0.8;
/** The guns sit either side of the centre, in the scene's units. In the model's own units they're this over SCALE. */
const GUN = new THREE.Vector3(0.34, 0, -0.1);
/** Past 1 on purpose: the old bolts' colour, bright enough for the bloom pass to make them glow. */
const BOLT_COLOUR = new THREE.Color(4.2, 0.5, 0.36);
const IMPACT_COLOUR = new THREE.Color(1, 0.55, 0.25);
const MUZZLE_COLOUR = new THREE.Color(1, 0.35, 0.25);
const NOZZLE_COLOUR = new THREE.Color(0.65, 1.15, 1.9);
const PORT = new THREE.Color(3, 0.25, 0.18);
const STARBOARD = new THREE.Color(0.25, 3, 0.6);
const STROBE = new THREE.Color(3.5, 3.5, 3.5);
const STROBE_EVERY = 1.3;
const STROBE_SECONDS = 0.06;
/** The wingtips, in the model's own units, where the nav lights sit and the vapour trails start. */
const WINGTIP = new THREE.Vector3(0.5, -0.03, 0.38);
const NOZZLE_Z = 0.585;
const ENGINE_X = 0.13;

/** A flat outline, extruded thin with softened edges, centred on and laid in the ship's horizontal plane. */
function plate(outline: [number, number][], thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const bevel = thickness * 0.3;
  const depth = thickness - bevel * 2;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, depth / 2, 0);
  return geometry;
}

/** A body of revolution from nose to tail along Z, from a profile of [radius, z] pairs, flattened by `sx` and `sy`. */
function body(profile: [number, number][], segments: number, sx: number, sy: number): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    segments,
  );
  // The lathe turns about Y, so laying its axis along Z points the nose forward
  geometry.rotateX(Math.PI / 2);
  geometry.scale(sx, sy, 1);
  return geometry;
}

function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(([at, colour]) => gradient.addColorStop(at, colour));
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

function glowPoints(
  positions: number[],
  texture: THREE.Texture,
  size: number,
): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: texture,
      size,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

export interface Fighter {
  /** The ship, facing -Z. Its first child is the fuselage, in the hull colour. */
  group: THREE.Group;
  paint(colours: Colours): void;
  /** What the metal and glass reflect. */
  reflect(map: THREE.Texture): void;
  /** The exhaust and lights for this frame. Throttle is 0 standing still, 1 at cruise, and up to 2.7 on full boost. */
  update(time: number, dt: number, throttle: number): void;
  /** Lights both muzzles for a moment. */
  muzzle(): void;
  /** Writes where the wingtips are in the scene into `left` and `right`. */
  wingtips(left: THREE.Vector3, right: THREE.Vector3): void;
}

/** A swept delta interceptor with twin engines, nose towards -Z, about 0.83 wide once scaled. */
export function buildFighter(): Fighter {
  const hull = new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.34, envMapIntensity: 1.15 });
  const trim = new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.4, emissiveIntensity: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2027, metalness: 0.7, roughness: 0.42 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0b1724,
    metalness: 0.95,
    roughness: 0.06,
    envMapIntensity: 2.2,
    emissive: 0x0b2a3a,
    emissiveIntensity: 0.6,
  });
  const nozzle = new THREE.MeshBasicMaterial({ color: NOZZLE_COLOUR });
  const lit = [hull, trim, dark, glass];

  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    group.add(mesh);
    return mesh;
  };

  // Fuselage first, so the hull colour is easy to find
  add(
    body(
      [
        [0, -0.82],
        [0.028, -0.76],
        [0.055, -0.66],
        [0.082, -0.52],
        [0.105, -0.36],
        [0.122, -0.18],
        [0.13, 0.02],
        [0.13, 0.22],
        [0.122, 0.38],
        [0.105, 0.5],
        [0.07, 0.56],
        [0, 0.57],
      ],
      20,
      1.12,
      0.62,
    ),
    hull,
  );
  const canopy = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.072, 0.07, 0.24);
  add(canopy, glass, 0, 0.05, -0.3);

  [-1, 1].forEach((side) => {
    const w = side;
    const tilt = side * -0.06;
    add(
      plate(
        [
          [0.1 * w, -0.28],
          [0.5 * w, 0.34],
          [0.5 * w, 0.42],
          [0.1 * w, 0.46],
        ],
        0.022,
      ),
      hull,
      0,
      0,
      0,
      tilt,
    );
    add(
      plate(
        [
          [0.37 * w, 0.14],
          [0.5 * w, 0.34],
          [0.5 * w, 0.42],
          [0.37 * w, 0.43],
        ],
        0.028,
      ),
      trim,
      0,
      0.001,
      0,
      tilt,
    );
    // Strakes blend the nose into the wing root
    add(
      plate(
        [
          [0.05 * w, -0.58],
          [0.14 * w, -0.27],
          [0.1 * w, -0.22],
          [0.05 * w, -0.3],
        ],
        0.016,
      ),
      hull,
    );
    const fin = plate(
      [
        [0, 0.1],
        [0.24, 0.42],
        [0.24, 0.5],
        [0, 0.48],
      ],
      0.016,
    );
    fin.rotateZ(side > 0 ? Math.PI / 2 - 0.3 : Math.PI / 2 + 0.3);
    fin.translate(side * ENGINE_X, 0.03, 0);
    add(fin, trim);

    const nacelle = body(
      [
        [0, 0.02],
        [0.03, 0.04],
        [0.055, 0.12],
        [0.062, 0.3],
        [0.062, 0.5],
        [0.056, NOZZLE_Z],
      ],
      14,
      1,
      1,
    );
    add(nacelle, dark, side * ENGINE_X, -0.01);
    const ring = new THREE.TorusGeometry(0.056, 0.01, 6, 20);
    add(ring, dark, side * ENGINE_X, -0.01, NOZZLE_Z);
    add(new THREE.CircleGeometry(0.05, 20), nozzle, side * ENGINE_X, -0.01, NOZZLE_Z - 0.005);

    const barrel = new THREE.CylinderGeometry(0.011, 0.014, 0.36, 8);
    barrel.rotateX(Math.PI / 2);
    add(barrel, dark, (side * GUN.x) / SCALE, -0.012, 0.05);
  });

  // The exhaust, one cone per engine, sharing one set of uniforms
  const flameUniforms = { uThrottle: { value: 1 }, uTime: { value: 0 }, uSeed: { value: 0 } };
  const cone = new THREE.ConeGeometry(0.046, 1, 14, 1, true);
  cone.rotateX(Math.PI / 2);
  cone.translate(0, 0, 0.5);
  [-1, 1].forEach((side) => {
    const flame = new THREE.Mesh(
      cone,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { ...flameUniforms, uSeed: { value: side * 7.3 } },
        vertexShader: glsl.FLAME_VERTEX,
        fragmentShader: glsl.FLAME_FRAGMENT,
      }),
    );
    flame.position.set(side * ENGINE_X, -0.01, NOZZLE_Z + 0.004);
    flame.renderOrder = 4;
    group.add(flame);
  });

  const blue = glowTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(120,205,255,.75)'],
    [1, 'rgba(30,110,255,0)'],
  ]);
  const glow = glowPoints([-ENGINE_X, -0.01, NOZZLE_Z + 0.03, ENGINE_X, -0.01, NOZZLE_Z + 0.03], blue, 0.26);
  group.add(glow);

  const navLight = (colour: THREE.Color, x: number, y: number, z: number) => {
    const light = add(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: colour }), x, y, z);
    return light;
  };
  navLight(PORT, -WINGTIP.x, WINGTIP.y, WINGTIP.z);
  navLight(STARBOARD, WINGTIP.x, WINGTIP.y, WINGTIP.z);
  const strobes = [navLight(STROBE, -0.2, 0.262, 0.46), navLight(STROBE, 0.2, 0.262, 0.46)];

  const red = glowTexture([
    [0, 'rgba(255,240,230,1)'],
    [0.25, 'rgba(255,90,60,.8)'],
    [1, 'rgba(255,30,10,0)'],
  ]);
  const muzzles = glowPoints([-GUN.x / SCALE, -0.012, -0.14, GUN.x / SCALE, -0.012, -0.14], red, 0.7);
  muzzles.material.color.copy(MUZZLE_COLOUR);
  muzzles.visible = false;
  group.add(muzzles);
  let muzzleLeft = 0;

  group.scale.setScalar(SCALE);
  group.visible = false;

  return {
    group,
    paint(colours) {
      hull.color.set(colours.hull);
      trim.color.set(colours.trim);
      trim.emissive.set(colours.trim);
    },
    reflect(map) {
      lit.forEach((material) => {
        material.envMap = map;
        material.needsUpdate = true;
      });
    },
    update(time, dt, throttle) {
      flameUniforms.uThrottle.value = throttle;
      flameUniforms.uTime.value = time;
      glow.material.size = 0.14 + 0.05 * Math.min(throttle, 2.7);
      const flashing = time % STROBE_EVERY < STROBE_SECONDS;
      strobes.forEach((strobe) => {
        strobe.visible = flashing;
      });
      muzzleLeft = Math.max(0, muzzleLeft - dt);
      muzzles.visible = muzzleLeft > 0;
      muzzles.material.size = 0.22 + 0.32 * (muzzleLeft / MUZZLE_SECONDS);
    },
    muzzle() {
      muzzleLeft = MUZZLE_SECONDS;
    },
    wingtips(left, right) {
      group.updateMatrixWorld();
      left.set(-WINGTIP.x, WINGTIP.y, WINGTIP.z).applyMatrix4(group.matrixWorld);
      right.copy(WINGTIP).applyMatrix4(group.matrixWorld);
    },
  };
}

interface Bolt {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  life: number;
  /** A locked badge the bolt curves towards, or null. */
  target: THREE.Vector3 | null;
}

/** Lasers, the sparks and flashes where they strike, and the curve onto a locked badge. Hits go through `onHit`. */
export class Weapons {
  private readonly bolts: Bolt[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly positions = new Float32Array(SPARKS * 3);
  private readonly colours = new Float32Array(SPARKS * 3);
  private readonly velocities = new Float32Array(SPARKS * 3);
  private readonly life = new Float32Array(SPARKS);
  private readonly sparks = new THREE.BufferGeometry();
  private readonly impacts = new THREE.BufferGeometry();
  private readonly impactAt = new Float32Array(IMPACTS * 3);
  private readonly impactAge = new Float32Array(IMPACTS).fill(IMPACT_SECONDS);
  private nextSpark = 0;
  private nextImpact = 0;
  private cooldown = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly size = new THREE.Vector3(BOLT_RADIUS, BOLT_RADIUS, BOLT_LENGTH / 2);
  private readonly along = new THREE.Vector3(0, 0, 1);
  private readonly to = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly random: () => number,
    uPx: { value: number },
  ) {
    // A unit sphere, stretched per bolt into a long ellipsoid along Z
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColour: { value: BOLT_COLOUR }, uScale: { value: this.size } },
        vertexShader: glsl.BOLT_VERTEX,
        fragmentShader: glsl.BOLT_FRAGMENT,
      }),
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

    const tint = new Float32Array(IMPACTS * 3);
    for (let i = 0; i < IMPACTS; i++) IMPACT_COLOUR.toArray(tint, i * 3);
    this.impacts.setAttribute('position', new THREE.BufferAttribute(this.impactAt, 3));
    this.impacts.setAttribute('aAge', new THREE.BufferAttribute(this.impactAge, 1));
    this.impacts.setAttribute('aColour', new THREE.BufferAttribute(tint, 3));
    const flashes = new THREE.Points(
      this.impacts,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPx, uLife: { value: IMPACT_SECONDS }, uSize: { value: 1.1 } },
        vertexShader: glsl.FLASH_VERTEX,
        fragmentShader: glsl.FLASH_FRAGMENT,
      }),
    );
    flashes.frustumCulled = false;
    flashes.renderOrder = 4;
    scene.add(flashes);
  }

  get activeBolts(): number {
    return this.bolts.length;
  }

  /** Whether the guns fired, because they cool down between shots. Bolts fired with a target curve towards it. */
  fire(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    orientation: THREE.Quaternion,
    target: THREE.Vector3 | null = null,
  ): boolean {
    if (this.cooldown > 0 || this.bolts.length >= MAX_BOLTS - 1) return false;
    this.cooldown = COOLDOWN;
    [-1, 1].forEach((side) => {
      const pos = new THREE.Vector3(side * GUN.x, GUN.y, GUN.z).applyQuaternion(orientation).add(origin);
      this.bolts.push({ pos, dir: direction.clone(), life: BOLT_LIFE, target });
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
    const i = (this.nextImpact = (this.nextImpact + 1) % IMPACTS);
    p.toArray(this.impactAt, i * 3);
    this.impactAge[i] = 0;
  }

  update(
    dt: number,
    solid: (p: THREE.Vector3) => number | null,
    onHit: (hit: number, at: THREE.Vector3) => void,
  ): void {
    this.cooldown -= dt;
    for (let b = this.bolts.length - 1; b >= 0; b--) {
      const bolt = this.bolts[b];
      if (bolt.target) {
        this.to.subVectors(bolt.target, bolt.pos);
        // Once past its target a bolt flies straight on
        if (this.to.dot(bolt.dir) > 0) turnTowards(bolt.dir, this.to, HOMING * dt);
      }
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
        this.m.compose(bolt.pos, this.q, this.size);
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

    for (let i = 0; i < IMPACTS; i++) this.impactAge[i] = Math.min(IMPACT_SECONDS, this.impactAge[i] + dt);
    this.impacts.attributes.position.needsUpdate = true;
    this.impacts.attributes.aAge.needsUpdate = true;
  }
}
