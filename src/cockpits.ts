import type { Ship } from './fighter';

/**
 * The view from each ship's seat: what the pilot looks through, the bars across it, and a few instruments on the frame.
 * Every cockpit is drawn in a box 1600 wide and 900 tall, which the page stretches over the view, so a round window is
 * only round on a screen of that shape.
 *
 * The middle of the box stays clear in all of them, because that is where the gunsight sits. The instruments keep to
 * the frame beside or above the glass, clear of the page's header and of the readouts along the bottom. Where there is
 * a choice they sit to the left, because the markers that point to badges collect down the right edge.
 */
const WIDTH = 1600;
const HEIGHT = 900;

/** What a cockpit shows of the flight, each from 0 to 1 or on and off. */
export interface Readings {
  /** The ship's speed as a share of its fastest. */
  speed: number;
  locked: boolean;
  boosting: boolean;
}

interface Design {
  /** The openings in the frame, as closed SVG paths. */
  glass: string[];
  /** Bars across the glass, as one SVG path. */
  struts: string;
  /** The instruments, as SVG markup. Each cockpit has one speed needle, one lock lamp and one boost lamp. */
  fittings: string;
}

const round = (n: number): string => String(Math.round(n * 10) / 10);

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** How far a needle swings either side of straight up, in degrees. */
const SWING = 120;

/** A round gauge with a needle that the speed turns, from eight o'clock at rest to four o'clock flat out. */
function dial(cx: number, cy: number, r: number): string {
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const angle = ((-SWING + i * 30) * Math.PI) / 180;
    const x = Math.sin(angle);
    const y = -Math.cos(angle);
    return `M${round(cx + x * r * 0.7)} ${round(cy + y * r * 0.7)}L${round(cx + x * r * 0.9)} ${round(cy + y * r * 0.9)}`;
  }).join('');
  return (
    `<circle class="dial" cx="${cx}" cy="${cy}" r="${r}"/><path class="tick" d="${ticks}"/>` +
    `<line class="needle" data-live="speed" data-cx="${cx}" data-cy="${cy}" x1="${cx}" y1="${cy}" x2="${cx}" y2="${round(cy - r * 0.78)}" transform="rotate(${-SWING} ${cx} ${cy})"/>` +
    `<circle class="hub" cx="${cx}" cy="${cy}" r="${round(r * 0.11)}"/>`
  );
}

/** A lamp that lights for a lock or for boost: round, or square in a ship built of boxes. */
function lamp(live: 'lock' | 'boost', cx: number, cy: number, r: number, square = false): string {
  return square
    ? `<rect class="lamp ${live}" data-live="${live}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}"/>`
    : `<circle class="lamp ${live}" data-live="${live}" cx="${cx}" cy="${cy}" r="${r}"/>`;
}

/** Rivets or small lights spaced round a circle. */
function ring(cx: number, cy: number, r: number, count: number, size: number): string {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return `<circle class="rivet" cx="${round(cx + Math.cos(angle) * r)}" cy="${round(cy + Math.sin(angle) * r)}" r="${size}"/>`;
  }).join('');
}

/** Rivets or small lights spaced along a line. */
function row(x1: number, y1: number, x2: number, y2: number, count: number, size: number): string {
  return Array.from({ length: count }, (_, i) => {
    const k = count === 1 ? 0.5 : i / (count - 1);
    return `<circle class="rivet" cx="${round(x1 + (x2 - x1) * k)}" cy="${round(y1 + (y2 - y1) * k)}" r="${size}"/>`;
  }).join('');
}

