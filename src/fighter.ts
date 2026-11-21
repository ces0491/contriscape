import * as THREE from 'three';
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
/** The radius of a nav light or a strobe, and of a gun barrel at its thicker end. */
const NAV_RADIUS = 0.018;
const BARREL_RADIUS = 0.014;

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

/**
 * How big the frame being drawn is beside the canvas it ends up on: 1, or a fraction in a look drawn at an old screen's
 * resolution. three.js sizes its own points by the canvas, whatever they are drawn into, so each size set here is
 * multiplied by this.
 */
let frameScale = 1;
export function setFrameScale(scale: number): void {
  frameScale = scale;
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
type Finish = 'hull' | 'trim' | 'dark' | 'glass';

/** What a design is built with. `add` places one part, turned by `rz` about the ship's length. */
interface Kit {
  add(geometry: THREE.BufferGeometry, finish: Finish, x?: number, y?: number, z?: number, rz?: number): void;
}

/** What a design leaves to be fitted the same way on every ship: its engines, lights and guns. */
interface Fittings {
  /** Each nozzle: where it is, and its radius. The flame, the glow and the lit disc are sized from the radius. */
  engines: [x: number, y: number, z: number, radius: number][];
  /** The right wingtip, where a nav light sits and a vapour trail starts. The left mirrors it. */
  wingtip: THREE.Vector3;
  strobes: [x: number, y: number, z: number][];
  /** How far along the ship the gun barrels are centred. The bolts leave from the same place whatever the ship. */
  gunZ: number;
}

/** A swept delta with twin engines and canted fins, about 0.83 wide once scaled. */
function interceptor({ add }: Kit): Fittings {
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
    'hull',
  );
  const canopy = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.072, 0.07, 0.24);
  add(canopy, 'glass', 0, 0.05, -0.3);

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
      'hull',
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
      'trim',
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
      'hull',
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
    add(fin, 'trim');

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
    add(nacelle, 'dark', side * ENGINE_X, -0.01);
    add(new THREE.TorusGeometry(0.056, 0.01, 6, 20), 'dark', side * ENGINE_X, -0.01, NOZZLE_Z);
  });

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
    gunZ: 0.05,
  };
}

/** A needle with one engine, small canards by the nose, cropped wings and a single tall fin. */
function dart({ add }: Kit): Fittings {
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
      18,
      1,
      0.8,
    ),
    'hull',
  );
  const canopy = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.055, 0.062, 0.2);
  add(canopy, 'glass', 0, 0.045, -0.36);

  [-1, 1].forEach((w) => {
    add(
      plate(
        [
          [0.07 * w, -0.04],
          [0.44 * w, 0.3],
          [0.44 * w, 0.4],
          [0.07 * w, 0.46],
        ],
        0.02,
      ),
      'hull',
      0,
      0,
      0,
      w * -0.04,
    );
    add(
      plate(
        [
          [0.33 * w, 0.2],
          [0.44 * w, 0.3],
          [0.44 * w, 0.4],
          [0.33 * w, 0.42],
        ],
        0.026,
      ),
      'trim',
      0,
      0.001,
      0,
      w * -0.04,
    );
    add(
      plate(
        [
          [0.04 * w, -0.54],
          [0.2 * w, -0.4],
          [0.2 * w, -0.36],
          [0.04 * w, -0.34],
        ],
        0.014,
      ),
      'trim',
    );
  });
  const fin = plate(
    [
      [0, 0.1],
      [0.27, 0.46],
      [0.27, 0.54],
      [0, 0.52],
    ],
    0.016,
  );
  fin.rotateZ(Math.PI / 2);
  fin.translate(0, 0.05, 0);
  add(fin, 'trim');
  add(new THREE.TorusGeometry(0.064, 0.011, 6, 20), 'dark', 0, 0, 0.58);

  return {
    engines: [[0, 0, 0.585, 0.058]],
    wingtip: new THREE.Vector3(0.44, -0.02, 0.36),
    strobes: [[0, 0.325, 0.5]],
    gunZ: 0.2,
  };
}

