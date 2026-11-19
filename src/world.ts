import * as THREE from 'three';
import { formatCount, MONTHS, type Calendar } from './calendar';
import type { TowerPalette } from './colours';
import { LIGHT_SLOTS } from './lights';
import { CELL, DEPTH, PLINTH, ROAD, TOWER, WEEKS, WIDTH, type CityMap } from './map';
import { RISE } from './routes';
import * as glsl from './shaders';
import { dress, LOOKS, type Look, type Skin } from './skins';

const BEACONS = 12;
const LANES = 420;
const DUST = 240;
const WARP_LINES = 1500;
const STARS = 1600;
const METEORS = 3;
/** Points along each shooting star, head first. */
const METEOR_POINTS = 18;
const PLANET_RADIUS = 330;
const RING_INNER = 430;
const RING_OUTER = 720;
/** Lamps stand this far in from each kerb, one a cell along. */
const KERB = 0.7;
const FACE = '"Mona Sans","Segoe UI",system-ui,sans-serif';
const MONO = '"JetBrains Mono",Consolas,monospace';

export const SETTLED_OFFSET = RISE * 4;

export type Shared = {
  uPlay: { value: number };
  uRise: { value: number };
  uMin: { value: number };
  uMax: { value: number };
  uDim: { value: number };
  uTime: { value: number };
  uFog: { value: THREE.Color };
  uFogD: { value: number };
  uRamp: { value: THREE.Color[] };
  uWindow: { value: THREE.Color };
  uHover: { value: number };
  uHit: { value: number };
  uHitGlow: { value: number };
  uPx: { value: number };
  uWarp: { value: number };
  /** Flashes lighting the towers and street: position and reach, then colour, and how many are lit. See `lights.ts`. */
  uLightPos: { value: THREE.Vector4[] };
  uLightCol: { value: THREE.Vector3[] };
  uLights: { value: number };
};

export interface World {
  scene: THREE.Scene;
  towers: THREE.InstancedMesh;
  shared: Shared;
  dust: THREE.LineSegments;
  dustVelocity: THREE.Vector3;
  warpLines: THREE.LineSegments;
  /** Sky, stars and planet stay at the horizon wherever the camera goes. */
  followCamera(camera: THREE.Camera): void;
  paintTowers(palette: TowerPalette): void;
  /** Redraws the city in another look. */
  setSkin(skin: Skin): void;
  /** Drops the sky's finer detail and the towers' shadows, for a slow GPU. */
  simplify(): void;
  /** Stops the shooting stars, for a visitor who asks for reduced motion. */
  calm(): void;
}

/** The parts of the scene that change with the look, gathered as the scene is built. */
interface Skinned {
  /** Shaders that carry a second look. */
  shaders: THREE.ShaderMaterial[];
  /** Small lights, added to the view by night and drawn over it by day. */
  lights: THREE.ShaderMaterial[];
  /** What only the night scene has: the planet, the shooting stars, the street lamps and the wet street's reflection. */
  night: THREE.Object3D[];
  /** What any dark sky has: the stars. */
  dark: THREE.Object3D[];
  /** The ground, which the night sees through to the reflection and the other scenes don't. */
  ground: THREE.ShaderMaterial | null;
  /** The towers' shadows, which only a sun throws. */
  shadows: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
}

