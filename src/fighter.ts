import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { turnTowards } from './aim';
import type { Colours } from './colours';
import * as glsl from './shaders';

const MAX_BOLTS = 30;
const SPARKS = 70;
const SPARK_SIZE = 0.2;
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
/**
 * The widest a ship's model may reach to either side, in its own units, lights and guns included. `tests/ships.test.ts`
 * holds every design to it.
 */
export const WIDEST = 0.52;
/** How far a ship can reach to either side of its centre, in the scene's units. */
export const SHIP_HALF_SPAN = WIDEST * SCALE;
/** Past 1 on purpose: the old bolts' colour, bright enough for the bloom pass to make them glow. */
const BOLT_COLOUR = new THREE.Color(4.2, 0.5, 0.36);
const IMPACT_COLOUR = new THREE.Color(1, 0.55, 0.25);
const MUZZLE_COLOUR = new THREE.Color(1, 0.35, 0.25);
const NOZZLE_COLOUR = new THREE.Color(0.65, 1.15, 1.9);
/** A turbine on full boost, white-hot. */
const TURBINE_HOT = new THREE.Color(2.4, 2.05, 1.6);
/** The metal round a nozzle as it starts to heat, and once it is hot. Its brightness is set as it heats. */
const EMBER = new THREE.Color(1, 0.22, 0.04);
const WHITE_HOT = new THREE.Color(1.5, 1.05, 0.55);
const PORT = new THREE.Color(3, 0.25, 0.18);
const STARBOARD = new THREE.Color(0.25, 3, 0.6);
const STROBE = new THREE.Color(3.5, 3.5, 3.5);
const STROBE_EVERY = 1.3;
const STROBE_SECONDS = 0.06;
/** The wingtips, in the model's own units, where the nav lights sit and the vapour trails start. */
const WINGTIP = new THREE.Vector3(0.5, -0.03, 0.38);
const NOZZLE_Z = 0.585;
const ENGINE_X = 0.13;
/** The radius of a nav light or a strobe. */
const NAV_RADIUS = 0.018;

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

/**
 * One section of a wing, fin or canard: how far out along the span it is, where its leading and trailing edges are
 * along the ship, how thick it is at its thickest, and how high it sits.
 */
export interface Station {
  x: number;
  le: number;
  te: number;
  t: number;
  y?: number;
}

/** Fractions of the chord from the leading edge back, closer together at the ends, where a section curves most. */
const CHORD = Array.from({ length: 11 }, (_, i) => (1 - Math.cos((Math.PI * i) / 10)) / 2);

/** Half the thickness of a section 1 thick, at a fraction of its chord: a symmetric NACA aerofoil, closed at the back. */
const aerofoil = (u: number) =>
  5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);

/**
 * A wing, fin or canard lofted through stations running out along +X, with a section that is thickest a third of the
 * way back and thins to both edges, so it catches the light the way a wing does. `chord` keeps that share of each
 * section, from the leading edge back, so one surface can be built of two finishes that meet without a seam. Both ends
 * are closed.
 */
