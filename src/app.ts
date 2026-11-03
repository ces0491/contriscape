import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Contributions } from '../shared/contract';
import { APP_NAME } from './brand';
import { Badges } from './badges';
import { Blast } from './blast';
import { Calendar, describeCount, MONTHS } from './calendar';
import { COLOUR_ROWS, DEFAULT_COLOURS, readColours, towerPalette, type Colours } from './colours';
import { buildFighter, Weapons } from './fighter';
import { FINALE_SECONDS, Fireworks } from './fireworks';
import { Hud, type Scope } from './hud';
import { CityMap, DEPTH, PLINTH, TOWER, WIDTH } from './map';
import { findMilestones, type Milestone } from './milestones';
import { averageFrame, SLOW_FRAME_MS } from './quality';
import { reviewFacts, reviewTitle, reviewYear } from './review';
import { buildRoute, lengthAtDay, newPose, poseAt, RISE, type Route } from './routes';
import { FINISH_FRAGMENT, FINISH_VERTEX } from './shaders';
import { Sound } from './sound';
import { keyTurn } from './steering';
import { createWorld, SETTLED_OFFSET } from './world';
import { COCKPIT_BELOW, nextZoom } from './zoom';

type Mode = 'fly' | 'pilot' | 'orbit';

const JUMP_SECONDS = 1.5;
const SHIP_RADIUS = 0.3;
const FLOOR = 0.7;
const CHASE_DISTANCE = 2.4;
/** How far below the route ahead the autopilot looks, per unit of altitude, so the view tips down onto the roofs. */
const LOOK_DOWN = 0.15;
const MAX_LOOK_DOWN = 2;
const INVERT_KEY = 'contriscape:invert-y';
const MOUSE_KEY = 'contriscape:mouse-steer';
const SOUND_KEY = 'contriscape:sound';
const COLOUR_KEY = 'contriscape:colours';
const REVIEW_HASH = '#your-year';
const CAPTION_SECONDS = 4;
const BADGE_APPROACH = 10;
const PARKED_SECONDS = 6;
/** How long the ship stays put to watch a badge go up. */
const BLAST_WATCH = 1.4;
/** Two badges can share a day, so two can go up at once. */
const BLASTS = 2;
/** Radians a second through the roll a ship makes for clearing a city. */
const VICTORY_ROLL = 4.5;
const CRUISE = 17;
const BRAKE = 6;
const BOOST = 46;
/** The largest city a single view frames well. Older years sit behind the opening camera. */
const FRAMED_DEPTH = 189;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (k: number) => k * k * (3 - 2 * k);
const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Each panel, by the id of the button that opens it. */
const PANELS = { year: 'yearPanel', badges: 'badgePanel', settings: 'settingsPanel', guide: 'guidePanel' };
type Panel = keyof typeof PANELS;
const PANEL_NAMES = Object.keys(PANELS) as Panel[];

function recall(key: string, fallback = false): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  } catch {
    // Blocked storage just means the default.
    return fallback;
  }
}

function remember(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Private windows can refuse storage. The choice still holds for this visit.
  }
}