function seededRandom(text: string): () => number {
  let state = [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lineGeometry(count: number, point: () => number[]): THREE.BufferGeometry {
  const positions = new Float32Array(count * 6);
  const ends = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const p = point();
    positions.set(p, i * 6);
    positions.set(p, i * 6 + 3);
    ends[i * 2 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  return geometry;
}

function addTowers(scene: THREE.Scene, map: CityMap, shared: Shared, skinned: Skinned): THREE.InstancedMesh {
  const { cal, cx, cz } = map;
  const { days, counts } = cal;
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const aDay = new Float32Array(days);
  const aMag = new Float32Array(days);
  const aSeed = new Float32Array(days);
  const material = (mirror: number, side: THREE.Side) =>
    new THREE.ShaderMaterial({
      vertexShader: glsl.TOWER_VERTEX,
      fragmentShader: glsl.TOWER_FRAGMENT,
      side,
      uniforms: { ...shared, uMirror: { value: mirror } },
    });
  const towers = new THREE.InstancedMesh(box, material(1, THREE.FrontSide), days);
  const placed = new THREE.Matrix4();
  for (let i = 0; i < days; i++) {
    placed.makeScale(TOWER, map.towerHeight(counts[i]), TOWER);
    placed.setPosition(cx[i], PLINTH, cz[i]);
    towers.setMatrixAt(i, placed);
    aDay[i] = i;
    aMag[i] = map.share(counts[i]);
    aSeed[i] = (i * 0.6180339887) % 1;
  }
  box.setAttribute('aDay', new THREE.InstancedBufferAttribute(aDay, 1));
  box.setAttribute('aMag', new THREE.InstancedBufferAttribute(aMag, 1));
  box.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  towers.frustumCulled = false;
  scene.add(towers);

  // The wet-street reflection: the same towers, flipped below a translucent ground
  const reflection = new THREE.InstancedMesh(box, material(-1, THREE.BackSide), days);
  reflection.instanceMatrix = towers.instanceMatrix;
  reflection.frustumCulled = false;
  scene.add(reflection);
  skinned.shaders.push(towers.material as THREE.ShaderMaterial);
  skinned.night.push(reflection);

  // The shadows are the towers again, pressed flat along the sun's rays and painted as shaded ground. They are drawn
  // after the ground and the slabs, and a hair nearer than the slab they lie on.
  const shadows = new THREE.InstancedMesh(
    box,
    new THREE.ShaderMaterial({
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: {
        uPlay: shared.uPlay,
        uRise: shared.uRise,
        uMax: shared.uMax,
        uFog: shared.uFog,
        uFogD: shared.uFogD,
        uCity: { value: new THREE.Vector2(WIDTH, map.depth) },
        uShade: { value: 0 },
      },
      vertexShader: glsl.SHADOW_VERTEX,
      fragmentShader: glsl.SHADOW_FRAGMENT,
    }),
    days,
  );
  shadows.instanceMatrix = towers.instanceMatrix;
  shadows.frustumCulled = false;
  shadows.renderOrder = 1.5;
  shadows.visible = false;
  scene.add(shadows);
  skinned.shadows = shadows;
  skinned.shaders.push(shadows.material);
  return towers;
}

function addGround(scene: THREE.Scene, map: CityMap, shared: Shared, skinned: Skinned): void {
  const fogUniforms = { uFog: shared.uFog, uFogD: shared.uFogD };
  const plinth = new THREE.ShaderMaterial({
    vertexShader: glsl.SOLID_VERTEX,
    fragmentShader: glsl.SOLID_FRAGMENT,
    uniforms: fogUniforms,
  });
  const groundUniforms = {
    ...fogUniforms,
    uCity: { value: new THREE.Vector2(WIDTH, map.depth) },
    uRamp: shared.uRamp,
    uLightPos: shared.uLightPos,
    uLightCol: shared.uLightCol,
    uLights: shared.uLights,
  };
  const slab = new THREE.BoxGeometry(1, 1, 1);
  map.cal.years.forEach((y) => {
    const mesh = new THREE.Mesh(slab, plinth);
    mesh.scale.set(WIDTH + 1, PLINTH, DEPTH + 1);
    mesh.position.set(WIDTH / 2, PLINTH / 2, map.blockZ(y) + DEPTH / 2);
    scene.add(mesh);
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 7000),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: glsl.GROUND_VERTEX,
      fragmentShader: glsl.GROUND_FRAGMENT,
      uniforms: groundUniforms,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = 1;
  scene.add(ground);
  skinned.shaders.push(plinth, ground.material);
  skinned.ground = ground.material;
}

/** Two rows of lamps along every street between the year blocks, and along the outer edges of the first and last. */
function addLamps(scene: THREE.Scene, map: CityMap, shared: Shared, skinned: Skinned): void {
  const { years } = map.cal;
  // The street north of each block, and the one south of the oldest
  const streets = [...years.map((y) => map.blockZ(y) - ROAD / 2), map.depth + ROAD / 2];
  const along = Math.ceil(WIDTH / CELL) + 1;
  const positions = new Float32Array(streets.length * along * 2 * 3);
  let n = 0;
  streets.forEach((z) => {
    for (let k = 0; k < along; k++) {
      for (const side of [-1, 1]) {
        positions.set([k * CELL, 0.12, z + side * (ROAD / 2 - KERB)], n * 3);
        n++;
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lamps = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPx: shared.uPx },
      vertexShader: glsl.LAMP_VERTEX,
      fragmentShader: glsl.LAMP_FRAGMENT,
    }),
  );
  lamps.frustumCulled = false;
  lamps.renderOrder = 2;
  scene.add(lamps);
  skinned.night.push(lamps);
}

/** Stars across the sky: mostly faint and small, a few bright, in blue-white, white, yellow and orange. */
function addStars(shared: Shared, random: () => number): THREE.Points {
  const positions = new Float32Array(STARS * 3);
  const sizes = new Float32Array(STARS);
  const phases = new Float32Array(STARS);
  const tints = new Float32Array(STARS * 3);
  const palette: [number, number, number][] = [
    [0.75, 0.85, 1],
    [0.95, 0.96, 1],
    [1, 0.93, 0.78],
    [1, 0.78, 0.6],
  ];
  for (let i = 0; i < STARS; i++) {
    const a = random() * Math.PI * 2;
    const h = 0.03 + random() * 0.97;
    const r = Math.sqrt(1 - h * h);
    positions.set([Math.cos(a) * r * 2500, h * 2500, Math.sin(a) * r * 2500], i * 3);
    // Most stars are faint: brightness falls away steeply
    const bright = Math.pow(random(), 6);
    sizes[i] = 1.1 + bright * 2.6;
    phases[i] = random();
    const tint = palette[Math.floor(random() * palette.length)];
    const level = 0.32 + bright * 0.9;
    tints.set(
      tint.map((v) => v * level),
      i * 3,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: shared.uTime, uPx: shared.uPx },
      vertexShader: glsl.STAR_VERTEX,
      fragmentShader: glsl.STAR_FRAGMENT,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  return stars;
}

/** A few shooting stars, each crossing its own patch of sky every so often. */
function addMeteors(shared: Shared, random: () => number): THREE.Points {
  const count = METEORS * METEOR_POINTS;
  const starts = new Float32Array(count * 3);
  const ends = new Float32Array(count * 3);
  const lags = new Float32Array(count);
  const periods = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let m = 0; m < METEORS; m++) {
    const heading = random() * Math.PI * 2;
    const height = 0.35 + random() * 0.45;
    const start = new THREE.Vector3(Math.cos(heading), height, Math.sin(heading)).normalize();
    const across = new THREE.Vector3(-Math.sin(heading), 0, Math.cos(heading));
    const end = start
      .clone()
      .addScaledVector(across, (random() < 0.5 ? -1 : 1) * (0.18 + random() * 0.12))
      .add(new THREE.Vector3(0, -0.12 - random() * 0.1, 0))
      .normalize();
    const period = 11 + random() * 14;
    const phase = random() * period;
    for (let k = 0; k < METEOR_POINTS; k++) {
      const i = m * METEOR_POINTS + k;
      start.toArray(starts, i * 3);
      end.toArray(ends, i * 3);
      lags[i] = k / (METEOR_POINTS - 1);
      periods[i] = period;
      phases[i] = phase;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(starts, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 3));
  geometry.setAttribute('aLag', new THREE.BufferAttribute(lags, 1));
  geometry.setAttribute('aPeriod', new THREE.BufferAttribute(periods, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const meteors = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: shared.uTime, uPx: shared.uPx },
      vertexShader: glsl.METEOR_VERTEX,
      fragmentShader: glsl.METEOR_FRAGMENT,
    }),
  );
  meteors.frustumCulled = false;
  meteors.renderOrder = -8.9;
  return meteors;
}

/** The gas giant over the city, with its rings tilted across it. */
function addPlanet(): THREE.Mesh {
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS, 64, 40),
    new THREE.ShaderMaterial({ vertexShader: glsl.PLANET_VERTEX, fragmentShader: glsl.PLANET_FRAGMENT }),
  );
  planet.renderOrder = -9.5;
  const rings = new THREE.Mesh(
    new THREE.RingGeometry(RING_INNER, RING_OUTER, 160, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uInner: { value: RING_INNER }, uOuter: { value: RING_OUTER }, uPlanet: { value: PLANET_RADIUS } },
      vertexShader: glsl.RING_VERTEX,
      fragmentShader: glsl.RING_FRAGMENT,
    }),
  );
  rings.rotation.set(-1.32, 0.22, 0.38);
  rings.renderOrder = -9.4;
  planet.add(rings);
  return planet;
}

