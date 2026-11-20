import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Contributions } from '../shared/contract';
import { holdsLock, lockOn } from './aim';
import { APP_NAME } from './brand';
import { BADGE_RADIUS, Badges } from './badges';
import { Blast } from './blast';
import { Calendar, describeCount, formatCount, MONTHS } from './calendar';
import { pushOut } from './collision';
import { COLOUR_ROWS, DEFAULT_COLOURS, EDITION_COLOURS, readColours, towerPalette, type Colours } from './colours';
import { Environment } from './environment';
import { takeArrival, writtenDay, type Explorer } from './explorer';
import { buildFighter, EDITION_SHIP, readShip, SHIP_LABELS, SHIPS, Weapons, type Ship } from './fighter';
import { FINALE_SECONDS, Fireworks } from './fireworks';
import { Hud, type Scope } from './hud';
import { Flashes } from './lights';
import { CityMap, DEPTH, PLINTH, TOWER, WIDTH } from './map';
import { chooseMarkers, Markers, placeMarker, SpotMarker, type Insets, type Placed } from './markers';
import { findMilestones, type Milestone } from './milestones';
import { averageFrame, countedFrame, tooSlow } from './quality';
import { reviewFacts, reviewSeason, reviewTitle, reviewYear, type YearReview } from './review';
import { buildRoute, lengthAtDay, newPose, poseAt, RISE, type Route } from './routes';
import { formatClock, formatLap, Run } from './run';
import { FINISH_FRAGMENT, FINISH_VERTEX } from './shaders';
import { definesFor, LOOKS, pixelSize, readSkin, SKINS, type Skin } from './skins';
import { approachHeight, blockedBetween, clearReach, towerAlong } from './sight';
import { Sound, stereo } from './sound';
import { DoubleTap, EDGE_TURN, keyTurn, ON_EDGE, ROLL_SECONDS, rollDrift, rollSpin } from './steering';
import { Trails } from './trails';
import { createWorld, SETTLED_OFFSET } from './world';
import { COCKPIT_BELOW, nextZoom } from './zoom';
import { fitCockpit } from './cockpits';
import { POWERS, speedKept } from './powers';
import { Gates } from './gates';
import { multiplier, NearMisses } from './near';
import { addYear, stamp } from './passport';
import {
  buildCourse,
  challengeHash,
  ghostAt,
  Race,
  RaceRecords,
  raceYears,
  readChallenge,
  readGhost,
  Recorder,
  saveGhost,
  today,
  type Challenge,
  type Course,
  type GhostPose,
  type Track,
} from './race';
import { RaceHud, type Readout } from './race-hud';

type Mode = 'fly' | 'pilot' | 'orbit';

const JUMP_SECONDS = 1.5;
const SHIP_RADIUS = 0.3;
const FLOOR = 0.7;
const CHASE_DISTANCE = 2.4;
/** How far below the route ahead the autopilot looks, per unit of altitude, so the view tips down onto the roofs. */
const LOOK_DOWN = 0.15;
const MAX_LOOK_DOWN = 2;
/** The autopilot's view leans where its route asks once the screen is this much wider than tall, and fully from here. */
const LEAN_FROM = 0.75;
const LEAN_FULL = 1.5;
const INVERT_KEY = 'contriscape:invert-y';
const MOUSE_KEY = 'contriscape:mouse-steer';
const SOUND_KEY = 'contriscape:sound';
const MUSIC_KEY = 'contriscape:music';
const COLOUR_KEY = 'contriscape:colours';
const SKIN_KEY = 'contriscape:skin';
const SHIP_KEY = 'contriscape:ship';
/**
 * A ship picked in Settings is held this close to the camera and drawn this much smaller. It looks the size it would
 * at 3.2 units, and is nearer than a tower can be to a camera the ship's own hull keeps off the walls, so nothing in
 * the city can stand in front of it.
 */
const SHOWROOM_DISTANCE = 0.6;
const SHOWROOM_SCALE = SHOWROOM_DISTANCE / 3.2;
/** Towers closer than this to the ship's line rush past with a whoosh. Under CELL, as `towersNear` needs. */
const WHOOSH_REACH = 1.9;
/** A tower that has just whooshed stays quiet this long, so one tower is one whoosh. */
const WHOOSH_AGAIN = 1;
/** Pixels between markers, so they don't sit on one another. Markers in view are smaller and need half. */
const MARKER_ROOM = 44;
/** The way back is marked once the ship is this far outside the city with no badge left to lead it there. */
const HOME_BEYOND = 40;
/** The marker for the way back points at the nearest edge of the city, this far up its towers. */
const HOME_HEIGHT = 6;
/** How far the ship flies after a jump from the Badges list before a badge it shoots counts as one it flew to. */
const FLOWN_AFTER = 120;
/** Badges out of view that get a marker at the edge, nearest first. */
const EDGE_MARKERS = 4;
/** Pixels from the side of the view to a pinned marker's centre: half its artwork, its pointer, and a margin. */
const PINNED_SIDE = 50;
const REVIEW_HASH = '#your-year';
const CAPTION_SECONDS = 4;
const BADGE_APPROACH = 10;
/** How long the offer of the controls stays up after an Autopilot flight ends. */
const OFFER_SECONDS = 15;
/** How long a city picked from Explore says whose it is. */
const ARRIVAL_SECONDS = 12;
/** How far ahead of the ship a tower can be read by aiming at it. */
const AIM_RANGE = 95;
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
/** Fine grain over the finished frame, enough to break up banding in the dark sky. */
const GRAIN = 0.022;
/** How far the chase camera drops back on full boost, as a share of its distance. */
const BOOST_PULL = 0.3;
/** The largest city a single view frames well. Older years sit behind the opening camera. */
const FRAMED_DEPTH = 189;
/** How far either side of a race's line the ship and the rival start, so neither sits inside the other. */
const START_SIDE = 0.9;
/** The rival eases onto the line over this much of the course. */
const MERGE = 25;
/** The rival flies another design in colours of its own, so it is never taken for the ship. */
const RIVAL_COLOURS: Colours = { ...DEFAULT_COLOURS, hull: '#3b414c', trim: '#ff5a5f' };
const GHOST_OPACITY = 0.32;
/** How long "Go" stays up once a race starts. */
const GO_SECONDS = 0.8;
/** Seconds a year's flight opens on its number, over its empty block, before the jump in. */
const OPENER_SECONDS = 4.5;
/** A year's flight goes at this share of Autopilot's pace, so each of its moments has time. */
const REVIEW_PACE = 0.8;
/** Seconds of fireworks before a year's closing card comes up. */
const CARD_AFTER = 2.6;

const rivalFor = (mine: Ship): Ship => (mine === 'dart' ? 'interceptor' : 'dart');
/** The keys that steer left and right, which a double tap turns into a barrel roll that way. */
const SIDES: Partial<Record<string, -1 | 1>> = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1 };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (k: number) => k * k * (3 - 2 * k);
const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Each panel, by the id of the button that opens it. */
const PANELS = {
  explore: 'explorePanel',
  year: 'yearPanel',
  race: 'racePanel',
  badges: 'badgePanel',
  settings: 'settingsPanel',
  guide: 'guidePanel',
};
type Panel = keyof typeof PANELS;
const PANEL_NAMES = Object.keys(PANELS) as Panel[];

/** A saved choice as it was stored, or `null` with nothing saved or storage blocked. */
function recallText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

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

/**
 * Builds the city and starts the render loop. Throws if WebGL is unavailable. `example` is for the city on the site's
 * front page, which the visitor didn't ask for by name, so the first hint says what it is. `explorer` is the Explore
 * panel, which is on the page before there is a city and is handed over here.
 */