export function wing(stations: Station[], chord: [number, number] = [0, 1]): THREE.BufferGeometry {
  const [from, to] = chord;
  const us = [from, ...CHORD.filter((u) => u > from + 1e-6 && u < to - 1e-6), to];
  const point = (s: Station, u: number, side: 1 | -1) => [
    s.x,
    (s.y ?? 0) + side * aerofoil(u) * s.t,
    s.le + u * (s.te - s.le),
  ];
  // Over the top from back to front, then under the bottom from front to back, which faces every triangle outwards.
  // A share that starts behind the leading edge is two strips, one on each surface.
  const top = [...us].reverse().map((u) => [u, 1] as const);
  const under = us.map((u) => [u, -1] as const);
  const strips = from === 0 ? [[...top, ...under.slice(1)]] : [top, under];

  const positions: number[] = [];
  const indices: number[] = [];
  for (const strip of strips) {
    const base = positions.length / 3;
    for (const s of stations) for (const [u, side] of strip) positions.push(...point(s, u, side));
    const n = strip.length;
    for (let i = 0; i < stations.length - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = base + i * n + j;
        const b = a + n;
        indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }
  // The ends, as their own corners so they shade flat
  [stations[0], stations[stations.length - 1]].forEach((s, end) => {
    const base = positions.length / 3;
    for (const u of us) positions.push(...point(s, u, 1), ...point(s, u, -1));
    for (let k = 0; k < us.length - 1; k++) {
      const [upper, lower, nextUpper, nextLower] = [0, 1, 2, 3].map((n) => base + k * 2 + n);
      if (end) indices.push(upper, nextLower, lower, upper, nextUpper, nextLower);
      else indices.push(upper, lower, nextLower, upper, nextLower, nextUpper);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The same part on the other side of the ship. */
export function mirrored(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = geometry.clone();
  copy.scale(-1, 1, 1);
  // Mirroring turns every triangle inside out, so each is wound the other way
  const index = copy.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  }
  copy.computeVertexNormals();
  return copy;
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

/**
 * How big the frame being drawn is beside the canvas it ends up on: 1, or a fraction in a look drawn at an old screen's
 * resolution. three.js sizes its own points by the canvas, whatever they are drawn into, so each size set here is
 * multiplied by this.
 */
let frameScale = 1;
export function setFrameScale(scale: number): void {
  frameScale = scale;
}

/**
 * A turbine face, as a texture to multiply by the light inside the engine: curved blades bright, the gaps between them
 * dimmer, a dark hub with a ring round it, and the duct's dark rim.
 */
function turbineTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const c = size / 2;
    g.fillStyle = 'rgb(60,60,60)';
    g.fillRect(0, 0, size, size);
    g.fillStyle = 'rgb(115,115,115)';
    g.beginPath();
    g.arc(c, c, c * 0.94, 0, Math.PI * 2);
    g.fill();
    const blades = 13;
    g.fillStyle = 'rgb(240,240,240)';
    for (let n = 0; n < blades; n++) {
      const a = (n / blades) * Math.PI * 2;
      const at = (r: number, turn: number): [number, number] => [
        c + Math.cos(a + turn) * r * c,
        c + Math.sin(a + turn) * r * c,
      ];
      // Each blade is swept round as it goes out, wider at the tip
      g.beginPath();
      g.moveTo(...at(0.26, 0));
      g.lineTo(...at(0.92, 0.42));
      g.lineTo(...at(0.92, 0.66));
      g.lineTo(...at(0.26, 0.14));
      g.closePath();
      g.fill();
    }
    g.fillStyle = 'rgb(70,70,70)';
    g.beginPath();
    g.arc(c, c, c * 0.27, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgb(200,200,200)';
    g.lineWidth = size * 0.025;
    g.beginPath();
    g.arc(c, c, c * 0.2, 0, Math.PI * 2);
    g.stroke();
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

/**
 * Gives a ship's metal its seams and plating (`PLATING` in `src/shaders.ts`). The parts are built in place in the
 * ship's own units, so the position the shader reads is where the point is on the ship. `round` is shared by a ship's
 * materials and set for each design.
 */
function plated(material: THREE.MeshStandardMaterial, round: { value: number }): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRound = round;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShipP,vShipN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShipP=position;vShipN=normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${glsl.PLATING}`)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nplating(diffuseColor.rgb,roughnessFactor);',
      );
  };
  material.customProgramCacheKey = () => 'plated';
  return material;
}

/** The ships a visitor can fly, in the order Settings lists them. The first is the default. */
export const SHIPS = ['interceptor', 'dart', 'rocket', 'saucer', 'brick'] as const;
export type Ship = (typeof SHIPS)[number];
/** The year's own ship, flown in a year's flight and nowhere else, so it isn't in Settings. */
export const EDITION_SHIP = 'comet';
/** Every design there is a model of: the ships in Settings, and the year's own. */
export type Design = Ship | typeof EDITION_SHIP;
export const DEFAULT_SHIP: Ship = SHIPS[0];
export const SHIP_LABELS: Record<Ship, string> = {
  interceptor: 'Interceptor',
  dart: 'Dart',
  rocket: 'Rocket',
  saucer: 'Saucer',
  brick: 'Brick',
};

/** A saved choice, or the default for anything that isn't one. */
export function readShip(saved: string | null): Ship {
  return SHIPS.find((ship) => ship === saved) ?? DEFAULT_SHIP;
}

/** The parts of a ship by what they are made of, which is what a colour choice or a reflection is applied to. */
/** `hot` is the metal round a nozzle, which glows when the engines are boosted. */
type Finish = 'hull' | 'trim' | 'dark' | 'glass' | 'hot';

/** What a design is built with. `add` places one part, turned by `rz` about the ship's length. */
interface Kit {
  add(geometry: THREE.BufferGeometry, finish: Finish, x?: number, y?: number, z?: number, rz?: number): void;
}

/** Adds a part on the right, and its mirror image on the left. */
function both({ add }: Kit, geometry: THREE.BufferGeometry, finish: Finish, x = 0, y = 0, z = 0, rz = 0): void {
  add(mirrored(geometry), finish, -x, y, z, -rz);
  add(geometry, finish, x, y, z, rz);
}

/**
 * A gun on each side: a housing faired into the ship from `from` back to `to`, and a barrel out of its front to the
 * muzzle, with a ring round its end. The housing takes the finish of whatever it is faired into. Returns where the
 * right muzzle is.
 */
function guns(
  kit: Kit,
  x: number,
  y: number,
  [from, to, radius]: [from: number, to: number, radius: number],
  muzzle: number,
  finish: Finish,
): THREE.Vector3 {
  const length = to - from;
  both(
    kit,
    body(
      [
        [0, from],
        [radius * 0.6, from + length * 0.05],
        [radius, from + length * 0.25],
        [radius, to - length * 0.35],
        [radius * 0.5, to - length * 0.08],
        [0, to],
      ],
      12,
      1,
      1,
    ),
    finish,
    x,
    y,
  );
  const bore = Math.max(0.006, radius * 0.34);
  const barrel = new THREE.CylinderGeometry(bore * 1.15, bore, from + length * 0.1 - muzzle, 10);
  barrel.rotateX(Math.PI / 2);
  both(kit, barrel, 'dark', x, y, (muzzle + from + length * 0.1) / 2);
  both(kit, new THREE.TorusGeometry(bore * 1.25, bore * 0.4, 6, 14), 'dark', x, y, muzzle + bore * 0.4);
  return new THREE.Vector3(x, y, muzzle);
}

/** What a design leaves to be fitted the same way on every ship: its engines and lights, and where its guns fire from. */
interface Fittings {
  /** Each nozzle: where it is, and its radius. The flame, the glow and the lit disc are sized from the radius. */
  engines: [x: number, y: number, z: number, radius: number][];
  /** The right wingtip, where a nav light sits and a vapour trail starts. The left mirrors it. */
  wingtip: THREE.Vector3;
  strobes: [x: number, y: number, z: number][];
  /** The right gun's muzzle, where its bolts and its flash start. The left mirrors it. */
  muzzle: THREE.Vector3;
}

/** A swept delta about 0.83 wide once scaled, with twin engines, canted fins, and a gun faired into each wing root. */
function interceptor(kit: Kit): Fittings {
  const { add } = kit;
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
      24,
      1.12,
      0.62,
    ),
    'hull',
  );
  const canopy = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.072, 0.07, 0.24);
  add(canopy, 'glass', 0, 0.05, -0.3);
  // A bow across the canopy where the windscreen ends
  const bow = new THREE.TorusGeometry(1, 0.06, 5, 16, Math.PI);
  bow.scale(0.069, 0.067, 0.069);
  add(bow, 'dark', 0, 0.05, -0.39);

  // Out to the trim at 0.37, so the two finishes meet along one line across the wing
  const leading = (x: number) => -0.28 + ((x - 0.1) / 0.4) * 0.62;
  const trailing = (x: number) => 0.46 - ((x - 0.1) / 0.4) * 0.04;
  both(
    kit,
    wing([
      { x: 0.08, le: leading(0.08), te: trailing(0.08), t: 0.024 },
      { x: 0.37, le: leading(0.37), te: trailing(0.37), t: 0.011 },
    ]),
    'hull',
    0,
    0,
    0,
    -0.06,
  );
  both(
    kit,
    wing([
      { x: 0.37, le: leading(0.37), te: trailing(0.37), t: 0.011 },
      { x: 0.5, le: 0.34, te: 0.42, t: 0.007 },
    ]),
    'trim',
    0,
    0,
    0,
    -0.06,
  );
  // Strakes blend the nose into the wing root
  both(
    kit,
    wing([
      { x: 0.04, le: -0.6, te: -0.26, t: 0.012 },
      { x: 0.135, le: -0.29, te: -0.21, t: 0.005 },
    ]),
    'hull',
  );

  const fin = wing([
    { x: 0, le: 0.08, te: 0.5, t: 0.014 },
    { x: 0.24, le: 0.42, te: 0.5, t: 0.006 },
  ]);
  const nacelle = body(
    [
      [0, 0.02],
      [0.03, 0.04],
      [0.055, 0.12],
      [0.062, 0.3],
      [0.062, 0.5],
      [0.056, NOZZLE_Z],
    ],
    16,
    1,
    1,
  );
  [-1, 1].forEach((side) => {
    const canted = fin.clone();
    canted.rotateZ(side > 0 ? Math.PI / 2 - 0.3 : Math.PI / 2 + 0.3);
    add(canted, 'trim', side * ENGINE_X, 0.03);
    add(nacelle.clone(), 'dark', side * ENGINE_X, -0.01);
    // A ring at the nozzle, and a band where the engine meets it
    add(new THREE.TorusGeometry(0.056, 0.01, 6, 20), 'hot', side * ENGINE_X, -0.01, NOZZLE_Z);
    add(new THREE.TorusGeometry(0.062, 0.006, 6, 20), 'trim', side * ENGINE_X, -0.01, 0.46);
  });
  fin.dispose();
  nacelle.dispose();

  // Where the wing at 0.2 out sits, once tipped down by its anhedral
  const muzzle = guns(kit, 0.2, -0.012, [-0.2, 0.1, 0.022], -0.26, 'hull');

  return {
    engines: [
      [-ENGINE_X, -0.01, NOZZLE_Z, 0.05],
      [ENGINE_X, -0.01, NOZZLE_Z, 0.05],
    ],
    wingtip: WINGTIP.clone(),
    strobes: [
      [-0.2, 0.262, 0.46],
      [0.2, 0.262, 0.46],
    ],
    muzzle,
  };
}

/** A needle with one engine, small canards by the nose, cropped wings, a single tall fin, and guns under its chin. */
function dart(kit: Kit): Fittings {
  const { add } = kit;
  add(
    body(
      [
        [0, -0.86],
        [0.02, -0.78],
        [0.045, -0.6],
        [0.07, -0.38],
        [0.09, -0.1],
        [0.1, 0.15],
        [0.1, 0.4],
        [0.085, 0.52],
        [0.064, 0.58],
        [0, 0.585],
      ],
      22,
      1,
      0.8,
    ),
    'hull',
  );
  const canopy = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.055, 0.062, 0.2);
  add(canopy, 'glass', 0, 0.045, -0.36);
  const bow = new THREE.TorusGeometry(1, 0.07, 5, 16, Math.PI);
  bow.scale(0.053, 0.06, 0.053);
  add(bow, 'dark', 0, 0.045, -0.43);

  const leading = (x: number) => -0.04 + ((x - 0.07) / 0.37) * 0.34;
  const trailing = (x: number) => 0.46 - ((x - 0.07) / 0.37) * 0.06;
  both(
    kit,
    wing([
      { x: 0.06, le: leading(0.06), te: trailing(0.06), t: 0.02 },
      { x: 0.33, le: leading(0.33), te: trailing(0.33), t: 0.009 },
    ]),
    'hull',
    0,
    0,
    0,
    -0.04,
  );
  both(
    kit,
    wing([
      { x: 0.33, le: leading(0.33), te: trailing(0.33), t: 0.009 },
      { x: 0.44, le: 0.3, te: 0.4, t: 0.006 },
    ]),
    'trim',
    0,
    0,
    0,
    -0.04,
  );
  both(
    kit,
    wing([
      { x: 0.03, le: -0.55, te: -0.34, t: 0.01 },
      { x: 0.2, le: -0.4, te: -0.36, t: 0.004 },
    ]),
    'trim',
  );
  const fin = wing([
    { x: 0, le: 0.08, te: 0.53, t: 0.016 },
    { x: 0.27, le: 0.46, te: 0.54, t: 0.006 },
  ]);
  fin.rotateZ(Math.PI / 2);
  add(fin, 'trim', 0, 0.05);
  add(new THREE.TorusGeometry(0.064, 0.011, 6, 20), 'hot', 0, 0, 0.58);
  add(new THREE.TorusGeometry(0.1, 0.006, 6, 24), 'trim', 0, 0, 0.36);

  const muzzle = guns(kit, 0.045, -0.046, [-0.46, -0.1, 0.02], -0.52, 'hull');

  return {
    engines: [[0, 0, 0.585, 0.058]],
    wingtip: new THREE.Vector3(0.44, -0.02, 0.36),
    strobes: [[0, 0.325, 0.5]],
    muzzle,
  };
}

/**
 * The year's own ship: a short pod for the pilot under a gold-framed canopy, and two slim booms with an engine each,
 * joined by a gold tailplane with a fin on each boom. Its guns sit under its chin.
 */
function comet(kit: Kit): Fittings {
  const { add } = kit;
  add(
    body(
      [
        [0, -0.82],
        [0.03, -0.72],
        [0.065, -0.52],
        [0.095, -0.28],
        [0.105, -0.05],
        [0.1, 0.12],
        [0.08, 0.26],
        [0.04, 0.34],
        [0, 0.36],
      ],
      22,
      1,
      0.9,
    ),
    'hull',
  );
  const canopy = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.062, 0.066, 0.24);
  add(canopy, 'glass', 0, 0.05, -0.3);
  const arch = new THREE.TorusGeometry(1, 0.07, 5, 16, Math.PI);
  arch.scale(0.059, 0.062, 0.059);
  add(arch, 'trim', 0, 0.05, -0.4);
  const boom = body(
    [
      [0, -0.3],
      [0.02, -0.26],
      [0.036, -0.16],
      [0.04, 0.1],
      [0.04, 0.5],
      [0.036, 0.57],
    ],
    16,
    1,
    1,
  );
  both(kit, boom, 'hull', 0.24);
  both(kit, new THREE.TorusGeometry(0.036, 0.008, 6, 16), 'hot', 0.24, 0, 0.57);
  const plan: Station[] = [
    { x: 0.05, le: -0.14, te: 0.15, t: 0.026 },
    { x: 0.24, le: -0.1, te: 0.13, t: 0.02 },
    { x: 0.47, le: -0.02, te: 0.1, t: 0.009 },
  ];
  both(kit, wing(plan, [0.22, 1]), 'hull');
  both(kit, wing(plan, [0, 0.22]), 'trim');
  // The tailplane runs from boom to boom, in gold
  both(
    kit,
    wing([
      { x: 0, le: 0.4, te: 0.52, t: 0.012 },
      { x: 0.24, le: 0.42, te: 0.52, t: 0.012 },
    ]),
    'trim',
    0,
    0.03,
  );
  const fin = wing([
    { x: 0, le: 0.32, te: 0.54, t: 0.012 },
    { x: 0.13, le: 0.44, te: 0.55, t: 0.006 },
  ]);
  fin.rotateZ(Math.PI / 2);
  both(kit, fin, 'trim', 0.24, 0.03);
  const muzzle = guns(kit, 0.055, -0.06, [-0.6, -0.3, 0.018], -0.67, 'hull');
  return {
    engines: [
      [-0.24, 0, 0.575, 0.032],
      [0.24, 0, 0.575, 0.032],
    ],
    wingtip: new THREE.Vector3(0.47, 0, 0.04),
    strobes: [
      [-0.24, 0.165, 0.5],
      [0.24, 0.165, 0.5],
    ],
    muzzle,
  };
}

/**
 * A rocket off a tin toy: a fat round body with a painted nose and a band, a porthole, one big engine, three fins, and a
 * ray gun on a stub either side.
 */
function rocket(kit: Kit): Fittings {
  const { add } = kit;
  add(
    body(
      [
        [0, -0.8],
        [0.05, -0.72],
        [0.11, -0.56],
        [0.155, -0.36],
        [0.175, -0.12],
        [0.175, 0.14],
        [0.16, 0.32],
        [0.13, 0.46],
        [0.1, 0.54],
        [0, 0.55],
      ],
      28,
      1,
      1,
    ),
    'hull',
  );
  // The nose cone is a skin over the tip of the body, in the trim colour
  add(
    body(
      [
        [0, -0.812],
        [0.054, -0.726],
        [0.116, -0.562],
        [0.118, -0.54],
        [0, -0.54],
      ],
      28,
      1,
      1,
    ),
    'trim',
  );
  add(new THREE.TorusGeometry(0.176, 0.013, 6, 28), 'trim', 0, 0, 0.12);
  const porthole = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  porthole.scale(0.06, 0.045, 0.09);
  add(porthole, 'glass', 0, 0.148, -0.3);
  const rim = new THREE.TorusGeometry(1, 0.13, 6, 24);
  rim.rotateX(Math.PI / 2);
  rim.scale(0.062, 0.1, 0.092);
  add(rim, 'trim', 0, 0.149, -0.3);
  add(new THREE.TorusGeometry(0.1, 0.014, 6, 20), 'hot', 0, 0, 0.545);

  const fin = (scale: number) =>
    wing([
      { x: 0.12 * scale, le: 0.04, te: 0.5, t: 0.03 },
      { x: 0.4 * scale, le: 0.334, te: 0.543, t: 0.014 },
    ]);
  const tip = (scale: number) =>
    wing([
      { x: 0.4 * scale, le: 0.334, te: 0.543, t: 0.014 },
      { x: 0.5 * scale, le: 0.44, te: 0.56, t: 0.01 },
    ]);
  both(kit, fin(1), 'hull');
  both(kit, tip(1), 'trim');
  const dorsal = fin(0.72);
  const dorsalTip = tip(0.72);
  [dorsal, dorsalTip].forEach((part) => {
    part.rotateZ(Math.PI / 2);
    add(part, 'trim');
  });

  // The ray guns, on stubs out of the body at its widest
  both(
    kit,
    wing([
      { x: 0.15, le: -0.06, te: 0.08, t: 0.024 },
      { x: 0.25, le: -0.05, te: 0.05, t: 0.016 },
    ]),
    'hull',
  );
  const muzzle = guns(kit, 0.25, 0, [-0.16, 0.12, 0.026], -0.22, 'trim');
  [-0.04, 0.02].forEach((z) => both(kit, new THREE.TorusGeometry(0.027, 0.007, 6, 16), 'dark', 0.25, 0, z));

  return {
    engines: [[0, 0, 0.555, 0.088]],
    wingtip: new THREE.Vector3(0.5, 0, 0.5),
    strobes: [[0, 0.375, 0.5]],
    muzzle,
  };
}

/** A flying saucer: a disc with a glass dome, lamps round its rim, two small engines at the back, and two emitters. */
function saucer(kit: Kit): Fittings {
  const { add } = kit;
  add(
    new THREE.LatheGeometry(
      [
        [0, -0.075],
        [0.2, -0.07],
        [0.4, -0.032],
        [0.5, 0],
        [0.4, 0.036],
        [0.22, 0.062],
        [0, 0.07],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      48,
    ),
    'hull',
  );
  const dome = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(0.17, 0.15, 0.17);
  add(dome, 'glass', 0, 0.055, 0);
  const band = new THREE.TorusGeometry(0.4, 0.014, 6, 48);
  band.rotateX(Math.PI / 2);
  add(band, 'trim', 0, 0.038, 0);
  const collar = new THREE.TorusGeometry(0.18, 0.014, 6, 28);
  collar.rotateX(Math.PI / 2);
  add(collar, 'trim', 0, 0.066, 0);
  add(
    new THREE.LatheGeometry(
      [
        [0, -0.12],
        [0.1, -0.115],
        [0.17, -0.07],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      28,
    ),
    'dark',
  );
  // Lamps round the rim, leaving the back clear for the engines
  for (let n = 0; n < 14; n++) {
    const a = -Math.PI / 2 + ((n + 0.5) / 14) * Math.PI * 2;
    if (Math.sin(a) > 0.8) continue;
    add(new THREE.SphereGeometry(0.011, 8, 6), 'trim', Math.cos(a) * 0.49, 0.004, Math.sin(a) * 0.49);
  }
  const pod = body(
    [
      [0, 0.32],
      [0.03, 0.34],
      [0.04, 0.38],
      [0.04, 0.46],
      [0.034, 0.5],
    ],
    14,
    1,
    1,
  );
  both(kit, pod, 'dark', 0.15);
  both(kit, new THREE.TorusGeometry(0.036, 0.007, 6, 16), 'hot', 0.15, 0, 0.5);

  // Emitters under the rim, either side of the front
  const muzzle = guns(kit, 0.2, -0.026, [-0.47, -0.34, 0.03], -0.49, 'dark');

  return {
    engines: [
      [-0.15, 0, 0.5, 0.034],
      [0.15, 0, 0.5, 0.034],
    ],
    wingtip: new THREE.Vector3(0.5, 0, 0),
    strobes: [[0, 0.215, 0]],
    muzzle,
  };
}

/** A ship built of blocks, for anyone who likes their city in blocks, with a blocky cannon on each wing. */
function brick(kit: Kit): Fittings {
  const { add } = kit;
  // Edges rounded a little, so each block catches the light along them
  const box = (w: number, h: number, d: number) =>
    new RoundedBoxGeometry(w, h, d, 2, Math.min(0.012, w / 4, h / 4, d / 4));
  add(box(0.2, 0.14, 1.06), 'hull', 0, 0, -0.1);
  add(box(0.12, 0.1, 0.18), 'trim', 0, -0.005, -0.72);
  add(box(0.13, 0.08, 0.24), 'glass', 0, 0.105, -0.3);
  add(box(0.05, 0.22, 0.26), 'trim', 0, 0.17, 0.28);
  [-1, 1].forEach((side) => {
    add(box(0.34, 0.05, 0.36), 'hull', side * 0.27, -0.01, 0.2);
    add(box(0.08, 0.075, 0.42), 'trim', side * 0.46, -0.01, 0.2);
    add(box(0.13, 0.13, 0.32), 'dark', side * 0.145, -0.005, 0.44);
    // A square collar round the nozzle, proud of the block's back
    [-1, 1].forEach((edge) => {
      add(box(0.13, 0.022, 0.026), 'hot', side * 0.145, -0.005 + edge * 0.054, 0.612);
      add(box(0.022, 0.086, 0.026), 'hot', side * 0.145 + edge * 0.054, -0.005, 0.612);
    });
    add(box(0.06, 0.04, 0.2), 'hull', side * 0.16, 0, -0.5);
    // A cannon block on the wing's front edge, a square barrel and a collar at its muzzle
    add(box(0.075, 0.07, 0.16), 'hull', side * 0.3, -0.01, -0.03);
    add(box(0.026, 0.026, 0.08), 'dark', side * 0.3, -0.01, -0.15);
    add(box(0.038, 0.038, 0.03), 'dark', side * 0.3, -0.01, -0.195);
  });

  return {
    engines: [
      [-0.145, -0.005, 0.605, 0.052],
      [0.145, -0.005, 0.605, 0.052],
    ],
    wingtip: new THREE.Vector3(0.5, -0.01, 0.38),
    strobes: [[0, 0.29, 0.38]],
    muzzle: new THREE.Vector3(0.3, -0.01, -0.21),
  };
}

const DESIGNS: Record<Design, (kit: Kit) => Fittings> = { interceptor, dart, rocket, saucer, brick, comet };

/** The radius the flame's cone is modelled at. Each engine's flame is scaled from it. */
const FLAME_RADIUS = 0.046;
/** The nozzle the engine glow was tuned on. A wider engine glows wider. */
const TUNED_NOZZLE = 0.05;

/**
 * How far a design reaches to either side, in the model's own units: its parts, its guns among them, and its nav
 * lights. The flight paths are tested to clear the towers by a fixed margin, so every ship has to fit inside it.
 */
export function halfSpan(ship: Design): number {
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const turn = new THREE.Matrix4();
  const fittings = DESIGNS[ship]({
    add(geometry, _finish, x = 0, y = 0, z = 0, rz = 0) {
      geometry.computeBoundingBox();
      part.copy(geometry.boundingBox as THREE.Box3).applyMatrix4(turn.makeRotationZ(rz).setPosition(x, y, z));
      box.union(part);
      geometry.dispose();
    },
  });
  return Math.max(box.max.x, -box.min.x, fittings.wingtip.x + NAV_RADIUS);
}

/** Where a design's right gun fires from, in the scene's units from the ship's centre. The left mirrors it. */
export function muzzleOf(ship: Design): THREE.Vector3 {
  const { muzzle } = DESIGNS[ship]({ add: (geometry) => geometry.dispose() });
  return muzzle.multiplyScalar(SCALE);
}

export interface Fighter {
  /** The ship, facing -Z. Its first child is the fuselage, in the hull colour. */
  group: THREE.Group;
  /** Where the right gun's muzzle is, in the scene's units from the ship's centre. The left mirrors it. */
  readonly gun: THREE.Vector3;
  /** Swaps the ship for another design, where it is, in the same colours. */
  setModel(ship: Design): void;
  paint(colours: Colours): void;
  /** What the metal and glass reflect. */
  reflect(map: THREE.Texture): void;
  /**
   * The exhaust and lights for this frame. Throttle is 0 standing still, 1 at cruise, and up to 2.7 on full boost.
   * `boost` is whether boost is lit: the turbines and the metal round them heat up while it is, with a flash as it lights,
   * and cool more slowly after.
   */
  update(time: number, dt: number, throttle: number, boost?: boolean): void;
  /** Lights both muzzles for a moment. */
  muzzle(): void;
  /** Writes where the wingtips are in the scene into `left` and `right`. */
  wingtips(left: THREE.Vector3, right: THREE.Vector3): void;
  /** Draws the ship see-through, for a ghost: 1 is solid. */
  fade(opacity: number): void;
}

/** A ship of the given design, nose towards -Z. The designs share their materials, so colours carry from one to the next. */
export function buildFighter(ship: Design = DEFAULT_SHIP): Fighter {
  /** 1 lays the seams out in rings and spokes, for a round ship, and 0 in a grid along and across it. */
  const round = { value: 0 };
  const finishes: Record<Finish, THREE.MeshStandardMaterial> = {
    hull: plated(new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.34, envMapIntensity: 1.15 }), round),
    trim: plated(new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.4, emissiveIntensity: 0.22 }), round),
    dark: plated(new THREE.MeshStandardMaterial({ color: 0x1b2027, metalness: 0.7, roughness: 0.42 }), round),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0b1724,
      metalness: 0.95,
      roughness: 0.06,
      envMapIntensity: 2.2,
      emissive: 0x0b2a3a,
      emissiveIntensity: 0.6,
    }),
    // Dark metal until boost heats it, when its own light is turned up from nothing
    hot: new THREE.MeshStandardMaterial({
      name: 'hot',
      color: 0x1b2027,
      metalness: 0.7,
      roughness: 0.42,
      emissiveIntensity: 0,
    }),
  };
  // The turbine seen down each nozzle, lit from inside
  const nozzle = new THREE.MeshBasicMaterial({ color: NOZZLE_COLOUR, map: turbineTexture() });
  const lights = {
    port: new THREE.MeshBasicMaterial({ color: PORT }),
    starboard: new THREE.MeshBasicMaterial({ color: STARBOARD }),
    strobe: new THREE.MeshBasicMaterial({ color: STROBE }),
  };
  const blue = glowTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(120,205,255,.75)'],
    [1, 'rgba(30,110,255,0)'],
  ]);
  const red = glowTexture([
    [0, 'rgba(255,240,230,1)'],
    [0.25, 'rgba(255,90,60,.8)'],
    [1, 'rgba(255,30,10,0)'],
  ]);
  // The exhaust, one cone per engine, sharing one set of uniforms
  const flameUniforms = { uThrottle: { value: 1 }, uTime: { value: 0 }, uSeed: { value: 0 }, uHeat: { value: 0 } };

  const group = new THREE.Group();
  group.scale.setScalar(SCALE);
  group.visible = false;

  /** What changes from one design to the next and is read each frame. */
  let glow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  let muzzles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  let strobes: THREE.Mesh[] = [];
  let wingtip = WINGTIP;
  /** How much wider than the tuned nozzle this design's engines are. */
  let breadth = 1;
  let muzzleLeft = 0;
  const gun = new THREE.Vector3();
  /** How hot the engines are, from 0 cold to 1 after a few tenths of a second of boost, and the flash as boost lights. */
  let heat = 0;
  let flare = 0;
  let boosted = false;

  const place = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    group.add(mesh);
    return mesh;
  };

  function assemble(next: Design): void {
    // The glow textures and the materials are kept. Everything shaped for the old design goes.
    for (const child of [...group.children]) {
      group.remove(child);
      const { geometry, material } = child as THREE.Mesh;
      geometry.dispose();
      if (material instanceof THREE.ShaderMaterial || material instanceof THREE.PointsMaterial) material.dispose();
    }

    const fittings = DESIGNS[next]({
      // Moved into place in the geometry itself, so the seams can be laid out by where each point is on the ship
      add: (geometry, finish, x = 0, y = 0, z = 0, rz = 0) => {
        geometry.rotateZ(rz);
        geometry.translate(x, y, z);
        place(geometry, finishes[finish]);
      },
    });
    round.value = next === 'saucer' ? 1 : 0;
    wingtip = fittings.wingtip;
    gun.copy(fittings.muzzle).multiplyScalar(SCALE);
    breadth =
      fittings.engines.reduce((sum, [, , , radius]) => sum + radius, 0) / fittings.engines.length / TUNED_NOZZLE;

    const glowAt: number[] = [];
    fittings.engines.forEach(([x, y, z, radius], n) => {
      place(new THREE.CircleGeometry(radius, 20), nozzle, x, y, z - 0.005);
      const cone = new THREE.ConeGeometry(FLAME_RADIUS, 1, 14, 1, true);
      cone.rotateX(Math.PI / 2);
      cone.translate(0, 0, 0.5);
      const flame = place(
        cone,
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: { ...flameUniforms, uSeed: { value: (n * 2 - 1) * 7.3 } },
          vertexShader: glsl.FLAME_VERTEX,
          fragmentShader: glsl.FLAME_FRAGMENT,
        }),
        x,
        y,
        z + 0.004,
      );
      // Wider for a wider nozzle, and a little longer
      flame.scale.set(radius / TUNED_NOZZLE, radius / TUNED_NOZZLE, Math.sqrt(radius / TUNED_NOZZLE));
      flame.renderOrder = 4;
      glowAt.push(x, y, z + 0.03);
    });
    glow = glowPoints(glowAt, blue, 0.26);
    group.add(glow);

    const lamp = () => new THREE.SphereGeometry(NAV_RADIUS, 8, 6);
    place(lamp(), lights.port, -wingtip.x, wingtip.y, wingtip.z);
    place(lamp(), lights.starboard, wingtip.x, wingtip.y, wingtip.z);
    strobes = fittings.strobes.map(([x, y, z]) => place(lamp(), lights.strobe, x, y, z));

    const { x, y, z } = fittings.muzzle;
    muzzles = glowPoints([-x, y, z - 0.01, x, y, z - 0.01], red, 0.7);
    muzzles.material.color.copy(MUZZLE_COLOUR);
    muzzles.visible = false;
    group.add(muzzles);
  }
  assemble(ship);

  return {
    group,
    gun,
    setModel(next) {
      assemble(next);
    },
    paint(colours) {
      finishes.hull.color.set(colours.hull);
      finishes.trim.color.set(colours.trim);
      finishes.trim.emissive.set(colours.trim);
    },
    reflect(map) {
      Object.values(finishes).forEach((material) => {
        material.envMap = map;
        material.needsUpdate = true;
      });
    },
    update(time, dt, throttle, boost = false) {
      if (boost && !boosted) flare = 1;
      boosted = boost;
      // Quick to heat and slow to cool, as metal is
      heat += ((boost ? 1 : 0) - heat) * (1 - Math.exp(-(boost ? 6 : 1.3) * dt));
      flare *= Math.exp(-7 * dt);
      // Dull red as the metal starts to heat, orange-white once hot, and past white in the flash
      finishes.hot.emissive.copy(EMBER).lerp(WHITE_HOT, heat * heat);
      finishes.hot.emissiveIntensity = heat * 2.4 + flare * 1.6;
      nozzle.color
        .copy(NOZZLE_COLOUR)
        .lerp(TURBINE_HOT, heat)
        .multiplyScalar(1 + flare * 0.8);
      flameUniforms.uThrottle.value = throttle;
      flameUniforms.uTime.value = time;
      flameUniforms.uHeat.value = heat;
      glow.material.size = (0.14 + 0.05 * Math.min(throttle, 2.7) + 0.05 * heat + 0.08 * flare) * breadth * frameScale;
      glow.material.color.setRGB(1 + 0.25 * heat, 1 + 0.05 * heat, 1 - 0.15 * heat);
      const flashing = time % STROBE_EVERY < STROBE_SECONDS;
      strobes.forEach((strobe) => {
        strobe.visible = flashing;
      });
      muzzleLeft = Math.max(0, muzzleLeft - dt);
      muzzles.visible = muzzleLeft > 0;
      muzzles.material.size = (0.22 + 0.32 * (muzzleLeft / MUZZLE_SECONDS)) * frameScale;
    },
    muzzle() {
      muzzleLeft = MUZZLE_SECONDS;
    },
    wingtips(left, right) {
      group.updateMatrixWorld();
      left.set(-wingtip.x, wingtip.y, wingtip.z).applyMatrix4(group.matrixWorld);
      right.copy(wingtip).applyMatrix4(group.matrixWorld);
    },
    fade(opacity) {
      // The materials outlast a change of design, so the ship stays faded whichever it becomes
      for (const material of [...Object.values(finishes), nozzle, ...Object.values(lights)]) {
        material.transparent = opacity < 1;
        material.opacity = opacity;
        material.depthWrite = opacity >= 1;
        material.needsUpdate = true;
      }
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
  private readonly sparkPaint: THREE.PointsMaterial;
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
    this.sparkPaint = new THREE.PointsMaterial({
      size: SPARK_SIZE,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.sparks, this.sparkPaint);
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

  /**
   * Whether the guns fired, because they cool down between shots. A bolt leaves each muzzle: `gun` is the right one's,
   * from the ship's centre, as `Fighter.gun` gives it. Bolts fired with a target curve towards it.
   */
  fire(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    orientation: THREE.Quaternion,
    gun: THREE.Vector3,
    target: THREE.Vector3 | null = null,
  ): boolean {
    if (this.cooldown > 0 || this.bolts.length >= MAX_BOLTS - 1) return false;
    this.cooldown = COOLDOWN;
    [-1, 1].forEach((side) => {
      const pos = new THREE.Vector3(side * gun.x, gun.y, gun.z).applyQuaternion(orientation).add(origin);
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
    this.sparkPaint.size = SPARK_SIZE * frameScale;

    for (let i = 0; i < IMPACTS; i++) this.impactAge[i] = Math.min(IMPACT_SECONDS, this.impactAge[i] + dt);
    this.impacts.attributes.position.needsUpdate = true;
    this.impacts.attributes.aAge.needsUpdate = true;
  }
}