function addBeacons(scene: THREE.Scene, map: CityMap, shared: Shared, skinned: Skinned): void {
  const { counts } = map.cal;
  const busiest = counts
    .map((c, i) => [c, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, BEACONS)
    .filter(([c]) => c > 0);
  const positions = new Float32Array(busiest.length * 3);
  const days = new Float32Array(busiest.length);
  const phases = new Float32Array(busiest.length);
  busiest.forEach(([, i], k) => {
    positions.set([map.cx[i], map.top[i] + 0.2, map.cz[i]], k * 3);
    days[k] = i;
    phases[k] = k * 1.9;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDay', new THREE.BufferAttribute(days, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const beacons = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: shared,
      vertexShader: glsl.BEACON_VERTEX,
      fragmentShader: glsl.BEACON_FRAGMENT,
    }),
  );
  beacons.frustumCulled = false;
  beacons.renderOrder = 3;
  scene.add(beacons);
  skinned.lights.push(beacons.material);
}

function addTraffic(scene: THREE.Scene, map: CityMap, shared: Shared, random: () => number, skinned: Skinned): void {
  const { years } = map.cal;
  const from = new Float32Array(LANES * 3);
  const to = new Float32Array(LANES * 3);
  const rate = new Float32Array(LANES);
  const phase = new Float32Array(LANES);
  const warm = new Float32Array(LANES);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  for (let i = 0; i < LANES; i++) {
    const side = random() < 0.5 ? 1 : -1;
    const reach = 120;
    let a: number[];
    let b: number[];
    if (random() < 0.62) {
      const z = map.blockZ(pick(years)) - ROAD / 2 + side * 1.5;
      const altitude = pick([3.5, 6.5, 10, 16, 24]);
      a = [-reach, altitude, z];
      b = [WIDTH + reach, altitude, z];
    } else {
      const x = Math.round((random() * WEEKS) / 6) * 6 * CELL + side * 0.2;
      const altitude = pick([20, 26, 34]);
      a = [x, altitude, -reach];
      b = [x, altitude, map.depth + reach];
    }
    if (side < 0) [a, b] = [b, a];
    from.set(a, i * 3);
    to.set(b, i * 3);
    rate[i] = (9 + random() * 11) / (Math.abs(b[0] - a[0]) + Math.abs(b[2] - a[2]));
    phase[i] = random();
    warm[i] = side < 0 ? 1 : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(from, 3));
  geometry.setAttribute('aB', new THREE.BufferAttribute(to, 3));
  geometry.setAttribute('aRate', new THREE.BufferAttribute(rate, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aWarm', new THREE.BufferAttribute(warm, 1));
  const traffic = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: shared,
      vertexShader: glsl.TRAFFIC_VERTEX,
      fragmentShader: glsl.TRAFFIC_FRAGMENT,
    }),
  );
  traffic.frustumCulled = false;
  traffic.renderOrder = 3;
  scene.add(traffic);
  skinned.lights.push(traffic.material);
}

