import { paintBadge } from './badge-art';
import type { Bars, CardKind, Story, StoryCard } from './story';

/** A card is drawn the size of a phone's story, which is the size the image is shared at. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

const MARGIN = 80;
const WIDE = CARD_WIDTH - MARGIN * 2;
/** The year's own colours: midnight blue and gold, as its ship and city are dressed in. */
const MIDNIGHT = '#141a35';
const DEEP = '#090d1c';
const GOLD = '#f2b632';
const CREAM = '#f7f0dd';
const DISPLAY = "'Mona Sans', 'Segoe UI', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace";

interface Paint {
  ground: string;
  ink: string;
  accent: string;
  dim: string;
  faint: string;
}
const NIGHT: Paint = {
  ground: MIDNIGHT,
  ink: CREAM,
  accent: GOLD,
  dim: 'rgba(247,240,221,.62)',
  faint: 'rgba(247,240,221,.16)',
};
const DAY: Paint = { ground: GOLD, ink: DEEP, accent: DEEP, dim: 'rgba(9,13,28,.7)', faint: 'rgba(9,13,28,.17)' };
/** Gold and midnight by turns, so each card reads as a new one. */
const PAINTS: Record<CardKind, Paint> = {
  opener: NIGHT,
  total: NIGHT,
  days: DAY,
  streak: NIGHT,
  peak: DAY,
  month: NIGHT,
  style: DAY,
  badges: NIGHT,
  summary: NIGHT,
};

