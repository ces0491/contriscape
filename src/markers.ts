/** The space kept clear at each edge of the view, for the header and the deck. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Placed {
  x: number;
  y: number;
  /** Whether the point is in view, rather than pinned to an edge. */
  inside: boolean;
  /** Radians from the screen's centre towards the point, clockwise from the right, as screen y runs down. */
  angle: number;
}

/**
 * Where a marker sits for a point at these normalised device coordinates. A point in view, inside the insets, is marked
 * where it is. Anything else is pinned to the edge of the inset frame, on the line from the screen's centre towards it.
 * A point behind the camera projects mirrored through the centre, so its direction is flipped back first.
 */
export function placeMarker(
  ndcX: number,
  ndcY: number,
  behind: boolean,
  width: number,
  height: number,
  inset: Insets,
): Placed {
  const x = ((ndcX + 1) / 2) * width;
  const y = ((1 - ndcY) / 2) * height;
  const inside = !behind && x >= inset.left && x <= width - inset.right && y >= inset.top && y <= height - inset.bottom;
  let dx = x - width / 2;
  let dy = y - height / 2;
  if (behind) {
    dx = -dx;
    dy = -dy;
  }
  // Straight behind has no direction on screen, so the marker points down, the way to turn round
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
  const angle = Math.atan2(dy, dx);
  if (inside) return { x, y, inside, angle };
  const reach = [
    dx > 0 ? (width - inset.right - width / 2) / dx : dx < 0 ? (inset.left - width / 2) / dx : Infinity,
    dy > 0 ? (height - inset.bottom - height / 2) / dy : dy < 0 ? (inset.top - height / 2) / dy : Infinity,
  ];
  const t = Math.max(0, Math.min(...reach));
  return { x: width / 2 + dx * t, y: height / 2 + dy * t, inside: false, angle };
}

/** A marker that could be shown: whose it is, where it would sit, and how far away its badge is. */
export interface Candidate {
  i: number;
  placed: Placed;
  distance: number;
}

/**
 * Which markers to show, nearest first. One that would sit within `room` pixels of a marker already kept is dropped,
 * so the nearer badge keeps its marker, and only `edgeLimit` are pinned to the edge, so the edge stays readable.
 * Markers in view are smaller and need half the room.
 */
export function chooseMarkers(candidates: Candidate[], room: number, edgeLimit: number): Candidate[] {
  const kept: Candidate[] = [];
  let atEdge = 0;
  for (const candidate of [...candidates].sort((a, b) => a.distance - b.distance)) {
    const { placed } = candidate;
    if (!placed.inside && atEdge >= edgeLimit) continue;
    const needed = placed.inside ? room / 2 : room;
    if (kept.some((other) => Math.hypot(other.placed.x - placed.x, other.placed.y - placed.y) < needed)) continue;
    kept.push(candidate);
    if (!placed.inside) atEdge++;
  }
  return kept;
}

/** Badges this close are big enough on screen to need no marker. */
const NEAR = 14;

interface Item {
  box: HTMLElement;
  distance: HTMLElement;
  shown: boolean;
}

/** One marker, hidden to begin with: a pointer, what stands for the thing it marks, and the distance to it. */
function build(layer: HTMLElement, kind: string, name: string, art: HTMLElement): Item {
  const box = document.createElement('div');
  box.className = kind;
  box.hidden = true;
  box.title = name;
  const distance = document.createElement('span');
  box.append(document.createElement('i'), art, distance);
  layer.append(box);
  return { box, distance, shown: false };
}

/** Puts a marker where it has been placed, or hides it with `null`. */
function move(item: Item, placed: Placed | null, distance: number): void {
  const show = placed !== null;
  if (show !== item.shown) {
    item.box.hidden = !show;
    item.shown = show;
  }
  if (!placed) return;
  item.box.classList.toggle('edge', !placed.inside);
  item.box.style.transform = `translate(${placed.x.toFixed(1)}px,${placed.y.toFixed(1)}px)`;
  item.box.style.setProperty('--turn', `${placed.angle.toFixed(3)}rad`);
  const text = String(Math.round(distance));
  if (item.distance.textContent !== text) item.distance.textContent = text;
}

/**
 * Markers for the badges still standing: a gold diamond with the distance over one in view, and the badge's own artwork
 * with a pointer at the edge of the view for one out of it.
 */
export class Markers {
  private readonly items: Item[];

  constructor(layer: HTMLElement, pictures: string[], names: string[]) {
    this.items = pictures.map((picture, i) => {
      const image = document.createElement('img');
      image.src = picture;
      image.alt = '';
      return build(layer, 'marker', names[i], image);
    });
  }

  /** Redraws the artwork, for the numerals once the display font has loaded. */
  repaint(pictures: string[]): void {
    this.items.forEach((item, i) => {
      (item.box.querySelector('img') as HTMLImageElement).src = pictures[i];
    });
  }

  /** Places one marker, or hides it with `null`. */
  place(index: number, placed: Placed | null, distance: number): void {
    move(this.items[index], placed !== null && placed.inside && distance < NEAR ? null : placed, distance);
  }

  hideAll(): void {
    this.items.forEach((_, i) => this.place(i, null, 0));
  }
}

/**
 * The way back to the city, for a ship that has flown clear of it: the same diamond and edge pointer as a badge's
 * marker, in the buildings' colour, with a skyline where a badge has its artwork.
 */
export class HomeMarker {
  private readonly item: Item;

  constructor(layer: HTMLElement) {
    this.item = build(layer, 'marker home', 'The city', document.createElement('b'));
  }

  /** Places the marker, or hides it with `null`. */
  place(placed: Placed | null, distance: number): void {
    move(this.item, placed, distance);
  }
}