/** Builds the city and starts the render loop. Throws if WebGL is unavailable. */
export function startApp(data: Contributions): void {
  // Colours are authored for the display, and every shader writes them straight through
  THREE.ColorManagement.enabled = false;

  const cal = new Calendar(data);
  const map = new CityMap(cal);
  const { counts, days, years, firstYear, lastYear } = cal;
  const SETTLED = days + SETTLED_OFFSET;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;
  const canvas = element<HTMLCanvasElement>('gl');
  const stage = element('stage');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);

  const framed = Math.min(map.depth, FRAMED_DEPTH);
  const CENTRE = new THREE.Vector3(WIDTH / 2, 4, framed / 2);
  const LANDING = new THREE.Vector3(
    WIDTH / 2,
    clamp(24 + framed * 0.19, 24, 60),
    framed + Math.max(26, 120 - framed * 0.5),
  );
  const LANDING_AIM = new THREE.Vector3(WIDTH / 2, -16 * Math.min(1, framed / FRAMED_DEPTH), framed * 0.44);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.12, 3800);
  camera.position.copy(LANDING);

  const world = createWorld(map, renderer, camera, cal);
  const { scene, shared, towers } = world;
  shared.uPx.value = pixelRatio;

  const { fighter, paintFighter } = buildFighter();
  scene.add(fighter);
  scene.add(new THREE.AmbientLight(0x8fa6c0, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0e0, 1.5);
  sun.position.set(-0.5, 0.8, 0.6);
  scene.add(sun);
  const weapons = new Weapons(scene, Math.random);
  const badges = new Badges(scene, map, findMilestones(cal), cal.login, shared);
  const blasts = Array.from({ length: BLASTS }, () => new Blast(scene, Math.random));
  const fireworks = new Fireworks(scene, shared.uPx, Math.random);
  const sound = new Sound(recall(SOUND_KEY, true));

  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: pixelRatio < 2 ? 4 : 2 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.6, 0.74);
  composer.addPass(bloom);
  const finish = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 }, uRed: { value: 0 } },
    vertexShader: FINISH_VERTEX,
    fragmentShader: FINISH_FRAGMENT,
  });
  composer.addPass(finish);

  /* ---------- state ---------- */
  const scopes = new Map<'all' | number, Scope>([
    ['all', { key: 'all', a: 0, b: days - 1, label: `${firstYear}–${lastYear} · ${APP_NAME}` }],
  ]);
  years.forEach((y) => scopes.set(y, { key: y, ...cal.span(y), label: `${y} · ${APP_NAME}` }));
  const scopeFor = (key: 'all' | number) => scopes.get(key) as Scope;

  let scope = scopeFor('all');
  let mode: Mode = 'fly';
  let paused = false;
  let flight: (Route & { s: number }) | null = null;
  let arrived = false;
  let play = SETTLED;
  let playGoal = SETTLED;
  let holdSeconds = 0;
  let jump: { t: number; mid: () => void; done: boolean; from: number | null } | null = null;
  let warp = 0;
  let snap = false;
  let zoom = 1;
  let zoomGoal = 1;
  let reach = 1;
  let parkedUntil = 0;
  let aiming = false;
  let panelOpen = false;
  let invertY = recall(INVERT_KEY);
  let mouseSteer = recall(MOUSE_KEY);
  let keyX = 0;
  let keyY = 0;
  let nextBlast = 0;
  let reviewing = false;
  let nextBeat = 0;
  let captionUntil = 0;
  const review = reviewYear(cal, lastYear);
  let shake = 0;
  let redAlert = 0;
  let hitGlow = 0;
  let victoryRoll = 0;
  let firing = false;
  let contactCooldown = 0;
  let dimGoal = 1;
  let time = 0;
  let glide: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  let baseFov = 58;
  let hintTimer = 0;
  let pickAt: { x: number; y: number } | null = null;
  // The finger or button doing each job, because a phone runs steering and firing at the same time
  let pointer: { id: number; x: number; y: number } | null = null;
  let firePointer: number | null = null;
  let dragPointer: number | null = null;
  let pinch: number | null = null;
  const dragging = () => dragPointer !== null;

  const hud = new Hud(cal, scope, dragging);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    enabled: false,
    enableDamping: true,
    dampingFactor: 0.06,
    maxPolarAngle: 1.52,
    minDistance: 6,
    maxDistance: Math.max(560, map.depth * 3),
    autoRotateSpeed: 0.32,
    zoomSpeed: 1.6,
  });
  // OrbitControls aims the camera at the origin when it is created
  camera.lookAt(LANDING_AIM);
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    glide = null;
  });
  const orbitGoal = CENTRE.clone();

  const ship = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(),
    fwd: new THREE.Vector3(1, 0, 0),
    slide: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    bank: 0,
    speed: CRUISE,
    live: false,
  };
  const stick = new THREE.Vector2();
  const keys = new Set<string>();
  const touches = new Map<number, { x: number; y: number }>();

  const UP = new THREE.Vector3(0, 1, 0);
  const ROLL_AXIS = new THREE.Vector3(0, 0, 1);
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const v4 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const m1 = new THREE.Matrix4();
  const e1 = new THREE.Euler(0, 0, 0, 'YXZ');
  const here = newPose();
  const nose = newPose();
  const behind = newPose();
  const ahead = newPose();

  const viewFor = (): THREE.Vector3 => {
    if (scope.key === 'all') return LANDING;
    return new THREE.Vector3(WIDTH / 2 + 30, 68, map.blockZ(scope.key) + DEPTH / 2 + 118);
  };
  const focusFor = (): THREE.Vector3 =>
    scope.key === 'all' ? CENTRE : new THREE.Vector3(WIDTH / 2, 4, map.blockZ(scope.key) + DEPTH / 2);

  const aboard = () => (mode === 'pilot' ? ship.live : mode === 'fly' && arrived);
  const standing = (i: number) =>
    i <= play || i > shared.uMax.value ? map.top[i] : PLINTH + (map.top[i] - PLINTH) * 0.04;
  const chaseDistance = () => (zoom < COCKPIT_BELOW ? 0 : CHASE_DISTANCE * zoom);

  const towerAt = (p: THREE.Vector3, roof = standing): number => {
    const i = map.cellIndex(p.x, p.z);
    const inside =
      i >= 0 && counts[i] && Math.abs(p.x - map.cx[i]) < TOWER / 2 && Math.abs(p.z - map.cz[i]) < TOWER / 2;
    return inside && p.y < roof(i) ? i : -1;
  };

  /** How far from a towards b is clear of towers, as a fraction of the way. */
  function clearReach(a: THREE.Vector3, b: THREE.Vector3): number {
    const steps = Math.min(16, Math.ceil(a.distanceTo(b) / 0.7));
    let clear = 0;
    for (let k = 1; k <= steps; k++) {
      v4.lerpVectors(a, b, k / steps);
      let blocked = false;
      map.towersNear(v4.x, v4.z, 0.24, (i) => {
        if (v4.y < standing(i) + 0.24) blocked = true;
      });
      if (blocked) break;
      clear = k / steps;
    }
    return clear;
  }

  /** The chase position: eases in when a tower gets in the way and back out slowly, so the view never steps. */
  function chasePoint(ship: THREE.Vector3, wanted: THREE.Vector3, dt: number, out: THREE.Vector3): THREE.Vector3 {
    const clear = clearReach(ship, wanted);
    reach = snap ? clear : reach + (clear - reach) * (1 - Math.exp(-(clear < reach ? 9 : 2.5) * dt));
    return out.lerpVectors(ship, wanted, reach);
  }

  /* ---------- hyperspace ---------- */
  function beginJump(mid: () => void, rewind = false): void {
    if (reduced) {
      if (rewind) play = scope.a;
      mid();
      return;
    }
    sound.jump(JUMP_SECONDS);
    jump = { t: 0, mid, done: false, from: rewind ? Math.min(play, scope.b + RISE) : null };
  }
  function updateJump(dt: number): void {
    if (!jump) {
      warp = 0;
      finish.uniforms.uFlash.value = 0;
      return;
    }
    const active = jump;
    active.t = Math.min(1, active.t + dt / JUMP_SECONDS);
    const k = active.t;
    warp = Math.pow(Math.sin(Math.PI * k), 1.4);
    finish.uniforms.uFlash.value = Math.exp(-Math.pow((k - 0.5) / 0.055, 2)) * 0.9;
    if (active.from !== null && !active.done) play = active.from + (scope.a - active.from) * smooth(k * 2);
    if (k >= 0.5 && !active.done) {
      active.done = true;
      active.mid();
    }
    if (jump === active && k >= 1) jump = null;
  }

  /* ---------- autopilot ---------- */
  function startFlight(holdFor: number): void {
    flight = { ...buildRoute(map, scope.key, CENTRE), s: 0 };
    arrived = false;
    paused = false;
    holdSeconds = holdFor;
    syncPlay();
  }
  function aimCamera(pos: THREE.Vector3, look: THREE.Vector3, roll: number, dt: number, follow = 22, turn = 12): void {
    m1.lookAt(pos, look, UP);
    q1.setFromRotationMatrix(m1).multiply(q2.setFromAxisAngle(ROLL_AXIS, roll));
    if (snap) {
      camera.position.copy(pos);
      camera.quaternion.copy(q1);
      snap = false;
      return;
    }
    camera.position.lerp(pos, 1 - Math.exp(-follow * dt));
    camera.quaternion.slerp(q1, 1 - Math.exp(-turn * dt));
  }
  function poseFromRoute(route: Route & { s: number }, dt: number): void {
    const pt = poseAt(route, route.s, here);
    const fw = poseAt(route, Math.min(route.len, route.s + 0.9), nose);
    ship.fwd.subVectors(fw.p, pt.p).normalize();
    ship.pos.copy(pt.p);
    ship.vel.copy(ship.fwd).multiplyScalar(pt.pace);
    v2.copy(pt.p).add(ship.fwd);
    m1.lookAt(pt.p, v2, UP);
    ship.quat.setFromRotationMatrix(m1);
    fighter.position.copy(pt.p);
    fighter.quaternion.copy(ship.quat).multiply(q2.setFromAxisAngle(ROLL_AXIS, pt.roll + pt.spin));

    const d = chaseDistance();
    poseAt(route, Math.min(route.len, route.s + 8), ahead);
    v3.copy(ahead.p);
    v3.y -= Math.min(MAX_LOOK_DOWN, v3.y * LOOK_DOWN);
    v3.lerp(pt.g, pt.gaze);
    if (d > 0) {
      poseAt(route, Math.max(0, route.s - d), behind);
      v2.copy(behind.p);
      // High enough to keep the ship below the middle of a view that tips down
      v2.y += 0.4 * d + 0.12;
      chasePoint(pt.p, v2, dt, v1);
    } else {
      v1.copy(pt.p);
    }
    // The route is already smooth, so the camera rides it exactly. Filtering again would add lag that shifts with frame time.
    aimCamera(v1, v3, pt.roll * (d > 0 ? 0.3 : 0.6), dt, Infinity, 6);
  }
  function updateFlight(dt: number): void {
    if (!flight) return;
    if (!arrived) {
      if (holdSeconds > 0) {
        if (!paused) holdSeconds -= dt;
        return;
      }
      if (!jump) {
        beginJump(() => {
          arrived = true;
          snap = true;
        }, true);
      }
      return;
    }
    if (!paused && !dragging() && !(jump && jump.t < 0.5)) {
      flight.s += poseAt(flight, flight.s, here).pace * dt;
      if (flight.s >= flight.len) {
        flight.s = flight.len;
        if (!jump) beginJump(endFlight);
        if (reduced) return;
      }
    }
    play = poseAt(flight, flight.s, here).day;
    poseFromRoute(flight, dt);
  }
  function endFlight(): void {
    const finished = reviewing && review;
    camera.position.copy(viewFor());
    camera.lookAt(scope.key === 'all' ? LANDING_AIM : focusFor());
    setMode('orbit');
    if (finished) hud.showSummary(reviewTitle(review.year), reviewFacts(review, cal));
  }

  /* ---------- pilot ---------- */
  function spawnShip(year: number): void {
    ship.pos.set(-12, 5.5, map.streetFor(year));
    ship.yaw = -Math.PI / 2;
    ship.pitch = 0;
    ship.bank = 0;
    ship.speed = CRUISE;
    ship.slide.set(0, 0, 0);
    ship.live = true;
    snap = true;
  }
  function takeControls(): void {
    ship.yaw = Math.atan2(-ship.fwd.x, -ship.fwd.z);
    ship.pitch = Math.asin(clamp(ship.fwd.y, -1, 1));
    ship.speed = clamp(ship.vel.length(), BRAKE, BOOST);
    ship.slide.set(0, 0, 0);
    ship.live = true;
  }
  function bump(day: number, headOn: boolean): void {
    if (contactCooldown > 0) return;
    contactCooldown = 0.35;
    ship.speed *= headOn ? 0.45 : 0.8;
    sound.bump(headOn);
    if (!reduced) shake = headOn ? 1 : 0.45;
    redAlert = headOn ? 1 : 0.5;
    shared.uHit.value = day;
    hitGlow = 1;
  }
  function collide(): void {
    map.towersNear(ship.pos.x, ship.pos.z, SHIP_RADIUS, (i) => {
      const roof = standing(i);
      const rise = roof + SHIP_RADIUS - ship.pos.y;
      if (rise <= 0) return;
      const dx = ship.pos.x - map.cx[i];
      const dz = ship.pos.z - map.cz[i];
      const px = TOWER / 2 + SHIP_RADIUS - Math.abs(dx);
      const pz = TOWER / 2 + SHIP_RADIUS - Math.abs(dz);
      if (rise < Math.min(px, pz) && rise < 1.2) {
        ship.pos.y = roof + SHIP_RADIUS;
        if (ship.pitch < 0) ship.pitch *= 0.5;
        return;
      }
      const alongX = px < pz;
      const nx = alongX ? Math.sign(dx) || 1 : 0;
      const nz = alongX ? 0 : Math.sign(dz) || 1;
      const dot = ship.fwd.x * nx + ship.fwd.z * nz;
      if (alongX) ship.pos.x += nx * px;
      else ship.pos.z += nz * pz;
      const headOn = dot < -0.45;
      if (headOn) ship.yaw = Math.atan2(-(ship.fwd.x - 2 * dot * nx), -(ship.fwd.z - 2 * dot * nz));
      bump(i, headOn);
    });
  }
  function updatePilot(dt: number): void {
    if (!ship.live) return;
    // WASD and the arrow keys are the same controls
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    const up = keys.has('KeyW') || keys.has('ArrowUp');
    const down = keys.has('KeyS') || keys.has('ArrowDown');
    const turning = Number(right) - Number(left);
    const climbing = Number(down) - Number(up);
    keyX = keyTurn(keyX, turning, dt);
    keyY = keyTurn(keyY, climbing, dt);
    let sx = turning ? keyX : stick.x;
    let sy = climbing ? keyY : stick.y;
    if (invertY) sy = -sy;
    const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (boosting) parkedUntil = 0;
    // Holds steady at a badge. Lining up the shot extends the hold, because moving off would overshoot the badge.
    if (aiming && time < parkedUntil && (turning || climbing)) parkedUntil = time + PARKED_SECONDS;
    // An open panel stops the ship, so nothing goes wrong while the mouse is busy with it
    const holding = panelOpen || time < parkedUntil;
    if (panelOpen) {
      sx = 0;
      sy = 0;
    }
    ship.yaw -= sx * 2 * dt;
    ship.pitch = clamp(ship.pitch - sy * 1.5 * dt, -1.3, 1.3);
    const wanted = holding ? 0 : boosting ? BOOST : keys.has('KeyC') ? BRAKE : CRUISE;
    ship.speed += (wanted - ship.speed) * (1 - Math.exp(-2.4 * dt));

    q1.setFromEuler(e1.set(ship.pitch, ship.yaw, 0, 'YXZ'));
    ship.quat.copy(q1);
    ship.fwd.set(0, 0, -1).applyQuaternion(q1);
    v2.set(0, (keys.has('KeyE') ? 8 : 0) - (keys.has('KeyQ') ? 8 : 0), 0);
    ship.slide.lerp(v2, 1 - Math.exp(-7 * dt));
    v2.copy(ship.slide).applyQuaternion(q1);
    ship.vel.copy(ship.fwd).multiplyScalar(ship.speed).add(v2);

    // Small steps, so a boosting ship can't jump a tower on a slow frame
    const steps = Math.ceil((ship.vel.length() * dt) / 0.35);
    for (let n = 0; n < steps; n++) {
      ship.pos.addScaledVector(ship.vel, dt / steps);
      ship.pos.y = clamp(ship.pos.y, FLOOR, 190);
      collide();
    }
    // The street stops a dive, and levelling off keeps the guns pointing along it instead of into it
    if (ship.pos.y <= FLOOR) ship.pitch = Math.max(0, ship.pitch);
    ship.pos.x = clamp(ship.pos.x, -300, WIDTH + 300);
    ship.pos.z = clamp(ship.pos.z, -300, map.depth + 300);

    ship.bank += (-sx * 1.05 - ship.bank) * (1 - Math.exp(-5 * dt));
    fighter.position.copy(ship.pos);
    fighter.quaternion.copy(ship.quat).multiply(q2.setFromAxisAngle(ROLL_AXIS, ship.bank + victoryRoll));

    const d = chaseDistance();
    v3.copy(ship.pos).addScaledVector(ship.fwd, 9);
    if (d > 0) {
      v2.copy(ship.pos).addScaledVector(ship.fwd, -d);
      v2.y += 0.2 * d + 0.12;
      chasePoint(ship.pos, v2, dt, v1);
    } else {
      v1.copy(ship.pos);
    }
    aimCamera(v1, v3, ship.bank * (d > 0 ? 0.4 : 0.8), dt);
  }

  /* ---------- targeting computer ---------- */
  const reticle = element('reticle') as unknown as SVGSVGElement;
  const bracket = element('bracket');
  const lock = element('lock');
  function aimedTower(): number {
    const step = 0.6;
    v2.copy(ship.pos);
    for (let t = 0; t < 95; t += step) {
      v2.addScaledVector(ship.fwd, step);
      if (v2.y < 0) return -1;
      const i = towerAt(v2);
      if (i >= 0) return i;
    }
    return -1;
  }
  function updateTargeting(): void {
    const flying = aboard() && !(jump && jump.t < 0.5);
    reticle.toggleAttribute('hidden', !flying);
    const i = flying ? aimedTower() : -1;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (flying) {
      v2.copy(ship.pos).addScaledVector(ship.fwd, 30).project(camera);
      reticle.style.transform = `translate(${((v2.x + 1) / 2) * width}px,${((1 - v2.y) / 2) * height}px)`;
    }
    if (i < 0) {
      bracket.hidden = lock.hidden = true;
      if (mode !== 'orbit') shared.uHover.value = -1;
      return;
    }
    v2.set(map.cx[i], Math.min(standing(i) - 0.4, Math.max(ship.pos.y, 1)), map.cz[i]).project(camera);
    if (v2.z > 1 || Math.abs(v2.x) > 1 || Math.abs(v2.y) > 1) {
      bracket.hidden = lock.hidden = true;
      return;
    }
    const placed = `translate(${((v2.x + 1) / 2) * width}px,${((1 - v2.y) / 2) * height}px)`;
    bracket.style.transform = lock.style.transform = placed;
    bracket.hidden = lock.hidden = false;
    shared.uHover.value = i;
    if (lock.dataset.day !== String(i)) {
      lock.dataset.day = String(i);
      (lock.firstElementChild as HTMLElement).textContent = cal.formatDate(i);
      (lock.lastElementChild as HTMLElement).textContent = describeCount(counts[i]);
    }
  }

  /* ---------- modes ---------- */
  const HINTS: Record<Mode, string> = {
    fly: touch ? 'Pinch to zoom' : 'Scroll to zoom, all the way in for the cockpit',
    pilot: touch
      ? 'Drag to steer · Pinch to zoom · Shoot gold badges to earn them'
      : 'WASD or arrows steer · Space fires · Shift boost · C brake · The Guide has the rest',
    orbit: touch ? 'Drag to rotate · Pinch to zoom' : 'Drag to rotate · Scroll to zoom',
  };
  function showHint(m: Mode): void {
    const hint = element('hint');
    hint.textContent = HINTS[m];
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      hint.hidden = true;
    }, 9000);
  }
  function glideOut(): void {
    glide = { from: camera.position.clone(), to: viewFor(), t: 0 };
  }
  function syncPlay(): void {
    element('play').textContent = mode !== 'fly' ? 'Replay' : paused ? 'Play' : 'Pause';
  }
  function syncCursor(): void {
    const steering = mode === 'pilot' && mouseSteer;
    canvas.style.cursor = steering ? 'crosshair' : mode === 'orbit' ? 'grab' : 'default';
  }
  function spawnYear(): number {
    return scope.key === 'all' ? lastYear : scope.key;
  }
  function setMode(next: Mode, holdFor = 0): void {
    const wasFlying = mode === 'fly' && arrived && !(jump && jump.t < 0.5);
    if (next !== 'fly') stopReview();
    mode = next;
    glide = null;
    controls.enabled = next === 'orbit';
    (['fly', 'pilot', 'orbit'] as const).forEach((m) =>
      element(`m-${m}`).setAttribute('aria-pressed', String(m === next)),
    );
    showHint(next);
    document.body.classList.toggle('piloting', next === 'pilot');
    element('fire').hidden = !(touch && next === 'pilot');
    syncCursor();
    keys.clear();
    stick.set(0, 0);
    firing = false;
    if (next === 'fly') {
      startFlight(holdFor);
    } else if (next === 'pilot') {
      playGoal = SETTLED;
      ship.live = false;
      if (wasFlying) takeControls();
      else beginJump(() => spawnShip(spawnYear()));
    } else {
      playGoal = SETTLED;
      orbitGoal.copy(focusFor());
      camera.getWorldDirection(v1);
      controls.target.copy(camera.position).addScaledVector(v1, camera.position.distanceTo(orbitGoal));
      controls.autoRotate = !reduced;
      if (camera.position.distanceTo(orbitGoal) < viewFor().distanceTo(orbitGoal) * 0.6) glideOut();
    }
    syncPlay();
  }
  function setScope(key: 'all' | number): void {
    scope = scopeFor(key);
    shared.uMin.value = scope.a;
    shared.uMax.value = key === 'all' ? days - 1 : scope.b;
    dimGoal = key === 'all' ? 1 : 0.2;
    document.querySelectorAll<HTMLElement>('#years button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.key === String(key)));
    });
    element('year').textContent = key === 'all' ? 'All years' : String(key);
    hud.setScope(scope);
    if (mode === 'fly') {
      startFlight(0);
      return;
    }
    playGoal = SETTLED;
    if (mode === 'pilot') {
      ship.live = false;
      beginJump(() => spawnShip(spawnYear()));
    } else {
      orbitGoal.copy(focusFor());
      glideOut();
    }
  }
  function setInvert(on: boolean): void {
    invertY = on;
    element('invert').setAttribute('aria-pressed', String(on));
    remember(INVERT_KEY, on);
  }
  function setSound(on: boolean): void {
    sound.setEnabled(on);
    element('sound').setAttribute('aria-pressed', String(on));
    remember(SOUND_KEY, on);
  }
  function setMouseSteer(on: boolean): void {
    mouseSteer = on;
    element('mouseSteer').setAttribute('aria-pressed', String(on));
    remember(MOUSE_KEY, on);
    stick.set(0, 0);
    syncCursor();
  }

  /* ---------- panels ---------- */
  function showPanel(open: Panel | null): void {
    PANEL_NAMES.forEach((name) => {
      element(PANELS[name]).hidden = name !== open;
      element(name).setAttribute('aria-expanded', String(name === open));
    });
    panelOpen = open !== null;
    standDownReset();
  }

  /* ---------- colours ---------- */
  let colours = DEFAULT_COLOURS;
  try {
    colours = readColours(localStorage.getItem(COLOUR_KEY));
  } catch {
    // Blocked storage just means the default.
  }
  function paintScene(): void {
    const palette = towerPalette(colours.towers);
    world.paintTowers(palette);
    paintFighter(colours);
    hud.setAccent(palette.ramp[3]);
    hud.syncColours(colours);
  }
  function setColours(next: Colours): void {
    colours = next;
    paintScene();
    try {
      localStorage.setItem(COLOUR_KEY, JSON.stringify(next));
    } catch {
      // Private windows can refuse storage. The choice still holds for this visit.
    }
  }

  /* ---------- badges ---------- */
  function standDownReset(): void {
    const button = element('badgeReset');
    delete button.dataset.armed;
    button.textContent = 'Reset';
  }
  /** Earned badges take some flying to win back, so clearing them takes a second press. */
  function pressReset(): void {
    const button = element('badgeReset');
    if (button.dataset.armed) {
      badges.reset();
      standDownReset();
      drawBadges();
      return;
    }
    button.dataset.armed = 'true';
    button.textContent = `Clear ${badges.earned.size}?`;
  }
  function drawBadges(): void {
    hud.renderBadges(
      badges.milestones.map((m, i) => ({
        name: m.name,
        detail: m.detail,
        date: cal.formatShort(m.day),
        earned: badges.isEarned(i),
        picture: badges.picture(i),
      })),
      visitBadge,
    );
  }
  function earn(badge: Milestone): void {
    const cleared = badges.allEarned;
    aiming = false;
    // A parked ship stays for the show. One already flying carries on underneath it.
    if (time < parkedUntil) parkedUntil = time + (cleared ? FINALE_SECONDS : BLAST_WATCH);
    if (cleared) sound.fanfare();
    else sound.chime();
    if (!reduced) {
      blasts[nextBlast++ % BLASTS].start(badges.position(badges.milestones.indexOf(badge)));
      sound.blast();
      shake = 0.4;
      if (cleared) {
        fireworks.start(camera, towerPalette(colours.towers).ramp[3]);
        sound.fireworks();
        victoryRoll = Math.PI * 2;
      }
    }
    const total = badges.milestones.length;
    hud.showToast(
      cleared ? 'City cleared' : `Badge earned: ${badge.name}`,
      cleared
        ? `${total} of ${total} badges earned on ${cal.login}`
        : `${badge.detail} · ${cal.formatShort(badge.day)}`,
      badges.pictureFor(badge.id),
    );
    drawBadges();
  }
  /** Lines the ship up in front of a badge, clear of towers and aimed straight at it. */
  function visitBadge(index: number): void {
    showPanel(null);
    const target = badges.position(index);
    const clearAt = (height: number) => {
      for (let k = 0; k <= 20; k++) {
        v2.set(target.x, height + ((target.y - height) * k) / 20, target.z + (BADGE_APPROACH * (20 - k)) / 20);
        // Against the finished city, because every tower is up by the time the ship arrives
        if (towerAt(v2, (i) => map.top[i]) >= 0) return false;
      }
      return true;
    };
    let height = target.y;
    while (height < target.y + 40 && !clearAt(height)) height += 1.5;
    const arrive = () => {
      ship.pos.set(target.x, height, target.z + BADGE_APPROACH);
      ship.yaw = 0;
      ship.pitch = Math.atan2(target.y - height, BADGE_APPROACH);
      ship.bank = 0;
      ship.speed = 0;
      ship.slide.set(0, 0, 0);
      ship.live = true;
      snap = true;
      // A badge already blown up leaves nothing to wait for
      aiming = !badges.isEarned(index);
      parkedUntil = aiming ? time + PARKED_SECONDS : 0;
    };
    // A date dragged back on the timeline would leave the badge unbuilt
    playGoal = SETTLED;
    if (mode !== 'pilot') setMode('pilot');
    ship.live = false;
    if (jump && !jump.done) jump.mid = arrive;
    else beginJump(arrive);
  }

  /* ---------- your year ---------- */
  function stopReview(): void {
    reviewing = false;
    hud.hideCaption();
  }
  function startReview(): void {
    if (!review) return;
    element('summary').hidden = true;
    showPanel(null);
    setScope(review.year);
    if (mode !== 'fly') setMode('fly');
    reviewing = true;
    nextBeat = 0;
    captionUntil = 0;
  }
  function updateCaption(): void {
    if (!reviewing || !review || !arrived || time < captionUntil) return;
    const beat = review.beats[nextBeat];
    if (beat && play >= beat.day) {
      hud.showCaption(beat.title, beat.detail);
      nextBeat++;
      captionUntil = time + CAPTION_SECONDS;
    } else {
      hud.hideCaption();
    }
  }

  function togglePlay(): void {
    if (mode !== 'fly') {
      setMode('fly');
      return;
    }
    paused = !paused;
    syncPlay();
  }

  /* ---------- picking in Orbit ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(at: { x: number; y: number }): void {
    if (mode !== 'orbit') return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((at.x - r.left) / r.width) * 2 - 1, -((at.y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const found = ray.intersectObject(towers, false).find((h) => (h.instanceId ?? Infinity) <= play);
    if (found?.instanceId === undefined) {
      shared.uHover.value = -1;
      hud.hideTip();
      return;
    }
    const i = found.instanceId;
    shared.uHover.value = i;
    hud.showTip(at.x, at.y, cal.formatDate(i), describeCount(counts[i]));
  }

  /* ---------- input ---------- */
  const shaped = (v: number) => {
    const a = Math.abs(v);
    return a < 0.06 ? 0 : Math.sign(v) * Math.pow((a - 0.06) / 0.94, 1.5);
  };
  const stickFrom = (x: number, y: number, ox: number, oy: number, reach: number) => {
    stick.set(shaped(clamp((x - ox) / reach, -1, 1)), shaped(clamp((y - oy) / reach, -1, 1)));
  };
  const setZoom = (factor: number) => {
    zoomGoal = nextZoom(zoomGoal, factor);
  };

  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && mode !== 'orbit') {
      const [a, b] = [...touches.values()];
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) setZoom(pinch / gap);
      pinch = gap;
      stick.set(0, 0);
      return;
    }
    if (mode === 'pilot') {
      if (e.pointerType === 'mouse') {
        if (!mouseSteer) return;
        const r = canvas.getBoundingClientRect();
        stickFrom(e.clientX, e.clientY, r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.5);
      } else if (pointer) {
        stickFrom(e.clientX, e.clientY, pointer.x, pointer.y, 95);
      }
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons) pickAt = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerleave', (e) => {
    pickAt = null;
    hud.hideTip();
    if (mode === 'orbit') shared.uHover.value = -1;
    if (e.pointerType === 'mouse') stick.set(0, 0);
  });
  canvas.addEventListener('pointerdown', (e) => {
    hud.hideTip();
    if (e.pointerType !== 'mouse') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinch = null;
    }
    if (mode !== 'pilot') return;
    if (e.pointerType === 'mouse') {
      firePointer = e.pointerId;
      firing = true;
    } else {
      canvas.setPointerCapture(e.pointerId);
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  });
  const release = (e: PointerEvent) => {
    const endsPinch = touches.size === 2 && touches.has(e.pointerId);
    touches.delete(e.pointerId);
    pinch = null;
    if (e.pointerId === pointer?.id || endsPinch) {
      pointer = null;
      stick.set(0, 0);
    }
    if (e.pointerId === firePointer) {
      firePointer = null;
      firing = false;
    }
    if (e.pointerId === dragPointer) {
      dragPointer = null;
      // Hands the keys back to the ship. Someone who tabbed to the timeline never gets here, so they keep it.
      hud.scrub.blur();
    }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  canvas.addEventListener('click', (e) => {
    if (mode === 'orbit') pickAt = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener(
    'wheel',
    (e) => {
      // Panels scroll themselves
      if ((e.target as Element).closest('.panel')) return;
      e.preventDefault();
      if (mode === 'orbit') {
        if (e.target !== canvas) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: e.deltaY, deltaMode: e.deltaMode, cancelable: true }));
        }
        return;
      }
      setZoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1) * 0.0016));
    },
    { passive: false },
  );
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') showPanel(null);
    const typing = e.target instanceof HTMLInputElement;
    if (e.code === 'Space' && !typing && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (mode === 'pilot') firing = true;
      else togglePlay();
      return;
    }
    if (e.code === 'KeyN' && !typing && !e.repeat && !e.metaKey && !e.ctrlKey) setSound(!sound.enabled);
    if (mode === 'pilot' && !typing && !e.metaKey && !e.ctrlKey) {
      if (e.code === 'KeyI' && !e.repeat) setInvert(!invertY);
      if (e.code === 'KeyM' && !e.repeat) setMouseSteer(!mouseSteer);
      keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  });
  document.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') firing = false;
  });

  (['fly', 'pilot', 'orbit'] as const).forEach((m) => {
    element(`m-${m}`).addEventListener('click', (e) => {
      setMode(m);
      (e.currentTarget as HTMLElement).blur();
    });
  });
  element('play').addEventListener('click', togglePlay);
  element('invert').addEventListener('click', (e) => {
    setInvert(!invertY);
    (e.currentTarget as HTMLElement).blur();
  });
  element('mouseSteer').addEventListener('click', (e) => {
    setMouseSteer(!mouseSteer);
    (e.currentTarget as HTMLElement).blur();
  });
  element('sound').addEventListener('click', (e) => {
    setSound(!sound.enabled);
    (e.currentTarget as HTMLElement).blur();
  });
  PANEL_NAMES.forEach((name) => {
    element(name).addEventListener('click', (e) => {
      showPanel(element(PANELS[name]).hidden ? name : null);
      // Space fires in Pilot, unless a button still has focus from the mouse. Keyboard users keep theirs.
      if (e.detail) (e.currentTarget as HTMLElement).blur();
    });
  });
  document.querySelectorAll('.panel-close').forEach((button) => {
    button.addEventListener('click', () => showPanel(null));
  });
  element('badgeReset').addEventListener('click', pressReset);
  element('colourReset').addEventListener('click', () => setColours(DEFAULT_COLOURS));
  element('summaryClose').addEventListener('click', () => {
    element('summary').hidden = true;
  });
  element('summaryShare').addEventListener('click', (e) => {
    const button = e.currentTarget as HTMLElement;
    void navigator.clipboard
      .writeText(`${location.origin}/${cal.login}${REVIEW_HASH}`)
      .then(() => {
        button.textContent = 'Copied';
      })
      .catch(() => {});
  });
  element('review').addEventListener('click', startReview);
  element('fire').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    firePointer = e.pointerId;
    firing = true;
  });
  hud.scrub.addEventListener('pointerdown', (e) => {
    dragPointer = e.pointerId;
  });
  hud.scrub.addEventListener('input', () => {
    const day = Number(hud.scrub.value);
    if (mode === 'fly' && flight) {
      arrived = true;
      jump = null;
      flight.s = lengthAtDay(flight, day);
    } else {
      playGoal = day;
    }
  });

  /* ---------- page setup ---------- */
  element('login').textContent = cal.login;
  const snapshot = new Date(`${cal.snapshot}T00:00:00Z`);
  const quiet = cal.total ? '' : 'No public contributions yet. ';
  element('note').textContent =
    `${quiet}Public GitHub contributions to ${snapshot.getUTCDate()} ${MONTHS[snapshot.getUTCMonth()]} ` +
    `${snapshot.getUTCFullYear()}. Not affiliated with GitHub.`;
  const chips = element('years');
  const addChip = (key: 'all' | number, text: string, total: number) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.key = String(key);
    button.setAttribute('aria-pressed', 'false');
    const count = document.createElement('small');
    count.textContent = total.toLocaleString('en-ZA').replace(/\s/g, ',');
    button.append(text, count);
    button.addEventListener('click', () => {
      stopReview();
      showPanel(null);
      setScope(key);
    });
    chips.append(button);
  };
  element('invert').setAttribute('aria-pressed', String(invertY));
  element('mouseSteer').setAttribute('aria-pressed', String(mouseSteer));
  element('mouseSteer').hidden = touch;
  element('sound').setAttribute('aria-pressed', String(sound.enabled));
  hud.renderColours(COLOUR_ROWS, (key, hex) => setColours({ ...colours, [key]: hex }));
  paintScene();
  drawBadges();
  void document.fonts.load('800 64px "Mona Sans"').then(() => {
    badges.repaint();
    drawBadges();
  });
  const credit = document.createElement('a');
  credit.href = 'https://sheetsolved.com';
  credit.textContent = 'A Sheet Solved project.';
  element('note').append(' ', credit);
  const previewing = location.hash === REVIEW_HASH;
  if (review && (previewing || new Date().getMonth() === 11)) {
    const button = element('review');
    button.textContent = reviewTitle(review.year);
    button.hidden = false;
  }
  addChip('all', 'All', cal.total);
  [...years].reverse().forEach((y) => addChip(y, String(y), cal.yearTotal(y)));

  /* ---------- loop ---------- */
  function resize(): void {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    camera.aspect = width / height;
    baseFov = width < height ? 74 : 58;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    hud.drawTimeline();
  }

  let last = performance.now();
  let frameAverage = 16;
  let frames = 0;
  let quality = 0;
  function adapt(ms: number): void {
    frameAverage = averageFrame(frameAverage, ms);
    if (++frames < 100 || frameAverage < SLOW_FRAME_MS || quality >= 2) return;
    quality++;
    frames = 0;
    frameAverage = 16;
    if (quality === 1 && pixelRatio > 1) {
      pixelRatio = 1;
      shared.uPx.value = 1;
      renderer.setPixelRatio(1);
      resize();
    } else {
      quality = 2;
      bloom.enabled = false;
    }
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const ms = now - last;
    last = now;
    // Frames can share a timestamp, and the first can even predate `last`. Neither has any time to simulate.
    if (ms <= 0) return;
    const dt = Math.min(0.05, ms / 1000);
    time += dt;
    shared.uTime.value = time;
    shared.uDim.value += (dimGoal - shared.uDim.value) * (1 - Math.exp(-5 * dt));
    zoom += (zoomGoal - zoom) * (1 - Math.exp(-7 * dt));
    contactCooldown -= dt;

    updateJump(dt);
    if (mode === 'fly') {
      updateFlight(dt);
    } else {
      play += (playGoal - play) * (1 - Math.exp(-7 * dt));
      if (mode === 'orbit') {
        if (glide) {
          const active = glide;
          active.t = Math.min(1, active.t + dt / 1.5);
          camera.position.lerpVectors(active.from, active.to, smooth(active.t));
          if (active.t >= 1) glide = null;
        }
        controls.target.lerp(orbitGoal, 1 - Math.exp(-3 * dt));
        controls.update();
      } else {
        updatePilot(dt);
      }
    }

    fighter.visible = aboard() && chaseDistance() > 0;
    element('canopy').toggleAttribute('hidden', !(aboard() && chaseDistance() === 0));

    if (firing && mode === 'pilot' && ship.live && weapons.fire(ship.pos, ship.fwd, fighter.quaternion)) sound.laser();
    weapons.update(
      dt,
      (p) => {
        const badge = badges.hit(p, play);
        if (badge) {
          earn(badge);
          return -1;
        }
        if (p.y < PLINTH) return -1;
        const day = towerAt(p);
        return day >= 0 ? day : null;
      },
      (day, at) => {
        sound.impact(at.distanceTo(camera.position));
        if (day < 0) return;
        shared.uHit.value = day;
        hitGlow = 1;
      },
    );
    sound.engine(mode === 'pilot' && ship.live ? ship.speed / BOOST : null);

    const moving = aboard() && !(mode === 'fly' && paused);
    world.dustVelocity.copy(ship.vel).multiplyScalar(moving ? 1 : 0);
    world.dust.visible = moving;
    shared.uWarp.value = warp;
    world.warpLines.visible = warp > 0.01;
    const fov = baseFov + (moving ? clamp((ship.vel.length() - 18) / 28, 0, 1) * 10 : 0) + warp * 50;
    if (Math.abs(fov - camera.fov) > 0.02) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-8 * dt));
      camera.updateProjectionMatrix();
    }

    shake = Math.max(0, shake - dt * 2.6);
    if (shake > 0)
      camera.position.add(
        v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.5),
      );
    redAlert = Math.max(0, redAlert - dt * 2.4);
    finish.uniforms.uRed.value = redAlert;
    hitGlow = Math.max(0, hitGlow - dt * 2.8);
    shared.uHitGlow.value = hitGlow;
    shared.uPlay.value = play;
    victoryRoll = Math.max(0, victoryRoll - dt * VICTORY_ROLL);

    badges.update(time, play);
    blasts.forEach((blast) => blast.update(dt, camera));
    fireworks.update(dt);
    updateCaption();
    world.followCamera(camera);
    camera.updateMatrixWorld();
    updateTargeting();
    hud.update(play);
    if (pickAt) {
      pick(pickAt);
      pickAt = null;
    }
    composer.render(dt);
    adapt(ms);
  }

  new ResizeObserver(resize).observe(stage);
  new ResizeObserver(() => hud.drawTimeline()).observe(element('timeline'));
  resize();
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
  setScope('all');
  setMode(reduced ? 'orbit' : 'fly', 1.5);
  if (reduced) controls.autoRotate = false;
  if (previewing && review) startReview();
  requestAnimationFrame(frame);

  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    Object.assign(window, {
      __city: {
        camera,
        ship,
        controls,
        weapons,
        fighter,
        shared,
        cal,
        map,
        towerAt,
        badges,
        blasts,
        fireworks,
        sound,
        endFlight,
        visitBadge,
        stick,
        get firing() {
          return firing;
        },
        get mode() {
          return mode;
        },
        get zoom() {
          return zoom;
        },
        get play() {
          return play;
        },
        get jump() {
          return jump;
        },
      },
    });
  }
}