const DESIGNS: Record<Ship, Design> = {
  // A fighter's canopy: one faceted bubble with two bars running back from the nose
  interceptor: {
    glass: ['M250 58L1350 58L1520 560L1200 900L400 900L80 560Z'],
    struts: 'M800 58L640 900M800 58L960 900',
    fittings: dial(84, 300, 58) + lamp('lock', 54, 410, 21) + lamp('boost', 114, 410, 21),
  },
  // A windscreen that comes to a point, like the ship
  dart: {
    glass: ['M800 46L1440 500L1290 900L310 900L160 500Z'],
    struts: 'M800 46L560 900M800 46L1040 900',
    fittings:
      dial(250, 215, 76) + lamp('lock', 1300, 180, 26) + lamp('boost', 1392, 236, 26) + row(96, 130, 96, 420, 5, 7),
  },
  // A capsule: one big porthole ringed with rivets, and a small one to each side
  rocket: {
    glass: [circle(800, 470, 420), circle(138, 470, 104), circle(1462, 470, 104)],
    struts: '',
    fittings:
      ring(800, 470, 452, 28, 7) +
      ring(138, 470, 126, 10, 5) +
      ring(1462, 470, 126, 10, 5) +
      dial(300, 160, 64) +
      lamp('lock', 1262, 130, 24) +
      lamp('boost', 1340, 178, 24),
  },
  // A dome: one long window curving round the pilot, ribbed, with the instruments overhead
  saucer: {
    glass: ['M30 300Q800 40 1570 300L1570 620Q800 800 30 620Z'],
    struts: 'M420 120L384 760M1180 120L1216 760',
    fittings:
      dial(800, 114, 50) + lamp('lock', 668, 116, 22) + lamp('boost', 932, 116, 22) + row(120, 716, 1480, 716, 18, 8),
  },
  // Built of boxes: three square panes with a row of small ones over them, and square lamps
  brick: {
    glass: ['M190 100H1410V226H190Z', 'M190 276H575V860H190Z', 'M625 276H975V860H625Z', 'M1025 276H1410V860H1025Z'],
    struts: 'M470 100V226M800 100V226M1130 100V226',
    fittings:
      dial(95, 430, 62) +
      lamp('lock', 58, 550, 24, true) +
      lamp('boost', 132, 550, 24, true) +
      row(40, 250, 150, 250, 3, 8) +
      row(1450, 250, 1560, 250, 3, 8),
  },
};

/** The markup for a ship's cockpit, to go inside an SVG whose view box is 1600 by 900. */
export function cockpitMarkup(ship: Ship): string {
  const { glass, struts, fittings } = DESIGNS[ship];
  const openings = glass.join('');
  return (
    `<path class="frame" fill-rule="evenodd" d="M0 0H${WIDTH}V${HEIGHT}H0Z${openings}"/>` +
    (struts ? `<path class="strut" d="${struts}"/>` : '') +
    `<path class="edge" d="${openings}"/>` +
    fittings
  );
}

/** Fits a ship's cockpit into the page's canopy and returns what moves its instruments. */
export function fitCockpit(canopy: Element, ship: Ship): (readings: Readings) => void {
  canopy.innerHTML = cockpitMarkup(ship);
  canopy.setAttribute('data-ship', ship);
  const needle = canopy.querySelector('[data-live="speed"]');
  const lock = canopy.querySelector('[data-live="lock"]');
  const boost = canopy.querySelector('[data-live="boost"]');
  const pivot = `${needle?.getAttribute('data-cx')} ${needle?.getAttribute('data-cy')}`;
  // What the markup starts with. Each instrument is written only when its own reading changes.
  let angleShown = -SWING;
  let lockShown = false;
  let boostShown = false;
  return ({ speed, locked, boosting }) => {
    // Whole degrees, so a needle that hasn't visibly moved isn't written again
    const angle = Math.round(-SWING + 2 * SWING * Math.min(1, Math.max(0, speed)));
    if (angle !== angleShown) {
      angleShown = angle;
      needle?.setAttribute('transform', `rotate(${angle} ${pivot})`);
    }
    if (locked !== lockShown) {
      lockShown = locked;
      lock?.classList.toggle('on', locked);
    }
    if (boosting !== boostShown) {
      boostShown = boosting;
      boost?.classList.toggle('on', boosting);
    }
  };
}