export function startApp(
  data: Contributions,
  example: boolean,
  explorer: Explorer,
  linkedYear: number | null = null,
): void {
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
  if (reduced) world.calm();
  const { scene, shared, towers } = world;
  shared.uPx.value = pixelRatio;

  let shipModel = readShip(recallText(SHIP_KEY));
  let power = POWERS[shipModel];
  let readCockpit = fitCockpit(element('canopy'), shipModel);
  const craft = buildFighter(shipModel);
  const fighter = craft.group;
  scene.add(fighter);
  // A race's rival, and the ghost of the fastest run on its course with this ship
  const rival = buildFighter(rivalFor(shipModel));
  rival.paint(RIVAL_COLOURS);
  scene.add(rival.group);
  const ghost = buildFighter(shipModel);
  ghost.fade(GHOST_OPACITY);
  scene.add(ghost.group);
  scene.add(new THREE.AmbientLight(0x8fa6c0, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0e0, 1.5);
  sun.position.set(-0.5, 0.8, 0.6);
  scene.add(sun);
  const environment = new Environment(renderer, (map) => [craft, rival, ghost].forEach((each) => each.reflect(map)));
  const weapons = new Weapons(scene, Math.random, shared.uPx);
  const trails = new Trails(scene);
  const flashes = new Flashes();
  const badges = new Badges(scene, map, findMilestones(cal), cal.login, shared);
  const blasts = Array.from({ length: BLASTS }, () => new Blast(scene, Math.random));
  const fireworks = new Fireworks(scene, shared.uPx, Math.random);
  const sound = new Sound(recall(SOUND_KEY, true), recall(MUSIC_KEY, true), {
    counts: cal.counts,
    peak: map.fullCount,
  });
  const markers = new Markers(
    element('markers'),
    badges.milestones.map((_, i) => badges.picture(i)),
    badges.milestones.map((m) => m.name),
  );
  const home = new SpotMarker(element('markers'), 'home', 'The city');
  const gateMarker = new SpotMarker(element('markers'), 'gate', 'Next gate');
  const run = new Run(badges.milestones.length > 0 && badges.earned.size === 0);
  const raceList = raceYears(cal);
  const records = new RaceRecords(cal.login);
  const courses = new Map<number, Course>();
  const raceHud = new RaceHud();
  const gates = new Gates(scene);

  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: pixelRatio < 2 ? 4 : 2 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.6, 0.74);
  composer.addPass(bloom);
  const finish = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uFlash: { value: 0 },
      uRed: { value: 0 },
      uSpeed: { value: 0 },
      uTime: { value: 0 },
      uGrain: { value: GRAIN },
      uGrid: { value: new THREE.Vector2(1, 1) },
    },
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
  /** The year being flown in Your year, or last flown. */
  let review: YearReview | null = null;
  /** The camera's slow push in on a year's block while its number is up, or null. */
  let opening: { from: THREE.Vector3; to: THREE.Vector3; aim: THREE.Vector3; t: number } | null = null;
  /** The day the caption on screen is about, which stays lit while it's up, or -1. */
  let beatDay = -1;
  let summaryTimer = 0;
  /** Set while a change of mode is part of a year's flight, which keeps the year's edition on through it. */
  let keepEdition = false;
  let shake = 0;
  let redAlert = 0;
  let hitGlow = 0;
  let victoryRoll = 0;
  /** Until this time the chase camera looks level, so the fireworks over a cleared city are in view. */
  let finaleUntil = 0;
  /** How far into a boost the ship is, from 0 at cruise to 1 at full speed. */
  let surge = 0;
  /** The ship's bank this frame, for the vapour off its wingtips. */
  let bankNow = 0;
  let speedFx = true;
  /** Flashes lighting the towers, which a slow GPU goes without. */
  let lightsOn = true;
  /** The badge the targeting computer is locked on to, or -1. */
  let locked = -1;
  /** How far the ship has flown since a jump from the Badges list. Far enough, and a badge it shoots was flown to. */
  let sinceJump = Infinity;
  /** Whether the next hint introduces the example city, before the controls. */
  let introduce = example;
  let boostHeld = false;
  let boostPointer: number | null = null;
  let brakeHeld = false;
  let brakePointer: number | null = null;
  let offerTimer = 0;
  let arrivalTimer = 0;
  /** The card for a city picked from Explore is up, and its seconds haven't started counting. */
  let arrivalWaiting = false;
  let wasBoosting = false;
  let touchedTower = -1;
  /** When each nearby tower last whooshed past. */
  const passed = new Map<number, number>();
  let firing = false;
  /** A barrel roll under way, to the left (-1) or right (1), and how far through it is, from 0 to 1. */
  let roll: { side: -1 | 1; t: number } | null = null;
  const taps = new DoubleTap();
  /** Whether the ship is flying on its side, from the up key held with a direction. */
  let onEdge = false;
  /** The race being flown, or null. Its near misses and the run recorded for its ghost go with it. */
  let race: Race | null = null;
  let near = new NearMisses();
  let recorder = new Recorder();
  let ghostTrack: Track | null = null;
  /** The challenge or day's course the race being flown answers, if any. */
  let raceFrom: Challenge | null = null;
  /** The challenge this page was opened with, which the Race panel marks. */
  let challenge: Challenge | null = null;
  /** The last race finished, for racing it again or sending it as a challenge. */
  let lastResult: { year: number; time: number; ship: Ship; from: Challenge | null } | null = null;
  /** Whether a race's result is up. The ship waits under it, as it does under a panel. */
  let resultUp = false;
  let goUntil = 0;
  /** Where the ship was at the start of this frame, to tell whether it flew through a gate. */
  const lastPos = new THREE.Vector3();
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
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const m1 = new THREE.Matrix4();
  const e1 = new THREE.Euler(0, 0, 0, 'YXZ');
  const here = newPose();
  const nose = newPose();
  const behind = newPose();
  const ahead = newPose();
  const rivalPose = newPose();
  const rivalNose = newPose();
  const ghostPose: GhostPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0 };

  const viewFor = (): THREE.Vector3 => {
    if (scope.key === 'all') return LANDING;
    return new THREE.Vector3(WIDTH / 2 + 30, 68, map.blockZ(scope.key) + DEPTH / 2 + 118);
  };
  /**
   * Where a year's flight opens and closes: low in front of its block and looking across it, so the sky above shows,
   * with its aurora, and the fireworks have somewhere to burst. `aim` is the point the camera looks at.
   */
  const stageFor = (year: number) => ({
    at: new THREE.Vector3(WIDTH / 2 + 20, 26, map.blockZ(year) + DEPTH / 2 + 120),
    aim: new THREE.Vector3(WIDTH / 2, 12, map.blockZ(year) + DEPTH / 2),
  });
  const focusFor = (): THREE.Vector3 =>
    scope.key === 'all' ? CENTRE : new THREE.Vector3(WIDTH / 2, 4, map.blockZ(scope.key) + DEPTH / 2);

  const aboard = () => (mode === 'pilot' ? ship.live : mode === 'fly' && arrived);
  const standing = (i: number) =>
    i <= play || i > shared.uMax.value ? map.top[i] : PLINTH + (map.top[i] - PLINTH) * 0.04;
  const chaseDistance = () => (zoom < COCKPIT_BELOW ? 0 : CHASE_DISTANCE * zoom * (1 + BOOST_PULL * surge));

  const towerAt = (p: THREE.Vector3): number => map.towerAt(p.x, p.y, p.z, standing);

  /** The chase position: eases in when a tower gets in the way and back out slowly, so the view never steps. */
  function chasePoint(ship: THREE.Vector3, wanted: THREE.Vector3, dt: number, out: THREE.Vector3): THREE.Vector3 {
    const clear = clearReach(map, standing, ship, wanted);
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
    bankNow = pt.roll;

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
    // The view leans towards the city where the route asks, by as much as the screen has width for. Upright on a phone
    // it has none, and the ship would be pushed out of the side of the view.
    const lean = pt.lean * clamp((camera.aspect - LEAN_FROM) / (LEAN_FULL - LEAN_FROM), 0, 1);
    if (lean) v3.sub(v1).applyAxisAngle(UP, -lean).add(v1);
    // The route is already smooth, so the camera rides it exactly. Filtering again would add lag that shifts with frame time.
    aimCamera(v1, v3, pt.roll * (d > 0 ? 0.3 : 0.6), dt, Infinity, 6);
  }
  function updateFlight(dt: number): void {
    if (!flight) return;
    if (!arrived) {
      if (holdSeconds > 0) {
        if (!paused) holdSeconds -= dt;
        if (opening && !paused) {
          opening.t = Math.min(1, opening.t + dt / OPENER_SECONDS);
          camera.position.lerpVectors(opening.from, opening.to, smooth(opening.t));
          camera.lookAt(opening.aim);
        }
        return;
      }
      if (!jump) {
        opening = null;
        hud.hideOpener();
        beginJump(() => {
          arrived = true;
          snap = true;
        }, true);
      }
      return;
    }
    if (!paused && !dragging() && !(jump && jump.t < 0.5)) {
      flight.s += poseAt(flight, flight.s, here).pace * dt * (reviewing ? REVIEW_PACE : 1);
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
    const finished = reviewing ? review : null;
    const stage = finished ? stageFor(finished.year) : null;
    camera.position.copy(stage?.at ?? viewFor());
    camera.lookAt(stage?.aim ?? (scope.key === 'all' ? LANDING_AIM : focusFor()));
    // The year's edition stays on for its fireworks and its card
    keepEdition = finished !== null;
    setMode('orbit');
    keepEdition = false;
    if (finished) closeYear(finished);
    else offerControls();
  }
  /** A year's flight ends with fireworks over its block, and then its card. */
  function closeYear(year: YearReview): void {
    const card = () => hud.showSummary(reviewTitle(year.year), cal.login, year.total, reviewFacts(year, cal));
    sound.fanfare();
    if (reduced) {
      card();
      return;
    }
    const shells = fireworks.start(camera, towerPalette((edition ? EDITION_COLOURS : colours).towers).ramp[3]);
    sound.fireworks(shells);
    for (const { at: burst, centre, colour } of shells) {
      const [r, g, b] = colour.map((v) => v * 1.4);
      flashes.add({ x: centre.x, y: centre.y, z: centre.z, r, g, b, reach: 95, start: time + burst, life: 0.9 });
    }
    clearTimeout(summaryTimer);
    summaryTimer = window.setTimeout(card, CARD_AFTER * 1000);
  }
  /** After watching a flight is the moment to offer one. The offer goes when it's taken, or another mode is. */
  function offerControls(): void {
    element('offer').hidden = false;
    offerTimer = window.setTimeout(withdrawOffer, OFFER_SECONDS * 1000);
  }
  function withdrawOffer(): void {
    clearTimeout(offerTimer);
    element('offer').hidden = true;
  }
  /** A city picked from Explore opens by saying whose it is, until the visitor does something else. */
  function greet(from: string): void {
    hud.showArrival(from, data.name ?? data.login, data.profile?.bio ?? null);
    arrivalWaiting = true;
  }
  /**
   * The card's seconds count from the end of the jump that opens a flight, called each frame until then. Nobody reads
   * through the flash, and on a slow machine the wait and the jump can outlast the card.
   */
  function timeArrival(): void {
    if (!arrivalWaiting || jump || (mode === 'fly' && !arrived)) return;
    arrivalWaiting = false;
    arrivalTimer = window.setTimeout(withdrawArrival, ARRIVAL_SECONDS * 1000);
  }
  function withdrawArrival(): void {
    arrivalWaiting = false;
    clearTimeout(arrivalTimer);
    hud.hideArrival();
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
    // Any contact loses a race's chain of near misses, however soon it comes after the last
    if (race?.phase === 'racing' && near.clip(day) > 0) raceHud.lost();
    if (contactCooldown > 0) return;
    contactCooldown = 0.35;
    ship.speed *= speedKept(power, headOn);
    sound.bump(headOn);
    if (!reduced) shake = headOn ? 1 : 0.45;
    redAlert = headOn ? 1 : 0.5;
    shared.uHit.value = day;
    hitGlow = 1;
  }
  /** Towers rushing past the ship each whoosh on their own side, louder the faster and closer they go by. */
  function whooshPast(speed: number): void {
    if (speed < 8) return;
    map.towersNear(ship.pos.x, ship.pos.z, WHOOSH_REACH, (i) => {
      // Walls beside the ship, not roofs it flies over
      if (standing(i) < ship.pos.y - 0.4) return;
      const last = passed.get(i);
      if (last !== undefined && time - last < WHOOSH_AGAIN) return;
      passed.set(i, time);
      const dx = map.cx[i] - ship.pos.x;
      const dz = map.cz[i] - ship.pos.z;
      const gap = Math.hypot(dx, dz);
      // The ship's right is (-fwd.z, fwd.x) on the ground
      const side = (dz * ship.fwd.x - dx * ship.fwd.z) / Math.max(gap, 0.01);
      const close = 1 - clamp((gap - TOWER / 2 - 0.3) / 1.6, 0, 1);
      sound.whoosh(side * 0.85, clamp((speed - 8) / 28, 0, 1) * (0.35 + 0.65 * close));
    });
    if (passed.size > 64) {
      for (const [day, at] of passed) if (time - at > WHOOSH_AGAIN) passed.delete(day);
    }
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
    // The up key held with a direction puts the ship on its side, and pulls it round that way instead of climbing
    onEdge = up && !down && turning !== 0;
    if (onEdge) sy = 0;
    const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight') || boostHeld;
    if (boosting) parkedUntil = 0;
    if (boosting && !wasBoosting && !panelOpen) sound.ignite();
    wasBoosting = boosting;
    // Holds steady at a badge. Lining up the shot extends the hold, because moving off would overshoot the badge.
    if (aiming && time < parkedUntil && (turning || climbing)) parkedUntil = time + PARKED_SECONDS;
    // An open panel stops the ship, so nothing goes wrong while the mouse is busy with it. A race's countdown and its
    // result hold it too.
    const waiting = panelOpen || resultUp || race?.phase === 'countdown';
    const holding = waiting || time < parkedUntil;
    if (waiting) {
      sx = 0;
      sy = 0;
      onEdge = false;
      roll = null;
    }
    ship.yaw -= sx * 2 * power.turn * (onEdge ? EDGE_TURN : 1) * dt;
    ship.pitch = clamp(ship.pitch - sy * 1.5 * power.turn * dt, -1.3, 1.3);
    const braked = power.hover ? 0 : BRAKE;
    const wanted = holding ? 0 : boosting ? BOOST * power.boost : keys.has('KeyC') || brakeHeld ? braked : CRUISE;
    ship.speed += (wanted - ship.speed) * (1 - Math.exp(-2.4 * dt));
    sinceJump += ship.speed * dt;

    q1.setFromEuler(e1.set(ship.pitch, ship.yaw, 0, 'YXZ'));
    ship.quat.copy(q1);
    ship.fwd.set(0, 0, -1).applyQuaternion(q1);
    v2.set(0, (keys.has('KeyE') ? 8 : 0) - (keys.has('KeyQ') ? 8 : 0), 0);
    ship.slide.lerp(v2, 1 - Math.exp(-7 * dt));
    v2.copy(ship.slide).applyQuaternion(q1);
    ship.vel.copy(ship.fwd).multiplyScalar(ship.speed).add(v2);
    // A barrel roll carries the ship one alley across, level with the ground whatever its pitch
    let spin = 0;
    if (roll) {
      roll.t = Math.min(1, roll.t + dt / ROLL_SECONDS);
      v2.set(-ship.fwd.z, 0, ship.fwd.x);
      if (v2.lengthSq() > 1e-6) ship.vel.addScaledVector(v2.normalize(), roll.side * rollDrift(roll.t));
      // The ship's right wing goes down for a roll to the right, as it does in a right turn
      spin = -roll.side * rollSpin(roll.t);
      if (roll.t >= 1) roll = null;
    }

    // Small steps, so a boosting ship can't jump a tower on a slow frame
    const steps = Math.ceil((ship.vel.length() * dt) / 0.35);
    for (let n = 0; n < steps; n++) {
      ship.pos.addScaledVector(ship.vel, dt / steps);
      ship.pos.y = clamp(ship.pos.y, FLOOR, 190);
      pushOut(map, standing, ship, SHIP_RADIUS, bump);
    }
    // The street stops a dive, and levelling off keeps the guns pointing along it instead of into it
    if (ship.pos.y <= FLOOR) ship.pitch = Math.max(0, ship.pitch);
    ship.pos.x = clamp(ship.pos.x, -300, WIDTH + 300);
    ship.pos.z = clamp(ship.pos.z, -300, map.depth + 300);

    const bankGoal = onEdge ? -Math.sign(turning) * ON_EDGE : -sx * 1.05;
    ship.bank += (bankGoal - ship.bank) * (1 - Math.exp(-5 * dt));
    bankNow = ship.bank;
    fighter.position.copy(ship.pos);
    fighter.quaternion.copy(ship.quat).multiply(q2.setFromAxisAngle(ROLL_AXIS, ship.bank + victoryRoll + spin));

    const d = chaseDistance();
    v3.copy(ship.pos).addScaledVector(ship.fwd, 9);
    if (time < finaleUntil) v3.y = Math.max(v3.y, ship.pos.y + 1.5);
    if (d > 0) {
      v2.copy(ship.pos).addScaledVector(ship.fwd, -d);
      v2.y += 0.2 * d + 0.12;
      chasePoint(ship.pos, v2, dt, v1);
    } else {
      v1.copy(ship.pos);
    }
    // The chase view stays near level through a roll. From the cockpit the city turns over, unless motion is reduced.
    aimCamera(v1, v3, d > 0 ? ship.bank * 0.4 : ship.bank * 0.8 + (reduced ? 0 : spin), dt);
  }
  /** Starts a barrel roll to one side, from a double tap of that direction. */
  function startRoll(side: -1 | 1): void {
    if (!ship.live || roll || panelOpen || resultUp || race?.phase === 'countdown' || (jump && jump.t < 0.5)) return;
    roll = { side, t: 0 };
    sound.whoosh(side * 0.6, 0.9);
  }

  /* ---------- targeting computer ---------- */
  const reticle = element('reticle') as unknown as SVGSVGElement;
  const bracket = element('bracket');
  const lock = element('lock');
  const badgeLock = element('badgeLock');
  const sight = new THREE.Vector3();
  const across = new THREE.Vector3();
  const targets: (THREE.Vector3 | null)[] = badges.milestones.map(() => null);
  let insets: Insets = { top: 80, right: 24, bottom: 140, left: 24 };
  /** The frame markers out of view are pinned to, with room at the sides for their pointers. */
  let pinned: Insets = insets;
  /** On a phone in Pilot, the corner the Fire and Boost buttons fill, and the narrower frame that keeps clear of it. */
  let buttons: { left: number; top: number; frame: Insets } | null = null;

  /** Left or right of the camera, for stereo. */
  function stereoFor(p: THREE.Vector3): number {
    across.setFromMatrixColumn(camera.matrixWorld, 0);
    sight.subVectors(p, camera.position);
    return stereo(sight.dot(across), sight.length());
  }
  /** Whether a tower stands between the ship and a point. */
  const blockedTo = (p: THREE.Vector3): boolean => blockedBetween(map, standing, ship.pos, p);
  /** The badge to lock on to: standing, near the line of fire and in range, with no tower in the way. Or -1. */
  function findLock(): number {
    if (!(mode === 'pilot' && ship.live && !(jump && jump.t < 0.5))) return -1;
    badges.milestones.forEach((_, i) => {
      targets[i] = badges.isStanding(i, play) ? badges.position(i) : null;
    });
    const held = locked >= 0 ? targets[locked] : null;
    if (held && holdsLock(ship.pos, ship.fwd, held, power.lock) && !blockedTo(held)) return locked;
    const found = lockOn(ship.pos, ship.fwd, targets, power.lock);
    return found >= 0 && !blockedTo(badges.position(found)) ? found : -1;
  }
  /**
   * The space the header and deck take, which markers keep out of, with room for a pinned marker's artwork and
   * distance. Measured when the layout changes.
   */
  function measureInsets(): void {
    const header = Math.max(
      element('lookup').getBoundingClientRect().bottom,
      element('m-pilot').getBoundingClientRect().bottom,
    );
    const deck = element('date').getBoundingClientRect().top;
    insets = { top: header + 34, right: 24, bottom: Math.max(80, stage.clientHeight - deck + 40), left: 24 };
    // A pinned marker's pointer reaches past its artwork, so the sides keep room for it
    pinned = { ...insets, left: PINNED_SIDE, right: PINNED_SIDE };
    const fire = element('fire');
    if (fire.hidden) {
      buttons = null;
      return;
    }
    // Clear of the artwork across, and of the distance under it, which reaches furthest down
    const left = element('brake').getBoundingClientRect().left - MARKER_ROOM / 2;
    const top = element('boost').getBoundingClientRect().top - MARKER_ROOM;
    buttons = { left, top, frame: { ...pinned, right: stage.clientWidth - left + PINNED_SIDE } };
  }
  /** Where a marker out of view is pinned: at the edge of the view, unless that's on the phone's Fire or Boost button. */
  function pin(ndcX: number, ndcY: number, behind: boolean, width: number, height: number): Placed {
    const edge = placeMarker(ndcX, ndcY, behind, width, height, pinned);
    if (!buttons || edge.x < buttons.left || edge.y < buttons.top) return edge;
    return placeMarker(ndcX, ndcY, behind, width, height, buttons.frame);
  }
  /**
   * Markers over the badges still standing, in Pilot, pinned to the edge for any out of view. Where markers would
   * overlap, the nearest badge keeps its marker, and only the few nearest out of view get one, so the edge stays readable.
   */
  function updateMarkers(): void {
    if (!(mode === 'pilot' && ship.live && !(jump && jump.t < 0.5))) {
      markers.hideAll();
      home.place(null, 0);
      gateMarker.place(null, 0);
      return;
    }
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    // In a race, the one marker is on the gate to fly through next
    if (race) {
      markers.hideAll();
      home.place(null, 0);
      const { at } = race.course.gates[race.next];
      const behind = sight.copy(at).applyMatrix4(camera.matrixWorldInverse).z > 0;
      sight.copy(at).project(camera);
      const placed = placeMarker(sight.x, sight.y, behind, width, height, insets);
      gateMarker.place(placed.inside ? placed : pin(sight.x, sight.y, behind, width, height), ship.pos.distanceTo(at));
      return;
    }
    gateMarker.place(null, 0);
    const candidates = badges.milestones
      .map((_, i) => {
        if (!badges.isStanding(i, play) || i === locked) return null;
        const at = badges.position(i);
        const behind = sight.copy(at).applyMatrix4(camera.matrixWorldInverse).z > 0;
        sight.copy(at).project(camera);
        const placed = placeMarker(sight.x, sight.y, behind, width, height, insets);
        return {
          i,
          placed: placed.inside ? placed : pin(sight.x, sight.y, behind, width, height),
          distance: ship.pos.distanceTo(at),
        };
      })
      .filter((c) => c !== null);
    const shown = new Set<number>();
    for (const { i, placed, distance } of chooseMarkers(candidates, MARKER_ROOM, EDGE_MARKERS)) {
      shown.add(i);
      markers.place(i, placed, distance);
    }
    badges.milestones.forEach((_, i) => {
      if (!shown.has(i)) markers.place(i, null, 0);
    });

    // Badge markers lead back to the city. With none left, a ship that has flown clear of it is shown the way.
    const beyond = candidates.length || locked >= 0 ? 0 : map.outside(ship.pos.x, ship.pos.z);
    if (beyond <= HOME_BEYOND) {
      home.place(null, 0);
      return;
    }
    across.set(clamp(ship.pos.x, 0, WIDTH), HOME_HEIGHT, clamp(ship.pos.z, 0, map.depth));
    const behind = sight.copy(across).applyMatrix4(camera.matrixWorldInverse).z > 0;
    sight.copy(across).project(camera);
    const placed = placeMarker(sight.x, sight.y, behind, width, height, insets);
    home.place(placed.inside ? placed : pin(sight.x, sight.y, behind, width, height), beyond);
  }
  function updateTargeting(): void {
    const flying = aboard() && !(jump && jump.t < 0.5);
    reticle.toggleAttribute('hidden', !flying);
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (flying) {
      v2.copy(ship.pos).addScaledVector(ship.fwd, 30).project(camera);
      reticle.style.transform = `translate(${((v2.x + 1) / 2) * width}px,${((1 - v2.y) / 2) * height}px)`;
    }

    const target = findLock();
    if (target !== locked) {
      if (target >= 0) {
        sound.lock();
        (badgeLock.lastElementChild as HTMLElement).textContent = badges.milestones[target].name;
      }
      locked = target;
    }
    badgeLock.hidden = locked < 0;
    reticle.classList.toggle('locked', locked >= 0);
    if (locked >= 0) {
      const at = badges.position(locked);
      // The corners close round the badge as it looks on screen
      const wide = (BADGE_RADIUS / (at.distanceTo(camera.position) * Math.tan((camera.fov * Math.PI) / 360))) * height;
      badgeLock.style.setProperty('--size', `${clamp(wide + 18, 44, 220).toFixed(0)}px`);
      v2.copy(at).project(camera);
      badgeLock.style.transform = `translate(${((v2.x + 1) / 2) * width}px,${((1 - v2.y) / 2) * height}px)`;
      // A locked badge is the target, so the tower readout behind it steps aside
      bracket.hidden = lock.hidden = true;
      shared.uHover.value = -1;
      return;
    }

    // A race has its gates to look at, so towers aren't read out during one
    const i = flying && !race ? towerAlong(map, standing, ship.pos, ship.fwd, AIM_RANGE) : -1;
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
      ? 'Drag to steer · Pinch to zoom · Follow the gold markers and shoot the badges'
      : 'WASD or arrows steer · Space fires · Shift boost · C brake · Gold markers lead to badges',
    orbit: touch ? 'Drag to rotate · Pinch to zoom' : 'Drag to rotate · Scroll to zoom',
  };
  function showHint(m: Mode): void {
    const hint = element('hint');
    const introducing = introduce;
    introduce = false;
    hint.textContent = introducing
      ? `Example city: ${cal.login}. Enter a GitHub username to fly another, or find one in Explore.`
      : HINTS[m];
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      // The controls follow the introduction, for whichever way of flying is on by then
      if (introducing) showHint(mode);
      else hint.hidden = true;
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
    withdrawOffer();
    withdrawArrival();
    withdrawChallenge();
    endRace();
    closeResult();
    clearTimeout(summaryTimer);
    if (!keepEdition) {
      undressEdition();
      element('summary').hidden = true;
    }
    if (next !== 'fly') stopReview();
    mode = next;
    glide = null;
    controls.enabled = next === 'orbit';
    (['fly', 'pilot', 'orbit'] as const).forEach((m) =>
      element(`m-${m}`).setAttribute('aria-pressed', String(m === next)),
    );
    showHint(next);
    document.body.classList.toggle('piloting', next === 'pilot');
    element('fire').hidden = element('boost').hidden = element('brake').hidden = !(touch && next === 'pilot');
    measureInsets();
    syncCursor();
    keys.clear();
    stick.set(0, 0);
    firing = false;
    boostHeld = false;
    brakeHeld = false;
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
  /** Shows one year, or the whole history, without moving the ship or the camera. */
  function applyScope(key: 'all' | number): void {
    scope = scopeFor(key);
    shared.uMin.value = scope.a;
    shared.uMax.value = key === 'all' ? days - 1 : scope.b;
    dimGoal = key === 'all' ? 1 : 0.2;
    document.querySelectorAll<HTMLElement>('#years button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.key === String(key)));
    });
    element('year').textContent = key === 'all' ? 'All years' : String(key);
    hud.setScope(scope);
  }
  function setScope(key: 'all' | number): void {
    undressEdition();
    element('summary').hidden = true;
    applyScope(key);
    if (mode === 'fly') {
      startFlight(0);
      return;
    }
    playGoal = SETTLED;
    if (mode === 'pilot') {
      endRace();
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
  function setMusic(on: boolean): void {
    sound.setMusic(on);
    element('music').setAttribute('aria-pressed', String(on));
    remember(MUSIC_KEY, on);
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
    if (open !== 'settings') showroom = false;
    standDownReset();
    if (open !== null) withdrawArrival();
    if (open === 'explore') explorer.open();
    if (open === 'race') drawRaceList();
  }

  /* ---------- colours ---------- */
  let colours = DEFAULT_COLOURS;
  try {
    colours = readColours(localStorage.getItem(COLOUR_KEY));
  } catch {
    // Blocked storage just means the default.
  }
  /** Paints the city and the ship in the visitor's colours, or the year's own during a year's flight. */
  function paintScene(): void {
    const scheme = edition ? EDITION_COLOURS : colours;
    const palette = towerPalette(scheme.towers);
    world.paintTowers(palette);
    environment.paint(palette, time);
    craft.paint(scheme);
    ghost.paint(colours);
    hud.setAccent(palette.ramp[3]);
    // Settings shows the visitor's own choices, whatever is on screen
    hud.syncColours(colours);
  }
  function setColours(next: Colours): void {
    colours = next;
    undressEdition();
    paintScene();
    try {
      localStorage.setItem(COLOUR_KEY, JSON.stringify(next));
    } catch {
      // Private windows can refuse storage. The choice still holds for this visit.
    }
  }

  /* ---------- ship ---------- */
  /**
   * Whether a ship picked in Settings is being held up to the camera. Orbit has no ship in it, and the cockpit has the
   * pilot inside it, so without this a choice of model or colour changes nothing a visitor can see.
   */
  let showroom = false;
  function showShip(): void {
    SHIPS.forEach((name) => element(`ship-${name}`).setAttribute('aria-pressed', String(name === shipModel)));
    element('shipPower').textContent = `${power.name}. ${power.blurb}`;
  }
  function setShip(next: Ship): void {
    // Bests are kept for each ship, so a race can't change ship partway
    endRace();
    undressEdition();
    shipModel = next;
    power = POWERS[next];
    craft.setModel(next);
    rival.setModel(rivalFor(next));
    ghost.setModel(next);
    readCockpit = fitCockpit(element('canopy'), next);
    showroom = true;
    showShip();
    try {
      localStorage.setItem(SHIP_KEY, next);
    } catch {
      // Private windows can refuse storage. The choice still holds for this visit.
    }
  }
  /** Holds the ship up in the part of the view Settings leaves free, turning slowly, until the panel closes. */
  function presentShip(): void {
    const view = stage.getBoundingClientRect();
    const panel = element(PANELS.settings).getBoundingClientRect();
    // Beside the panel where there is room for it, and above the panel on a narrow screen
    const beside = panel.left - view.left > view.width * 0.35;
    const x = beside ? (panel.left - view.left) / 2 : view.width / 2;
    const y = beside ? view.height / 2 : Math.max(view.height * 0.16, (panel.top - view.top) / 2);
    // Worked out in the camera's own space and turned by where it points now. Its world matrix is last frame's until
    // the frame is drawn, and in Autopilot the camera moves further in a frame than a point unprojected with it is deep.
    v1.set((x / view.width) * 2 - 1, 1 - (y / view.height) * 2, 0.5)
      .applyMatrix4(camera.projectionMatrixInverse)
      .normalize()
      .applyQuaternion(camera.quaternion);
    fighter.position.copy(camera.position).addScaledVector(v1, SHOWROOM_DISTANCE);
    fighter.scale.setScalar(SHOWROOM_SCALE);
    // Tipped towards the camera, so the top of the ship shows as it turns
    fighter.quaternion
      .copy(camera.quaternion)
      .multiply(q2.setFromAxisAngle(v1.set(1, 0, 0), 0.42))
      .multiply(q1.setFromAxisAngle(UP, time * 0.8));
  }

  /* ---------- the year's own edition ---------- */
  /**
   * Whether a year's flight is dressed in its limited edition: its own ship in its own colours, a gold city under an
   * aurora by night, with snow falling, and bells in the music. Nothing of it can be picked in Settings, and everything
   * goes back to the visitor's own choices once the flight and its card are over.
   */
  let edition = false;
  function dressEdition(): void {
    if (edition) return;
    edition = true;
    craft.setModel(EDITION_SHIP);
    readCockpit = fitCockpit(element('canopy'), EDITION_SHIP);
    if (shown !== 'night') dressScene('night');
    paintScene();
    world.festive(true, !reduced);
    sound.setFestive(true);
  }
  /** Puts back the visitor's own ship, colours, look and music. */
  function undressEdition(): void {
    if (!edition) return;
    edition = false;
    craft.setModel(shipModel);
    readCockpit = fitCockpit(element('canopy'), shipModel);
    if (shown !== skin) dressScene();
    paintScene();
    world.festive(false, false);
    sound.setFestive(false);
  }

  /* ---------- look ---------- */
  let skin: Skin = readSkin(recallText(SKIN_KEY));
  /** The look on screen, which is the visitor's own except during a year's flight. */
  let shown: Skin = skin;
  function dressScene(look: Skin = skin): void {
    shown = look;
    const { bloom: glow } = LOOKS[look];
    world.setSkin(look);
    environment.setSkin(look, time);
    fireworks.setSkin(look);
    bloom.strength = glow.strength;
    bloom.radius = glow.radius;
    bloom.threshold = glow.threshold;
    // The pass over the finished frame imitates an old screen in some looks
    finish.material.defines = definesFor(look);
    finish.material.needsUpdate = true;
    sizeScreen();
    // The page's own styles can follow the look
    document.body.dataset.skin = look;
    SKINS.forEach((name) => element(`skin-${name}`).setAttribute('aria-pressed', String(name === skin)));
  }
  /** Sets the size of an old screen's big pixels, which are square whatever shape the view is. */
  function sizeScreen(): void {
    const side = pixelSize(shown, stage.clientHeight);
    finish.uniforms.uGrid.value.set(side / Math.max(1, stage.clientWidth), side / Math.max(1, stage.clientHeight));
  }
  function setSkin(next: Skin): void {
    skin = next;
    undressEdition();
    dressScene();
    try {
      localStorage.setItem(SKIN_KEY, next);
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
      sinceJump = Infinity;
      run.reset();
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
        flown: badges.isFlown(i),
        picture: badges.picture(i),
      })),
      visitBadge,
      badges.best === null ? null : formatClock(badges.best),
    );
  }
  function earn(badge: Milestone): void {
    const cleared = badges.allEarned;
    const index = badges.milestones.indexOf(badge);
    // Shot from where the Badges list set the ship down, or soon after, a badge is earned without having been flown to
    const flown = sinceJump >= FLOWN_AFTER;
    if (flown) badges.fly(index);
    aiming = false;
    // A parked ship stays for the show. One already flying carries on underneath it.
    if (time < parkedUntil) parkedUntil = time + (cleared ? FINALE_SECONDS : BLAST_WATCH);
    if (cleared) {
      sound.fanfare();
      stamp(cal.login, data.name, (entry) => {
        entry.cleared = true;
      });
    } else {
      sound.chime();
    }
    if (!reduced) {
      const at = badges.position(index);
      blasts[nextBlast++ % BLASTS].start(at);
      flashes.add({ x: at.x, y: at.y, z: at.z, r: 3.2, g: 1.7, b: 0.6, reach: 26, start: time, life: 1.1 });
      sound.blast(stereoFor(at));
      shake = 0.4;
      if (cleared) {
        const shells = fireworks.start(camera, towerPalette(colours.towers).ramp[3]);
        sound.fireworks(shells);
        // Each shell lights the city under it as it bursts
        for (const { at: burst, centre, colour } of shells) {
          const [r, g, b] = colour.map((v) => v * 1.4);
          flashes.add({ x: centre.x, y: centre.y, z: centre.z, r, g, b, reach: 95, start: time + burst, life: 0.9 });
        }
        victoryRoll = Math.PI * 2;
        finaleUntil = time + FINALE_SECONDS;
      }
    }
    const total = badges.milestones.length;
    const inFlight = (cleared ? badges.allFlown : flown) ? ' in flight' : '';
    // A clear flown from the first badge to the last has been on the clock
    const took = cleared ? run.finish() : null;
    // A first timed clear is the fastest by default, so only a time that beats an earlier one is called that
    const toBeat = badges.best;
    const quickest = took !== null && badges.recordClear(took) && toBeat !== null;
    const clocked = took === null ? '' : ` in ${formatClock(took)}${quickest ? ', your fastest' : ''}`;
    hud.showToast(
      cleared ? `City cleared${inFlight}` : `Badge earned${inFlight}: ${badge.name}`,
      cleared
        ? `${total} of ${total} badges earned on ${cal.login}${clocked}`
        : `${badge.detail} · ${cal.formatShort(badge.day)}`,
      badges.pictureFor(badge.id),
    );
    drawBadges();
  }
  /** Where a ship lines up on a badge: to its south, clear of towers and aimed straight at it. */
  function approach(index: number): { x: number; y: number; z: number; pitch: number } {
    const target = badges.position(index);
    // Against the finished city, because every tower is up by the time the ship arrives
    const height = approachHeight(map, target, BADGE_APPROACH);
    return {
      x: target.x,
      y: height,
      z: target.z + BADGE_APPROACH,
      pitch: Math.atan2(target.y - height, BADGE_APPROACH),
    };
  }
  /** Jumps the ship to where it lines up on a badge, and holds it there while the shot is taken. */
  function visitBadge(index: number): void {
    showPanel(null);
    endRace();
    closeResult();
    const to = approach(index);
    run.jumped();
    const arrive = () => {
      ship.pos.set(to.x, to.y, to.z);
      ship.yaw = 0;
      ship.pitch = to.pitch;
      ship.bank = 0;
      ship.speed = 0;
      ship.slide.set(0, 0, 0);
      ship.live = true;
      snap = true;
      sinceJump = 0;
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

  /* ---------- races ---------- */
  function courseFor(year: number): Course {
    let course = courses.get(year);
    if (!course) {
      course = buildCourse(map, year);
      courses.set(year, course);
    }
    return course;
  }
  /** Takes the ship to a year's start line and counts down. `from` is the challenge or day's course it answers. */
  function startRace(year: number, from: Challenge | null = null): void {
    const course = courseFor(year);
    showPanel(null);
    withdrawOffer();
    withdrawArrival();
    withdrawChallenge();
    closeResult();
    stopReview();
    endRace();
    if (scope.key !== year) applyScope(year);
    playGoal = SETTLED;
    if (mode !== 'pilot') setMode('pilot');
    ship.live = false;
    const arrive = () => {
      const { route } = course;
      poseAt(route, 0, rivalPose);
      poseAt(route, 1, rivalNose);
      v1.subVectors(rivalNose.p, rivalPose.p).normalize();
      // Left of the line, with the rival to the right of it
      ship.pos.copy(rivalPose.p).add(v2.set(v1.z, 0, -v1.x).normalize().multiplyScalar(START_SIDE));
      ship.yaw = Math.atan2(-v1.x, -v1.z);
      ship.pitch = Math.asin(clamp(v1.y, -1, 1));
      ship.bank = 0;
      ship.speed = 0;
      ship.slide.set(0, 0, 0);
      ship.live = true;
      snap = true;
      aiming = false;
      parkedUntil = 0;
      race = new Race(course);
      near = new NearMisses();
      recorder = new Recorder();
      raceFrom = from;
      ghostTrack = readGhost(cal.login, year, shipModel);
      gates.set(course);
      element('hint').hidden = true;
    };
    if (jump && !jump.done) jump.mid = arrive;
    else beginJump(arrive);
  }
  /** Calls off a race in progress, or tidies away one that has finished. A result stays up until it is closed. */
  function endRace(): void {
    if (!race) return;
    race = null;
    ghostTrack = null;
    gates.set(null);
    rival.group.visible = false;
    ghost.group.visible = false;
    raceHud.show(null);
    raceHud.countdown(null);
    gateMarker.place(null, 0);
  }
  function closeResult(): void {
    resultUp = false;
    raceHud.hideResult();
  }
  /** Runs the race on by a frame, in which the ship flew from `lastPos` to where it is now. */
  function updateRace(dt: number): void {
    const current = race;
    if (!current) return;
    for (const event of current.update(dt, lastPos, ship.pos)) {
      if (event.kind === 'count') {
        sound.count(false);
      } else if (event.kind === 'go') {
        sound.count(true);
        goUntil = time + GO_SECONDS;
      } else if (event.kind === 'gate') {
        sound.gate();
      } else {
        finishRace(current, event.time);
      }
    }
    if (race !== current || current.phase !== 'racing') return;
    const { x, y, z } = ship.pos;
    near.update(dt, map, standing, x, y, z, ship.vel.length());
    recorder.note(current.elapsed, x, y, z, ship.yaw, ship.pitch, ship.bank);
  }
  function finishRace(finished: Race, time: number): void {
    const { year, rivalTime } = finished.course;
    near.bank();
    const points = near.score;
    const won = time < rivalTime;
    const before = records.best(year, shipModel);
    const { fastest, highest } = records.record(year, shipModel, time, points, won);
    if (fastest) {
      const track = recorder.finish(time);
      if (track) saveGhost(cal.login, year, shipModel, track);
    }
    stamp(cal.login, data.name, (entry) => {
      addYear(entry.raced, year);
      if (won) addYear(entry.won, year);
    });
    if (won) sound.fanfare();
    else sound.chime();
    // A first time is the fastest by default, so only one that beats an earlier one is called that
    const facts: [string, string][] = [
      ['Time', `${formatLap(time)}${fastest && before ? ', your fastest' : ''}`],
      ['Rival', formatLap(rivalTime)],
      ['Near misses', `${formatCount(points)} points${highest && before ? ', your best' : ''}`],
    ];
    const target = raceFrom?.year === year ? raceFrom.beat : null;
    if (target !== null) {
      const by = Math.abs(target - time).toFixed(1);
      facts.push(['Challenge', time < target ? `Beaten by ${by} s` : `Missed by ${by} s`]);
    }
    facts.push(['Ship', SHIP_LABELS[shipModel]]);
    lastResult = { year, time, ship: shipModel, from: raceFrom };
    const margin = Math.abs(rivalTime - time).toFixed(1);
    raceHud.showResult(won ? `You beat the rival by ${margin} s` : `The rival won by ${margin} s`, facts);
    resultUp = true;
    endRace();
  }
  /** The race readout and countdown for this frame. */
  function showRace(): void {
    if (!race) return;
    const { course, next, elapsed } = race;
    const total = course.gates.length;
    const gap = race.gap;
    const target = raceFrom?.year === course.year ? raceFrom.beat : null;
    const readout: Readout = {
      gate: next >= total - 1 ? `${course.year} · Finish` : `${course.year} · Gate ${next + 1} of ${total}`,
      clock: formatLap(elapsed),
      gap: gap === null ? '' : `${Math.abs(gap).toFixed(1)} s ${gap < 0 ? 'ahead of' : 'behind'} the rival`,
      target: target === null ? '' : `To beat ${formatLap(target)}`,
      score: `Near misses ${formatCount(near.score)}`,
      chain: near.count ? `+${formatCount(near.pending)} ×${multiplier(near.count).toFixed(1)}` : '',
    };
    raceHud.show(readout);
    raceHud.countdown(race.phase === 'countdown' ? String(race.count) : time < goUntil ? 'Go' : null);
    gates.update(next, time);
  }
  /** Flies the rival down the course, and the ghost along the run it recorded. */
  function updateRivals(dt: number): void {
    const current = race;
    rival.group.visible = current !== null && ship.live;
    ghost.group.visible = false;
    if (!current || !ship.live) return;
    const { route } = current.course;
    const s = current.rivalS;
    // Its heading from the stretch just ahead, or just behind once it reaches the end
    const from = Math.min(s, route.len - 0.9);
    poseAt(route, from, rivalNose);
    poseAt(route, from + 0.9, ahead);
    poseAt(route, s, rivalPose);
    v1.subVectors(ahead.p, rivalNose.p).normalize();
    v2.set(-v1.z, 0, v1.x)
      .normalize()
      .multiplyScalar(START_SIDE * (1 - smooth(clamp(s / MERGE, 0, 1))));
    rival.group.position.copy(rivalPose.p).add(v2);
    m1.lookAt(rivalPose.p, v3.copy(rivalPose.p).add(v1), UP);
    rival.group.quaternion.setFromRotationMatrix(m1).multiply(q2.setFromAxisAngle(ROLL_AXIS, rivalPose.roll));
    const going = current.phase === 'racing' && s < route.len;
    rival.update(time, dt, going ? rivalPose.pace / CRUISE : 0);

    if (current.phase !== 'racing' || !ghostTrack || !ghostAt(ghostTrack, current.elapsed, ghostPose)) return;
    ghost.group.visible = true;
    ghost.group.position.set(ghostPose.x, ghostPose.y, ghostPose.z);
    ghost.group.quaternion
      .setFromEuler(e1.set(ghostPose.pitch, ghostPose.yaw, 0, 'YXZ'))
      .multiply(q2.setFromAxisAngle(ROLL_AXIS, ghostPose.bank));
    ghost.update(time, dt, 1);
  }
  /** The years that can be raced, with the rival's time and this ship's best on each. */
  function drawRaceList(): void {
    raceHud.renderList(
      raceList.map((year) => {
        const best = records.best(year, shipModel);
        const marked = challenge?.year === year;
        return {
          year,
          rival: formatLap(courseFor(year).rivalTime),
          best: best ? formatLap(best.time) : null,
          won: records.won(year),
          tag: marked ? (challenge?.daily ? "Today's course" : 'Challenge') : null,
        };
      }),
      SHIP_LABELS[shipModel],
      (year) => startRace(year, challenge?.year === year ? challenge : null),
    );
  }
  /** Shows the card a challenge link or the day's course opens with. */
  function offerChallenge(next: Challenge): void {
    challenge = next;
    const { year, beat, ship: set, daily } = next;
    let text = `A race through ${year}.`;
    if (daily) {
      text =
        daily === today()
          ? `Today's course: ${year}. Everyone who opens today's course gets this one.`
          : `The course for ${writtenDay(daily)}: ${year}.`;
    } else if (beat !== null) {
      text = `A challenge: fly ${year} in under ${formatLap(beat)}${set ? `, set in the ${SHIP_LABELS[set]}` : ''}.`;
    }
    raceHud.showChallenge(text);
  }
  function withdrawChallenge(): void {
    raceHud.showChallenge(null);
  }
  /** The year to race from the end of an Autopilot flight: the one just flown, or the latest with any contributions. */
  const yearToRace = (): number => (scope.key !== 'all' && raceList.includes(scope.key) ? scope.key : raceList[0]);

  /* ---------- your year ---------- */
  function stopReview(): void {
    reviewing = false;
    opening = null;
    beatDay = -1;
    hud.hideCaption();
    hud.hideOpener();
    hud.showYearCount(null, 0);
  }
  /**
   * Opens a year's flight: its number over its empty block while the camera pushes in, with a fanfare, then the jump in.
   * The year then rises as the flight goes, with its count running and its moments lit as the date reaches them.
   */
  function startReview(year: number): void {
    const told = reviewYear(cal, year, badges.milestones);
    if (!told) return;
    review = told;
    element('summary').hidden = true;
    clearTimeout(summaryTimer);
    showPanel(null);
    applyScope(told.year);
    keepEdition = true;
    if (mode !== 'fly') setMode('fly', OPENER_SECONDS);
    else startFlight(OPENER_SECONDS);
    keepEdition = false;
    dressEdition();
    reviewing = true;
    nextBeat = 0;
    captionUntil = 0;
    beatDay = -1;
    play = scope.a;
    const { at, aim } = stageFor(told.year);
    camera.position.copy(at);
    camera.lookAt(aim);
    opening = reduced ? null : { from: at, to: at.clone().lerp(aim, 0.3), aim, t: 0 };
    hud.showOpener(told.year, cal.login);
    sound.fanfare();
  }
  function updateCaption(): void {
    if (!reviewing || !review || !arrived) return;
    if (time < captionUntil) {
      if (beatDay >= 0) {
        shared.uHit.value = beatDay;
        hitGlow = Math.max(hitGlow, 0.85);
      }
      return;
    }
    beatDay = -1;
    const beat = review.beats[nextBeat];
    if (beat && play >= beat.day) {
      hud.showCaption(beat.title, beat.detail, beat.badge ? badges.pictureFor(beat.badge) : null);
      nextBeat++;
      captionUntil = time + CAPTION_SECONDS;
      celebrate(beat.day);
    } else {
      hud.hideCaption();
    }
  }
  /** A moment of the year: its tower lit, a burst over it, and a chime. */
  function celebrate(day: number): void {
    beatDay = day;
    sound.chime();
    if (reduced) return;
    const at = new THREE.Vector3(map.cx[day], map.top[day] + 1.4, map.cz[day]);
    blasts[nextBlast++ % BLASTS].start(at);
    flashes.add({ x: at.x, y: at.y, z: at.z, r: 3.2, g: 1.7, b: 0.6, reach: 30, start: time, life: 1.4 });
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
      touchedTower = -1;
      hud.hideTip();
      return;
    }
    const i = found.instanceId;
    shared.uHover.value = i;
    // Pointing along the towers plays them, like running a finger along strings
    if (i !== touchedTower) sound.touch(i);
    touchedTower = i;
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
      // Only the main button fires. The others open menus or scroll, and can keep their release from the page.
      if (e.button !== 0) return;
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
    if (e.pointerId === boostPointer) {
      boostPointer = null;
      boostHeld = false;
    }
    if (e.pointerId === brakePointer) {
      brakePointer = null;
      brakeHeld = false;
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
  // The browser's menu has no place over a ship being flown. Orbit's controls already hold it back there.
  canvas.addEventListener('contextmenu', (e) => {
    if (mode === 'pilot') e.preventDefault();
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
    boostHeld = false;
    brakeHeld = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      showPanel(null);
      closeResult();
    }
    const typing = e.target instanceof HTMLInputElement;
    if (e.code === 'Space' && !typing && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (mode === 'pilot') firing = true;
      // A held key repeats, and each repeat would flip the pause back
      else if (!e.repeat) togglePlay();
      return;
    }
    if (e.code === 'KeyN' && !typing && !e.repeat && !e.metaKey && !e.ctrlKey) setSound(!sound.enabled);
    if (mode === 'pilot' && !typing && !e.metaKey && !e.ctrlKey) {
      if (e.code === 'KeyI' && !e.repeat) setInvert(!invertY);
      if (e.code === 'KeyM' && !e.repeat) setMouseSteer(!mouseSteer);
      const side = SIDES[e.code];
      if (side && !e.repeat && taps.press(side, e.timeStamp / 1000)) startRoll(side);
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
  element('music').addEventListener('click', (e) => {
    setMusic(!sound.musicEnabled);
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
  element('colourReset').addEventListener('click', () => {
    // A reset that changes the ship's colours shows the ship, as picking one of them does
    if (colours.hull !== DEFAULT_COLOURS.hull || colours.trim !== DEFAULT_COLOURS.trim) showroom = true;
    setColours(DEFAULT_COLOURS);
  });
  SKINS.forEach((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `skin-${name}`;
    button.textContent = LOOKS[name].label;
    button.addEventListener('click', () => {
      setSkin(name);
      button.blur();
    });
    element('looks').append(button);
  });
  SHIPS.forEach((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `ship-${name}`;
    button.textContent = SHIP_LABELS[name];
    button.addEventListener('click', () => {
      setShip(name);
      button.blur();
    });
    element('ships').append(button);
  });
  showShip();
  element('summaryAgain').addEventListener('click', () => {
    if (review) startReview(review.year);
  });
  element('summaryClose').addEventListener('click', () => {
    element('summary').hidden = true;
    undressEdition();
  });
  /** The address of a year's flight, which link previews show as that year's card. */
  const yearLink = (year: number) => `${location.origin}/${cal.login}/${year}`;
  element('summaryShare').addEventListener('click', (e) => {
    const button = e.currentTarget as HTMLElement;
    if (!review) return;
    void navigator.clipboard
      .writeText(yearLink(review.year))
      .then(() => {
        button.textContent = 'Copied';
      })
      .catch(() => {});
  });
  // Phones and some browsers can hand the link straight to another app
  element('summaryNative').hidden = typeof navigator.share !== 'function';
  element('summaryNative').addEventListener('click', () => {
    if (!review) return;
    const { year, total } = review;
    navigator
      .share({
        title: `${cal.login}'s ${year} on GitHub`,
        text: `${formatCount(total)} contribution${total === 1 ? '' : 's'} in ${year}, flown as a city.`,
        url: yearLink(year),
      })
      .catch(() => {});
  });
  element('fire').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    firePointer = e.pointerId;
    firing = true;
  });
  element('boost').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    boostPointer = e.pointerId;
    boostHeld = true;
  });
  element('brake').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    brakePointer = e.pointerId;
    brakeHeld = true;
  });
  element('offerPilot').addEventListener('click', () => setMode('pilot'));
  element('offerRace').addEventListener('click', () => startRace(yearToRace()));
  element('challengeGo').addEventListener('click', () => {
    if (challenge) startRace(challenge.year, challenge);
  });
  element('challengeLater').addEventListener('click', withdrawChallenge);
  element('raceAgain').addEventListener('click', () => {
    if (lastResult) startRace(lastResult.year, lastResult.from);
  });
  element('raceResultClose').addEventListener('click', closeResult);
  element('raceCopy').addEventListener('click', (e) => {
    const button = e.currentTarget as HTMLElement;
    if (!lastResult) return;
    const { year, time, ship: flown } = lastResult;
    void navigator.clipboard
      .writeText(`${location.origin}/${cal.login}${challengeHash(year, time, flown)}`)
      .then(() => {
        button.textContent = 'Copied';
      })
      .catch(() => {});
  });
  // A challenge or the day's course followed from this same city changes only the fragment, so the page stays loaded
  window.addEventListener('hashchange', () => {
    const next = readChallenge(location.hash, raceList, cal, cal.login);
    if (!next) return;
    showPanel(null);
    offerChallenge(next);
  });
  element('arrivalMore').addEventListener('click', () => {
    explorer.show('city');
    showPanel('explore');
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
  element('music').setAttribute('aria-pressed', String(sound.musicEnabled));
  hud.renderColours(COLOUR_ROWS, (key, hex) => {
    setColours({ ...colours, [key]: hex });
    // A new colour for the ship is shown on the ship
    if (key !== 'towers') showroom = true;
  });
  // Dressed first, so the ship's reflections are painted once, in the right look
  dressScene();
  paintScene();
  drawBadges();
  void document.fonts.load('800 64px "Mona Sans"').then(() => {
    badges.repaint();
    drawBadges();
    markers.repaint(badges.milestones.map((_, i) => badges.picture(i)));
  });
  const credit = document.createElement('a');
  credit.href = 'https://sheetsolved.com';
  credit.textContent = 'A Sheet Solved project.';
  element('note').append(' ', credit);
  const previewing = location.hash === REVIEW_HASH;
  // December offers the year ending, and early January the one just ended. A preview link offers the latest at any time.
  const offered = previewing ? lastYear : reviewSeason(new Date(), lastYear);
  if (offered !== null && reviewYear(cal, offered)) {
    const button = element('review');
    button.textContent = reviewTitle(offered);
    button.hidden = false;
    button.addEventListener('click', () => startReview(offered));
  }
  addChip('all', 'All', cal.total);
  [...years].reverse().forEach((y) => addChip(y, String(y), cal.yearTotal(y)));
  element('race').hidden = raceList.length === 0;
  element('offerRace').hidden = raceList.length === 0;
  stamp(cal.login, data.name);

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
    sizeScreen();
    hud.drawTimeline();
    measureInsets();
  }

  let last = performance.now();
  let frameAverage = 16;
  let frames = 0;
  let levelMs = 0;
  let quality = 0;
  function adapt(ms: number): void {
    frameAverage = averageFrame(frameAverage, ms);
    frames++;
    levelMs += countedFrame(ms);
    if (quality >= 2 || !tooSlow(frameAverage, frames, levelMs)) return;
    quality++;
    frames = 0;
    levelMs = 0;
    frameAverage = 16;
    if (quality === 1 && pixelRatio > 1) {
      pixelRatio = 1;
      shared.uPx.value = 1;
      renderer.setPixelRatio(1);
      resize();
    } else {
      quality = 2;
      bloom.enabled = false;
      speedFx = false;
      lightsOn = false;
      finish.uniforms.uGrain.value = 0;
      world.simplify();
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
    timeArrival();
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
        lastPos.copy(ship.pos);
        updatePilot(dt);
        // An open panel holds the race as it holds the ship
        if (ship.live && !panelOpen && !(jump && jump.t < 0.5)) updateRace(dt);
      }
    }
    updateRivals(dt);
    showRace();

    const flying = aboard() && chaseDistance() > 0;
    const seated = aboard() && chaseDistance() === 0;
    const presented = showroom && !flying;
    if (presented) presentShip();
    else fighter.scale.setScalar(1);
    fighter.visible = flying || presented;
    // The cockpit's frame would stand between the pilot and a ship held up to be looked at
    element('canopy').toggleAttribute('hidden', !seated || presented);

    const homing = locked >= 0 ? badges.position(locked) : null;
    if (firing && mode === 'pilot' && ship.live && weapons.fire(ship.pos, ship.fwd, fighter.quaternion, homing)) {
      sound.laser();
      craft.muzzle();
      const { x, y, z } = ship.pos;
      flashes.add({ x, y, z, r: 1.6, g: 0.25, b: 0.15, reach: 6, start: time, life: 0.1 });
    }
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
        sound.impact(at.distanceTo(camera.position), stereoFor(at), day >= 0);
        flashes.add({ x: at.x, y: at.y, z: at.z, r: 1.6, g: 0.75, b: 0.3, reach: 7, start: time, life: 0.25 });
        if (day < 0) return;
        shared.uHit.value = day;
        hitGlow = 1;
      },
    );
    const moving = aboard() && !(mode === 'fly' && paused);
    const speed = moving ? ship.vel.length() : 0;
    if (seated) {
      readCockpit({
        // Autopilot moves the ship along its route and leaves `ship.speed` as Pilot last had it
        speed: (mode === 'pilot' ? ship.speed : speed) / (BOOST * power.boost),
        locked: locked >= 0,
        // An open panel holds the ship still, whatever is pressed
        boosting: mode === 'pilot' && wasBoosting && !panelOpen,
      });
    }
    // Autopilot is watched rather than flown, so its engine sits further back in the mix
    sound.engine(aboard() ? speed / BOOST : null, mode === 'pilot' ? 1 : 0.5);
    if (moving && !(jump && jump.t < 0.5)) whooshPast(speed);
    if (mode === 'fly' && arrived && !paused) sound.cue({ kind: 'history', day: play });
    else if (mode === 'pilot' && ship.live) sound.cue({ kind: 'flight', day: map.cellIndex(ship.pos.x, ship.pos.z) });
    else sound.cue({ kind: 'still' });
    surge +=
      ((mode === 'pilot' ? clamp((ship.speed - CRUISE) / (BOOST - CRUISE), 0, 1) : 0) - surge) *
      (1 - Math.exp(-4 * dt));
    craft.update(time, dt, aboard() ? speed / CRUISE : 0);
    if (flying) {
      craft.wingtips(v1, v2);
      const turning = clamp(Math.abs(bankNow) * 1.1 - 0.15, 0, 1) * clamp((speed - 8) / 20, 0, 1);
      trails.update(v1, v2, Math.min(1, turning * 0.8 + clamp((speed - 26) / 20, 0, 1) * 0.3), time, camera.position);
      trails.visible = true;
    } else {
      trails.clear();
      trails.visible = false;
    }
    world.dustVelocity.copy(ship.vel).multiplyScalar(moving ? 1 : 0);
    // In a year's flight the specks are snow, which falls whether or not the camera moves
    world.dust.visible = moving || edition;
    shared.uWarp.value = warp;
    world.warpLines.visible = warp > 0.01;
    const fov = baseFov + (moving ? clamp((speed - 18) / 28, 0, 1) * 10 : 0) + warp * 50;
    if (Math.abs(fov - camera.fov) > 0.02) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-8 * dt));
      camera.updateProjectionMatrix();
    }
    finish.uniforms.uSpeed.value = speedFx && !reduced ? surge * 0.8 + warp * 1.4 : 0;
    // Held still for reduced motion, where it still breaks up banding without shimmering
    finish.uniforms.uTime.value = reduced ? 0 : time;

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
    shared.uLights.value = lightsOn ? flashes.fill(time, shared.uLightPos.value, shared.uLightCol.value) : 0;
    environment.flush(time);
    updateCaption();
    // A year's count runs up with its towers, once the flight is under way
    if (reviewing && review && mode === 'fly' && arrived) {
      const upTo = Math.min(Math.floor(play), scope.b);
      hud.showYearCount(upTo >= scope.a ? cal.sum(scope.a, upTo) : 0, review.year);
    } else if (reviewing) {
      hud.showYearCount(null, 0);
    }
    // The clock counts the time the ship is in the visitor's hands
    const flown = mode === 'pilot' && ship.live && !panelOpen && !(jump && jump.t < 0.5);
    if (flown) run.tick(dt);
    // A race has a clock of its own
    hud.showRun(mode === 'pilot' && run.timed && !race ? `Clear ${formatClock(run.seconds)}` : null);
    world.followCamera(camera);
    camera.updateMatrixWorld();
    updateTargeting();
    updateMarkers();
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
  // A link to a year opens on its flight, as the preview link opens on the latest
  if (linkedYear !== null) startReview(linkedYear);
  else if (previewing) startReview(lastYear);
  explorer.describe(data);
  explorer.host();
  // Opened while the city was still loading, so the app takes it over as it stands
  if (!element('explorePanel').hidden) showPanel('explore');
  const pickedFrom = takeArrival(data.login);
  if (pickedFrom) greet(pickedFrom);
  // After the opening mode is set, which would withdraw it
  const linked = readChallenge(location.hash, raceList, cal, cal.login);
  if (linked) offerChallenge(linked);
  requestAnimationFrame(frame);

  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    Object.assign(window, {
      __city: {
        camera,
        // A NaN anywhere in the frame only shows once bloom spreads it, so tests keep bloom on
        bloom,
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
        approach,
        run,
        stick,
        startRace,
        courseFor,
        rival: rival.group,
        ghost: ghost.group,
        get race() {
          return race;
        },
        get roll() {
          return roll;
        },
        get onEdge() {
          return onEdge;
        },
        get near() {
          return near;
        },
        get firing() {
          return firing;
        },
        get showroom() {
          return showroom;
        },
        get power() {
          return power;
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
        get locked() {
          return locked;
        },
        get sinceJump() {
          return sinceJump;
        },
      },
    });
  }
}