/** Paints the months, years and name on the ground, and returns a way to repaint them for another look. */
function addLettering(scene: THREE.Scene, map: CityMap, renderer: THREE.WebGLRenderer): (look: Look) => void {
  const { cal } = map;
  const painters: (() => void)[] = [];
  let { ink, paths } = LOOKS.night as Look;
  // Some looks write a name the way a path is written, lower case with a slash after it
  const written = (text: string) => (paths ? `${text.toLowerCase()}/` : text);
  const flatLabel = (
    w: number,
    h: number,
    px: number,
    x: number,
    z: number,
    draw: (g: CanvasRenderingContext2D, cw: number, ch: number) => void,
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * px);
    canvas.height = Math.round(h * px);
    const g = canvas.getContext('2d');
    if (!g) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const paint = () => {
      g.clearRect(0, 0, canvas.width, canvas.height);
      draw(g, canvas.width, canvas.height);
      texture.needsUpdate = true;
    };
    paint();
    painters.push(paint);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    mesh.renderOrder = 2;
    scene.add(mesh);
  };

  cal.years.forEach((y) => {
    flatLabel(WIDTH, 1.8, 22, WIDTH / 2, map.blockZ(y) + DEPTH + 1.3, (g, w, h) => {
      g.font = `600 ${h * 0.5}px ${MONO}`;
      g.textBaseline = 'middle';
      g.fillStyle = ink.months;
      MONTHS.forEach((name, month) => {
        const day = cal.dayOf(y, month);
        if (day < cal.days) g.fillText(written(name.toUpperCase()), (cal.cellOf(day).week / WEEKS) * w, h / 2);
      });
    });
    flatLabel(26, 15, 22, -16, map.blockZ(y) + DEPTH / 2, (g, w, h) => {
      g.textAlign = 'right';
      g.textBaseline = 'alphabetic';
      g.fillStyle = ink.year;
      g.font = `800 ${h * 0.62}px ${FACE}`;
      g.fillText(written(String(y)), w - 4, h * 0.62, w - 8);
      g.fillStyle = ink.total;
      g.font = `400 ${h * 0.16}px ${MONO}`;
      g.fillText(formatCount(cal.yearTotal(y)), w - 6, h * 0.86);
    });
  });
  flatLabel(108, 21, 13, WIDTH / 2, map.depth + 20, (g, w, h) => {
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = ink.name;
    g.font = `800 ${h * 0.56}px ${FACE}`;
    g.fillText(written(cal.login), w / 2, h * 0.6, w * 0.96);
    g.fillStyle = ink.span;
    g.font = `400 ${h * 0.13}px ${MONO}`;
    g.fillText(`${cal.firstYear}–${cal.lastYear}  ·  ${formatCount(cal.total)} contributions`, w / 2, h * 0.84);
  });

  void Promise.all([
    document.fonts.load(`800 64px ${FACE}`),
    document.fonts.load(`600 24px ${MONO}`),
    document.fonts.load(`400 24px ${MONO}`),
  ])
    .then(() => painters.forEach((paint) => paint()))
    .catch(() => {});

  return (look) => {
    ({ ink, paths } = look);
    painters.forEach((paint) => paint());
  };
}

