import * as THREE from 'three';
import { formatCount, MONTHS, type Calendar } from './calendar';
import type { TowerPalette } from './colours';
import { CELL, DEPTH, PLINTH, ROAD, TOWER, WEEKS, WIDTH, type CityMap } from './map';
import { RISE } from './routes';
import * as glsl from './shaders';

const BEACONS = 12;
const LANES = 420;
const DUST = 240;
const WARP_LINES = 1500;
const STARS = 1100;
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
};

export interface World {
  scene: THREE.Scene;
  towers: THREE.InstancedMesh;
  shared: Shared;
  beaconCount: number;
  dust: THREE.LineSegments;
  dustVelocity: THREE.Vector3;
  warpLines: THREE.LineSegments;
  /** Sky, stars and planet stay at the horizon wherever the camera goes. */
  followCamera(camera: THREE.Camera): void;
  paintTowers(palette: TowerPalette): void;
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

function addTowers(scene: THREE.Scene, map: CityMap, shared: Shared): THREE.InstancedMesh {
  const { cal, cx, cz } = map;
  const { days, counts, peak } = cal;
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
    aMag[i] = counts[i] ? Math.sqrt(counts[i] / peak) : 0;
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
  return towers;
}

function addGround(scene: THREE.Scene, map: CityMap, shared: Shared): void {
  const fogUniforms = { uFog: shared.uFog, uFogD: shared.uFogD };
  const plinth = new THREE.ShaderMaterial({
    vertexShader: glsl.SOLID_VERTEX,
    fragmentShader: glsl.SOLID_FRAGMENT,
    uniforms: fogUniforms,
  });
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
      uniforms: fogUniforms,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = 1;
  scene.add(ground);
}

function addBeacons(scene: THREE.Scene, map: CityMap, shared: Shared): number {
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
  return busiest.length;
}

function addTraffic(scene: THREE.Scene, map: CityMap, shared: Shared, random: () => number): void {
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
}

function addLettering(scene: THREE.Scene, map: CityMap, renderer: THREE.WebGLRenderer): void {
  const { cal } = map;
  const painters: (() => void)[] = [];
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
      g.fillStyle = 'rgba(150,205,175,.52)';
      MONTHS.forEach((name, month) => {
        const day = cal.dayOf(y, month);
        if (day < cal.days) g.fillText(name.toUpperCase(), (cal.cellOf(day).week / WEEKS) * w, h / 2);
      });
    });
    flatLabel(26, 15, 22, -16, map.blockZ(y) + DEPTH / 2, (g, w, h) => {
      g.textAlign = 'right';
      g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(205,235,218,.5)';
      g.font = `800 ${h * 0.62}px ${FACE}`;
      g.fillText(String(y), w - 4, h * 0.62);
      g.fillStyle = 'rgba(150,205,175,.48)';
      g.font = `400 ${h * 0.16}px ${MONO}`;
      g.fillText(formatCount(cal.yearTotal(y)), w - 6, h * 0.86);
    });
  });
  flatLabel(108, 21, 13, WIDTH / 2, map.depth + 20, (g, w, h) => {
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(225,242,232,.55)';
    g.font = `800 ${h * 0.56}px ${FACE}`;
    g.fillText(cal.login, w / 2, h * 0.6, w * 0.96);
    g.fillStyle = 'rgba(150,205,175,.7)';
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
  };

  const towers = addTowers(scene, map, shared);
  addGround(scene, map, shared);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: glsl.SKY_VERTEX,
      fragmentShader: glsl.SKY_FRAGMENT,
      uniforms: { uFog: shared.uFog },
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const planetAt = new THREE.Vector3(0.2, 0.29, -1).normalize().multiplyScalar(1700);
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(330, 64, 40),
    new THREE.ShaderMaterial({ vertexShader: glsl.PLANET_VERTEX, fragmentShader: glsl.PLANET_FRAGMENT }),
  );
  planet.renderOrder = -9.5;
  scene.add(planet);

  const starPositions = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const a = random() * Math.PI * 2;
    const h = 0.04 + random() * 0.96;
    const r = Math.sqrt(1 - h * h);
    starPositions.set([Math.cos(a) * r * 2500, h * 2500, Math.sin(a) * r * 2500], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0xcfe0ff,
      size: 1.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  scene.add(stars);

  const beaconCount = addBeacons(scene, map, shared);
  addTraffic(scene, map, shared, random);

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

  addLettering(scene, map, renderer);

  return {
    scene,
    towers,
    shared,
    beaconCount,
    dust,
    dustVelocity,
    warpLines,
    followCamera(view) {
      sky.position.copy(view.position);
      stars.position.copy(view.position);
      planet.position.copy(view.position).add(planetAt);
    },
    paintTowers({ ramp, window }) {
      ramp.forEach((stop, i) => shared.uRamp.value[i].fromArray(stop));
      shared.uWindow.value.fromArray(window);
    },
  };
}