/** The year's own ship: a slim hull with crescent wings, and a ring round its tail in the trim colour on three vanes. */
function comet({ add }: Kit): Fittings {
  add(
    body(
      [
        [0, -0.9],
        [0.025, -0.8],
        [0.05, -0.62],
        [0.075, -0.4],
        [0.09, -0.15],
        [0.095, 0.1],
        [0.09, 0.32],
        [0.075, 0.48],
        [0.05, 0.56],
        [0, 0.57],
      ],
      20,
      1,
      0.85,
    ),
    'hull',
  );
  const canopy = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.058, 0.06, 0.26);
  add(canopy, 'glass', 0, 0.045, -0.34);

  [-1, 1].forEach((w) => {
    add(
      plate(
        [
          [0.08 * w, -0.1],
          [0.3 * w, 0.04],
          [0.46 * w, 0.3],
          [0.44 * w, 0.36],
          [0.3 * w, 0.22],
          [0.08 * w, 0.3],
        ],
        0.02,
      ),
      'hull',
      0,
      0,
      0,
      w * -0.05,
    );
    // The leading edge, in the trim colour
    add(
      plate(
        [
          [0.08 * w, -0.1],
          [0.3 * w, 0.04],
          [0.46 * w, 0.3],
          [0.45 * w, 0.33],
          [0.29 * w, 0.09],
          [0.08 * w, -0.05],
        ],
        0.026,
      ),
      'trim',
      0,
      0.001,
      0,
      w * -0.05,
    );
  });
  add(new THREE.TorusGeometry(0.2, 0.018, 8, 40), 'trim', 0, 0, 0.42);
  for (let vane = 0; vane < 3; vane++) {
    add(
      plate(
        [
          [0.06, 0.36],
          [0.2, 0.39],
          [0.2, 0.45],
          [0.06, 0.47],
        ],
        0.012,
      ),
      'dark',
      0,
      0,
      0,
      Math.PI / 2 + (vane * Math.PI * 2) / 3,
    );
  }
  add(new THREE.TorusGeometry(0.052, 0.01, 6, 20), 'dark', 0, 0, 0.565);

  return {
    engines: [[0, 0, 0.57, 0.048]],
    wingtip: new THREE.Vector3(0.455, -0.02, 0.33),
    strobes: [[0, 0.2, 0.42]],
    gunZ: 0.1,
  };
}

/** A rocket off a tin toy: a fat round body with a painted nose and a band, a porthole, one big engine and three fins. */
function rocket({ add }: Kit): Fittings {
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
      24,
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
      24,
      1,
      1,
    ),
    'trim',
  );
  add(new THREE.TorusGeometry(0.176, 0.013, 6, 28), 'trim', 0, 0, 0.12);
  const porthole = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  porthole.scale(0.06, 0.045, 0.09);
  add(porthole, 'glass', 0, 0.148, -0.3);
  add(new THREE.TorusGeometry(0.1, 0.014, 6, 20), 'dark', 0, 0, 0.545);

  const outline: [number, number][] = [
    [0.14, 0.06],
    [0.5, 0.44],
    [0.5, 0.56],
    [0.14, 0.5],
  ];
  [-1, 1].forEach((w) => {
    add(
      plate(
        outline.map(([x, z]) => [x * w, z]),
        0.022,
      ),
      'hull',
    );
    add(
      plate(
        [
          [0.4 * w, 0.334],
          [0.5 * w, 0.44],
          [0.5 * w, 0.56],
          [0.4 * w, 0.543],
        ],
        0.028,
      ),
      'trim',
      0,
      0.001,
    );
  });
  const dorsal = plate(
    outline.map(([x, z]) => [x * 0.72, z]),
    0.022,
  );
  dorsal.rotateZ(Math.PI / 2);
  add(dorsal, 'trim');

  return {
    engines: [[0, 0, 0.555, 0.088]],
    wingtip: new THREE.Vector3(0.5, 0, 0.5),
    strobes: [[0, 0.375, 0.5]],
    gunZ: 0.36,
  };
}

/** A flying saucer: a disc with a glass dome, a band of trim round its top and two small engines at the back. */
function saucer({ add }: Kit): Fittings {
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
      40,
    ),
    'hull',
  );
  const dome = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(0.17, 0.15, 0.17);
  add(dome, 'glass', 0, 0.055, 0);
  const band = new THREE.TorusGeometry(0.4, 0.014, 6, 40);
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
      24,
    ),
    'dark',
  );
  [-1, 1].forEach((side) => {
    const pod = new THREE.CylinderGeometry(0.04, 0.034, 0.16, 12);
    pod.rotateX(Math.PI / 2);
    add(pod, 'dark', side * 0.15, 0, 0.42);
  });

  return {
    engines: [
      [-0.15, 0, 0.5, 0.034],
      [0.15, 0, 0.5, 0.034],
    ],
    wingtip: new THREE.Vector3(0.5, 0, 0),
    strobes: [[0, 0.215, 0]],
    gunZ: -0.06,
  };
}