/** The font size, at most `size`, at which `text` fits `width`. Leaves the context set to it. */
function fit(g: CanvasRenderingContext2D, text: string, weight: number, family: string, size: number, width: number) {
  let px = size;
  g.font = `${weight} ${px}px ${family}`;
  while (px > 24 && g.measureText(text).width > width) {
    px -= 4;
    g.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

/** `text` broken into lines no wider than `width`, in the context's font. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws `image` over the rectangle, cropped to fill it, as CSS's `object-fit: cover` would. */
function cover(g: CanvasRenderingContext2D, image: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  g.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

/** A night sky's few stars, the same ones every time for the same seed. */
function stars(g: CanvasRenderingContext2D, seed: number, bottom: number) {
  let s = seed;
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 70; n++) {
    g.fillStyle = `rgba(247,240,221,${(0.15 + random() * 0.45).toFixed(2)})`;
    g.beginPath();
    g.arc(random() * CARD_WIDTH, random() * bottom, 1 + random() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
}

/** Fades the card's ground over a picture, from `from` (none of it) to `to` (all of it). */
function fade(g: CanvasRenderingContext2D, from: number, to: number, colour: string) {
  const ramp = g.createLinearGradient(0, from, 0, to);
  ramp.addColorStop(0, `${colour}00`);
  ramp.addColorStop(1, colour);
  g.fillStyle = ramp;
  const top = Math.min(from, to);
  g.fillRect(0, top, CARD_WIDTH, Math.abs(to - from));
  g.fillStyle = colour;
  if (to > from) g.fillRect(0, to, CARD_WIDTH, CARD_HEIGHT - to);
  else g.fillRect(0, 0, CARD_WIDTH, to);
}

function bars(g: CanvasRenderingContext2D, { values, from, to, labels }: Bars, box: number[], paint: Paint) {
  const [x, y, w, h] = box;
  const top = Math.max(1, ...values);
  const step = w / values.length;
  const gap = step > 12 ? step * 0.22 : step * 0.18;
  const none = from < 0;
  values.forEach((value, i) => {
    const picked = i >= from && i <= to;
    const height = value ? Math.max(5, Math.sqrt(value / top) * h) : 3;
    // A bar picked out alone among hundreds is widened, or it would be lost
    const width = picked && from === to && step < 10 ? 10 : Math.max(1.5, step - gap);
    g.fillStyle = picked || none ? paint.accent : paint.faint;
    g.fillRect(x + i * step + (step - width) / 2, y + h - height, width, height);
  });
  if (from >= 0 && from === to && step < 10) {
    // A marker over a day picked out of the whole year
    const cx = x + (from + 0.5) * step;
    const height = Math.max(5, Math.sqrt(values[from] / top) * h);
    g.fillStyle = paint.accent;
    g.beginPath();
    g.moveTo(cx - 16, y + h - height - 42);
    g.lineTo(cx + 16, y + h - height - 42);
    g.lineTo(cx, y + h - height - 16);
    g.fill();
  }
  if (!labels) return;
  g.font = `600 30px ${MONO}`;
  g.textAlign = 'center';
  labels.forEach((label, i) => {
    g.fillStyle = i >= from && i <= to ? paint.accent : paint.dim;
    g.fillText(label, x + (i + 0.5) * step, y + h + 52);
  });
  g.textAlign = 'left';
}

/** The year's days as two half-years of weeks, lit where a day had a contribution. */
function grid(g: CanvasRenderingContext2D, story: Story, box: number[], paint: Paint) {
  const [x, y, w, h] = box;
  const weeks = Math.ceil((story.startDay + 366) / 7);
  const across = Math.ceil(weeks / 2);
  // As wide as the card allows, unless two half-years of seven rows would then run into the footer
  const cell = Math.min(w / across, (h - 44) / 14);
  const size = cell * 0.8;
  for (let i = 0; i < 366; i++) {
    const at = story.startDay + i;
    const week = Math.floor(at / 7);
    const half = week < across ? 0 : 1;
    const column = week - half * across;
    const row = at % 7;
    const counted = i < story.counts.length;
    if (!counted && i >= 365) continue;
    g.fillStyle = counted && story.counts[i] > 0 ? paint.accent : paint.faint;
    g.globalAlpha = counted ? 1 : 0.45;
    g.fillRect(x + column * cell, y + half * (cell * 7 + 44) + row * cell, size, size);
  }
  g.globalAlpha = 1;
}

function badgeArt(g: CanvasRenderingContext2D, ids: string[], box: number[]) {
  const [x, y, w, h] = box;
  const shown = ids.slice(0, 6);
  const perRow = Math.min(3, shown.length);
  const rows = Math.ceil(shown.length / perRow);
  const size = Math.min(250, (w - (perRow - 1) * 40) / perRow, (h - (rows - 1) * 40) / rows);
  const art = document.createElement('canvas');
  shown.forEach((id, n) => {
    const row = Math.floor(n / perRow);
    const inRow = Math.min(perRow, shown.length - row * perRow);
    const left = x + (w - (inRow * size + (inRow - 1) * 40)) / 2;
    paintBadge(art, id);
    g.drawImage(art, left + (n - row * perRow) * (size + 40), y + row * (size + 40), size, size);
  });
}

/** The words of an ordinary card: the kicker, the one big thing, and the sentence under it. Returns where they end. */
function words(g: CanvasRenderingContext2D, card: StoryCard, paint: Paint, top: number): number {
  g.fillStyle = paint.dim;
  g.font = `600 42px ${MONO}`;
  g.fillText(card.kicker.toUpperCase(), MARGIN, top);
  const size = fit(g, card.big, 800, DISPLAY, 250, WIDE);
  g.fillStyle = paint.accent;
  g.fillText(card.big, MARGIN - size * 0.03, top + 30 + size * 0.82);
  g.font = `500 58px ${DISPLAY}`;
  g.fillStyle = paint.ink;
  const lines = wrap(g, card.line, WIDE);
  let y = top + 30 + size * 0.82 + 125;
  for (const line of lines) {
    g.fillText(line, MARGIN, y);
    y += 74;
  }
  return y;
}

/** The site's name, top left. Top right is left clear for the viewer's close button, and the footer names the year. */
function header(g: CanvasRenderingContext2D, paint: Paint) {
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = paint.accent;
  g.font = `800 44px ${DISPLAY}`;
  g.fillText('contriscape', MARGIN, 128);
}

/** Whose year this is and where to watch it, an invitation to fly your own, and the line that this isn't GitHub's. */
function footer(g: CanvasRenderingContext2D, story: Story, paint: Paint) {
  g.fillStyle = paint.ink;
  fit(g, story.link, 600, MONO, 34, WIDE);
  g.fillText(story.link, MARGIN, 1758);
  g.fillStyle = paint.accent;
  const invite = `Fly your own year at ${story.site}`;
  fit(g, invite, 700, DISPLAY, 34, WIDE);
  g.fillText(invite, MARGIN, 1810);
  g.fillStyle = paint.dim;
  g.font = `400 24px ${MONO}`;
  g.fillText('Not affiliated with GitHub', MARGIN, 1856);
}

/**
 * Draws one card of a year's story onto `canvas`, at the size it is shared at. `city` is a picture of the year's city
 * at the end of its flight, for the first card and the last, which fall back to its weeks as a skyline without one.
 */
export function drawCard(canvas: HTMLCanvasElement, story: Story, card: StoryCard, city: HTMLCanvasElement | null) {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const g = canvas.getContext('2d');
  if (!g) return;
  const paint = PAINTS[card.kind];
  g.fillStyle = paint.ground;
  g.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  if (paint === NIGHT) stars(g, story.year * 7 + card.kind.length, 1100);

  if (card.kind === 'opener') {
    if (city) {
      cover(g, city, 0, 0, CARD_WIDTH, CARD_HEIGHT);
      fade(g, 420, 0, `${DEEP}`);
      fade(g, 1000, 1500, MIDNIGHT);
    } else if (card.bars) {
      bars(g, { values: weeklyOf(story), from: -1, to: -1 }, [MARGIN, 420, WIDE, 640], NIGHT);
    }
    header(g, NIGHT);
    g.fillStyle = CREAM;
    fit(g, card.kicker, 600, MONO, 56, WIDE);
    g.fillText(card.kicker, MARGIN, 1250);
    const size = fit(g, card.big, 800, DISPLAY, 360, WIDE);
    g.fillStyle = GOLD;
    g.fillText(card.big, MARGIN - size * 0.04, 1250 + 40 + size * 0.8);
    g.fillStyle = CREAM;
    g.font = `500 60px ${DISPLAY}`;
    g.fillText(card.line, MARGIN, 1250 + 40 + size * 0.8 + 110);
    footer(g, story, NIGHT);
    return;
  }

  if (card.kind === 'summary') {
    if (city) {
      cover(g, city, 0, 0, CARD_WIDTH, 820);
      fade(g, 520, 820, MIDNIGHT);
    } else if (card.bars) {
      bars(g, card.bars, [MARGIN, 260, WIDE, 480], NIGHT);
    }
    header(g, NIGHT);
    g.fillStyle = GOLD;
    fit(g, card.kicker, 600, MONO, 44, WIDE);
    g.fillText(card.kicker, MARGIN, 900);
    const size = fit(g, card.big, 800, DISPLAY, 200, WIDE);
    g.fillText(card.big, MARGIN - size * 0.03, 930 + size * 0.8);
    g.fillStyle = CREAM;
    g.font = `700 64px ${DISPLAY}`;
    g.fillText(card.line, MARGIN, 930 + size * 0.8 + 96);
    const rows = card.rows ?? [];
    const top = 930 + size * 0.8 + 180;
    const column = WIDE / 2;
    rows.slice(0, 8).forEach(([label, value], n) => {
      const x = MARGIN + (n % 2) * column;
      const y = top + Math.floor(n / 2) * 118;
      g.fillStyle = 'rgba(247,240,221,.62)';
      g.font = `600 28px ${MONO}`;
      g.fillText(label.toUpperCase(), x, y);
      g.fillStyle = CREAM;
      fit(g, value, 700, DISPLAY, 46, column - 30);
      g.fillText(value, x, y + 56);
    });
    footer(g, story, NIGHT);
    return;
  }

  header(g, paint);
  const end = words(g, card, paint, 470);
  const chartTop = Math.max(end + 40, 1180);
  const chart = [MARGIN, chartTop, WIDE, 1640 - chartTop];
  if (card.kind === 'days') grid(g, story, chart, paint);
  else if (card.badges) badgeArt(g, card.badges, chart);
  else if (card.bars) bars(g, card.bars, [chart[0], chart[1], chart[2], chart[3] - (card.bars.labels ? 70 : 0)], paint);
  footer(g, story, paint);
}

/** The year's days in weeks of seven from 1 January, each week's total. */
function weeklyOf(story: Story): number[] {
  return Array.from({ length: Math.ceil(story.counts.length / 7) }, (_, w) =>
    story.counts.slice(w * 7, w * 7 + 7).reduce((sum, n) => sum + n, 0),
  );
}