export function createWorld(map: CityMap, renderer: THREE.WebGLRenderer, camera: THREE.Camera, cal: Calendar): World {
  const scene = new THREE.Scene();
  const random = seededRandom(cal.login);
  const shared: Shared = {
    uPlay: { value: cal.days + SETTLED_OFFSET },
    uRise: { value: RISE },
    uMin: { value: 0 },
    uMax: { value: cal.days - 1 },
    uDim: { value: 1 },
    uTime: { value: 0 },
    uFog: { value: new THREE.Color(0.05, 0.115, 0.165) },
    uFogD: { value: 0.0021 },
    uRamp: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    uWindow: { value: new THREE.Color() },
    uHover: { value: -1 },
    uHit: { value: -1 },
    uHitGlow: { value: 0 },
    uPx: { value: 1 },
    uWarp: { value: 0 },
    uLightPos: { value: Array.from({ length: LIGHT_SLOTS }, () => new THREE.Vector4()) },
    uLightCol: { value: Array.from({ length: LIGHT_SLOTS }, () => new THREE.Vector3()) },
    uLights: { value: 0 },
  };

  const skinned: Skinned = { shaders: [], lights: [], night: [], dark: [], ground: null, shadows: null };
  /** Set on a slow GPU, and kept through a change of look. */
  let simplified = false;
  const towers = addTowers(scene, map, shared, skinned);
  addGround(scene, map, shared, skinned);
  addLamps(scene, map, shared, skinned);

  const glow = new THREE.Color();
  const detail = { value: 1 };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: glsl.SKY_VERTEX,
      fragmentShader: glsl.SKY_FRAGMENT,
      uniforms: { uFog: shared.uFog, uGlow: { value: glow }, uDetail: detail, uTime: shared.uTime },
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);
  skinned.shaders.push(sky.material);

  const planetAt = new THREE.Vector3(0.2, 0.29, -1).normalize().multiplyScalar(1700);
  const planet = addPlanet();
  scene.add(planet);

  const stars = addStars(shared, random);
  scene.add(stars);
  const meteors = addMeteors(shared, random);
  scene.add(meteors);
  skinned.night.push(planet, meteors);
  skinned.dark.push(stars);
  /** Set for a visitor who asks for reduced motion, and kept through a change of look. */
  let calmed = false;

  addBeacons(scene, map, shared, skinned);
  addTraffic(scene, map, shared, random, skinned);

  const dustVelocity = new THREE.Vector3();
  const dust = new THREE.LineSegments(
    lineGeometry(DUST, () => [random(), random(), random()]),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uCam: { value: camera.position }, uVel: { value: dustVelocity } },
      vertexShader: glsl.DUST_VERTEX,
      fragmentShader: glsl.DUST_FRAGMENT,
    }),
  );
  dust.frustumCulled = false;
  scene.add(dust);
  skinned.lights.push(dust.material);

  const warpLines = new THREE.LineSegments(
    lineGeometry(WARP_LINES, () => {
      const a = random() * Math.PI * 2;
      const r = 10 + Math.pow(random(), 0.6) * 280;
      return [Math.cos(a) * r, Math.sin(a) * r, random()];
    }),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: shared,
      vertexShader: glsl.WARP_VERTEX,
      fragmentShader: glsl.WARP_FRAGMENT,
    }),
  );
  warpLines.frustumCulled = false;
  warpLines.renderOrder = 5;
  warpLines.visible = false;
  scene.add(warpLines);
  skinned.lights.push(warpLines.material);

  const letter = addLettering(scene, map, renderer);

  return {
    scene,
    towers,
    shared,
    dust,
    dustVelocity,
    warpLines,
    followCamera(view) {
      sky.position.copy(view.position);
      stars.position.copy(view.position);
      meteors.position.copy(view.position);
      planet.position.copy(view.position).add(planetAt);
    },
    paintTowers({ ramp, window }) {
      ramp.forEach((stop, i) => shared.uRamp.value[i].fromArray(stop));
      shared.uWindow.value.fromArray(window);
      glow.fromArray(ramp[2]);
    },
    setSkin(skin) {
      const look = LOOKS[skin];
      for (const material of skinned.shaders) dress(material, skin);
      for (const material of skinned.lights) dress(material, skin, true);
      const night = look.scene === 'night';
      for (const part of skinned.night) part.visible = night && !(part === meteors && calmed);
      for (const part of skinned.dark) part.visible = look.dark;
      // A see-through ground is drawn among the lights, in the order the night was tuned with. Any other ground is
      // solid, and drawn with the solid things, or it would paint over every light drawn before it.
      if (skinned.ground) skinned.ground.transparent = night;
      if (skinned.shadows) {
        skinned.shadows.visible = look.shade > 0 && !simplified;
        skinned.shadows.material.uniforms.uShade.value = look.shade;
      }
      shared.uFog.value.fromArray(look.fog);
      shared.uFogD.value = look.fogDensity;
      letter(look);
    },
    simplify() {
      simplified = true;
      detail.value = 0;
      if (skinned.shadows) skinned.shadows.visible = false;
    },
    calm() {
      calmed = true;
      meteors.visible = false;
    },
  };
}