/** A ship built of boxes, for anyone who likes their city in blocks. */
function brick({ add }: Kit): Fittings {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  add(box(0.2, 0.14, 1.06), 'hull', 0, 0, -0.1);
  add(box(0.12, 0.1, 0.18), 'trim', 0, -0.005, -0.72);
  add(box(0.13, 0.08, 0.24), 'glass', 0, 0.105, -0.3);
  add(box(0.05, 0.22, 0.26), 'trim', 0, 0.17, 0.28);
  [-1, 1].forEach((side) => {
    add(box(0.34, 0.05, 0.36), 'hull', side * 0.27, -0.01, 0.2);
    add(box(0.08, 0.075, 0.42), 'trim', side * 0.46, -0.01, 0.2);
    add(box(0.13, 0.13, 0.32), 'dark', side * 0.145, -0.005, 0.44);
    add(box(0.06, 0.04, 0.2), 'hull', side * 0.16, 0, -0.5);
  });

  return {
    engines: [
      [-0.145, -0.005, 0.605, 0.052],
      [0.145, -0.005, 0.605, 0.052],
    ],
    wingtip: new THREE.Vector3(0.5, -0.01, 0.38),
    strobes: [[0, 0.29, 0.38]],
    gunZ: 0.12,
  };
}

const DESIGNS: Record<Design, (kit: Kit) => Fittings> = { interceptor, dart, rocket, saucer, brick, comet };

/** The radius the flame's cone is modelled at. Each engine's flame is scaled from it. */
const FLAME_RADIUS = 0.046;
/** The nozzle the engine glow was tuned on. A wider engine glows wider. */
const TUNED_NOZZLE = 0.05;
const BARREL_LENGTH = 0.36;

/**
 * How far a design reaches to either side, in the model's own units: its parts, its nav lights and its gun barrels.
 * The flight paths are tested to clear the towers by a fixed margin, so every ship has to fit inside it.
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
  return Math.max(box.max.x, -box.min.x, fittings.wingtip.x + NAV_RADIUS, GUN.x / SCALE + BARREL_RADIUS);
}

export interface Fighter {
  /** The ship, facing -Z. Its first child is the fuselage, in the hull colour. */
  group: THREE.Group;
  /** Swaps the ship for another design, where it is, in the same colours. */
  setModel(ship: Design): void;
  paint(colours: Colours): void;
  /** What the metal and glass reflect. */
  reflect(map: THREE.Texture): void;
  /** The exhaust and lights for this frame. Throttle is 0 standing still, 1 at cruise, and up to 2.7 on full boost. */
  update(time: number, dt: number, throttle: number): void;
  /** Lights both muzzles for a moment. */
  muzzle(): void;
  /** Writes where the wingtips are in the scene into `left` and `right`. */
  wingtips(left: THREE.Vector3, right: THREE.Vector3): void;
  /** Draws the ship see-through, for a ghost: 1 is solid. */
  fade(opacity: number): void;
}

/** A ship of the given design, nose towards -Z. The designs share their materials, so colours carry from one to the next. */
export function buildFighter(ship: Design = DEFAULT_SHIP): Fighter {
  const finishes: Record<Finish, THREE.MeshStandardMaterial> = {
    hull: new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.34, envMapIntensity: 1.15 }),
    trim: new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.4, emissiveIntensity: 0.22 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b2027, metalness: 0.7, roughness: 0.42 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0b1724,
      metalness: 0.95,
      roughness: 0.06,
      envMapIntensity: 2.2,
      emissive: 0x0b2a3a,
      emissiveIntensity: 0.6,
    }),
  };
  const nozzle = new THREE.MeshBasicMaterial({ color: NOZZLE_COLOUR });
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
  const flameUniforms = { uThrottle: { value: 1 }, uTime: { value: 0 }, uSeed: { value: 0 } };

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
      add: (geometry, finish, x, y, z, rz) => void place(geometry, finishes[finish], x, y, z, rz),
    });
    wingtip = fittings.wingtip;
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

    const gunX = GUN.x / SCALE;
    [-1, 1].forEach((side) => {
      const barrel = new THREE.CylinderGeometry(0.011, BARREL_RADIUS, BARREL_LENGTH, 8);
      barrel.rotateX(Math.PI / 2);
      place(barrel, finishes.dark, side * gunX, -0.012, fittings.gunZ);
    });
    const tip = fittings.gunZ - BARREL_LENGTH / 2 - 0.01;
    muzzles = glowPoints([-gunX, -0.012, tip, gunX, -0.012, tip], red, 0.7);
    muzzles.material.color.copy(MUZZLE_COLOUR);
    muzzles.visible = false;
    group.add(muzzles);
  }
  assemble(ship);

  return {
    group,
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
    update(time, dt, throttle) {
      flameUniforms.uThrottle.value = throttle;
      flameUniforms.uTime.value = time;
      glow.material.size = (0.14 + 0.05 * Math.min(throttle, 2.7)) * breadth * frameScale;
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
    this.sparkPaint.size = SPARK_SIZE * frameScale;

    for (let i = 0; i < IMPACTS; i++) this.impactAge[i] = Math.min(IMPACT_SECONDS, this.impactAge[i] + dt);
    this.impacts.attributes.position.needsUpdate = true;
    this.impacts.attributes.aAge.needsUpdate = true;
  }
}
