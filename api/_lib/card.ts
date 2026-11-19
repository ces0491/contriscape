import type { Contributions } from '../../shared/contract.js';
import { Calendar, formatCount } from '../../src/calendar.js';
import { DEFAULT_COLOURS, towerPalette } from '../../src/colours.js';
import { CityMap } from '../../src/map.js';
import { canWrite, textHeight, textWidth, write } from './letters.js';
import { Picture, type Rgb } from './png.js';

/** The size link previews are drawn at. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const MARGIN = 60;
const NIGHT: Rgb = [6, 10, 19];
const INK: Rgb = [233, 242, 236];
const MUTED: Rgb = [127, 149, 139];
/** Towers across the card. Each stands for a stretch of the history, at the height of its busiest day. */
const TOWERS = 72;
const GROUND = 540;
const TALLEST = 290;
const NAME_TOP = 62;
/** Cells this size and up are drawn with a gap, which makes a big letter a wall of lit windows. */
const WINDOWED_FROM = 8;

const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);

/** A seeded run of numbers from 0 to 1, so a user's card is the same each time it is drawn. */
function seeded(text: string): () => number {
  let state = [...text].reduce((hash, character) => (Math.imul(hash, 31) + character.charCodeAt(0)) | 0, 7);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The line under the name: the years the history covers and how much is in it. */
export function cardSummary(cal: Calendar): string {
  const years = cal.firstYear === cal.lastYear ? String(cal.firstYear) : `${cal.firstYear}-${cal.lastYear}`;
  return `${years}  ${formatCount(cal.total)} contribution${cal.total === 1 ? '' : 's'}`;
}

/** The largest cell size that fits a line of text across the card, between the smallest and largest worth drawing. */
export function nameScale(name: string): number {
  const room = CARD_WIDTH - MARGIN * 2;
  let scale = 14;
  while (scale > 4 && textWidth(name, scale) > room) scale--;
  return scale;
}

/**
 * The card a shared link shows: the user's name, the span and size of their history, and that history as a skyline in
 * the city's own colours. The heights are measured as the city's are, so the card looks like the place it leads to.
 */
export function drawCard(data: Contributions): Picture {
  const cal = new Calendar(data);
  const map = new CityMap(cal);
  const { ramp, window } = towerPalette(DEFAULT_COLOURS.towers);
  const picture = new Picture(CARD_WIDTH, CARD_HEIGHT, NIGHT);
  const random = seeded(cal.login);
  const accent: Rgb = [byte(ramp[3][0]), byte(ramp[3][1]), byte(ramp[3][2])];
  const lit: Rgb = [byte(window[0]), byte(window[1]), byte(window[2])];

  // The glow a city throws on its own sky, in bands that fade upward from the ground
  for (let band = 0; band < 12; band++) {
    picture.rect(0, GROUND - (band + 1) * 14, CARD_WIDTH, 14, accent, 0.05 * (1 - band / 12));
  }
  picture.rect(0, GROUND, CARD_WIDTH, CARD_HEIGHT - GROUND, [4, 7, 13]);

  const span = CARD_WIDTH - MARGIN * 2;
  const pitch = span / TOWERS;
  const across = Math.max(2, Math.floor(pitch) - 2);
  for (let tower = 0; tower < TOWERS; tower++) {
    const a = Math.floor((tower / TOWERS) * cal.days);
    const b = Math.max(a + 1, Math.floor(((tower + 1) / TOWERS) * cal.days));
    let busiest = 0;
    for (let day = a; day < b && day < cal.days; day++) busiest = Math.max(busiest, cal.counts[day]);
    const share = map.share(busiest);
    const x = Math.round(MARGIN + tower * pitch);
    if (!share) {
      picture.rect(x, GROUND - 2, across, 2, MUTED, 0.35);
      continue;
    }
    const height = Math.max(4, Math.round(share * TALLEST));
    // The same climb through the palette that the towers make, busier days brighter
    const t = Math.pow(share, 0.72) * 3;
    const from = ramp[Math.min(2, Math.floor(t))];
    const to = ramp[Math.min(3, Math.floor(t) + 1)];
    const mix = Math.min(1, t - Math.min(2, Math.floor(t)));
    const wall: Rgb = [0, 1, 2].map((c) => byte((from[c] + (to[c] - from[c]) * mix) * 0.62)) as unknown as Rgb;
    picture.rect(x, GROUND - height, across, height, wall);
    picture.rect(x, GROUND - height, across, 2, accent, 0.9);
    // Windows, some of them lit
    for (let y = GROUND - height + 6; y < GROUND - 4; y += 6) {
      for (let wx = x + 1; wx + 2 <= x + across - 1; wx += 4) {
        if (random() < 0.42) picture.rect(wx, y, 2, 3, lit, 0.5 + random() * 0.4);
      }
    }
  }
  picture.rect(MARGIN, GROUND, span, 2, accent, 0.5);

  // Written in what the card has letters for, which every GitHub login is
  const name = [...cal.login].filter(canWrite).join('');
  const scale = nameScale(name);
  write(picture, name, MARGIN, NAME_TOP, scale, INK, scale >= WINDOWED_FROM ? Math.max(1, Math.round(scale / 7)) : 0);
  write(picture, cardSummary(cal), MARGIN, NAME_TOP + textHeight(scale) + 22, 4, [180, 199, 190]);

  write(picture, String(cal.firstYear), MARGIN, GROUND + 12, 2, MUTED);
  const lastYear = String(cal.lastYear);
  if (cal.lastYear !== cal.firstYear) {
    write(picture, lastYear, CARD_WIDTH - MARGIN - textWidth(lastYear, 2), GROUND + 12, 2, MUTED);
  }
  write(picture, 'contriscape', MARGIN, CARD_HEIGHT - 44, 3, accent);
  const disclaimer = 'Not affiliated with GitHub';
  write(picture, disclaimer, CARD_WIDTH - MARGIN - textWidth(disclaimer, 2), CARD_HEIGHT - 40, 2, MUTED);
  return picture;
}
