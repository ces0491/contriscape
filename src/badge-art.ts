/** Our own medallions, drawn at runtime. GitHub's achievement art is theirs and needs their written permission. */

type Draw = (g: CanvasRenderingContext2D) => void;

export interface BadgeDesign {
  rim: [string, string];
  face: [string, string];
  draw: Draw;
}

const SIZE = 256;
const INK = '#ffffff';
const SHADE = 'rgba(0,0,0,.32)';
const FACE = '"Mona Sans","Segoe UI",system-ui,sans-serif';

const GOLD: [string, string] = ['#ffe9a8', '#c98a1b'];
const SILVER: [string, string] = ['#f1f5f9', '#8a97a8'];
const COPPER: [string, string] = ['#ffc9a0', '#a85a2a'];

const word =
  (text: string, size: number): Draw =>
  (g) => {
    g.font = `800 ${size}px ${FACE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 4);
  };

const sunrise: Draw = (g) => {
  g.beginPath();
  g.arc(0, 22, 36, Math.PI, 0);
  g.closePath();
  g.fill();
  g.lineWidth = 8;
  for (let k = 0; k <= 4; k++) {
    const a = Math.PI + (k / 4) * Math.PI;
    g.beginPath();
    g.moveTo(Math.cos(a) * 48, 22 + Math.sin(a) * 48);
    g.lineTo(Math.cos(a) * 66, 22 + Math.sin(a) * 66);
    g.stroke();
  }
  g.fillRect(-62, 30, 124, 9);
};

const blocks: Draw = (g) => {
  const block = (x: number, y: number) => {
    g.beginPath();
    g.roundRect(x, y, 50, 30, 5);
    g.fill();
  };
  block(-54, 24);
  block(4, 24);
  block(-25, -14);
  g.globalAlpha = 0.6;
  block(-25, -52);
  g.globalAlpha = 1;
};

const merge: Draw = (g) => {
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-36, -44);
  g.lineTo(-36, 44);
  g.moveTo(-36, -22);
  g.bezierCurveTo(-36, 12, 36, -4, 36, 32);
  g.stroke();
  for (const [x, y] of [
    [-36, -48],
    [-36, 48],
    [36, 40],
  ]) {
    g.beginPath();
    g.arc(x, y, 15, 0, Math.PI * 2);
    g.fill();
  }
};

const speech: Draw = (g) => {
  g.beginPath();
  g.roundRect(-58, -48, 116, 76, 18);
  g.moveTo(-26, 24);
  g.lineTo(-38, 56);
  g.lineTo(0, 26);
  g.fill();
  g.fillStyle = '#1d3a6e';
  g.beginPath();
  g.roundRect(-6, -36, 12, 34, 5);
  g.arc(0, 11, 7, 0, Math.PI * 2);
  g.fill();
};

const sprout: Draw = (g) => {
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, 56);
  g.lineTo(0, -6);
  g.stroke();
  const leaf = (dir: number) => {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(dir * 12, -48, dir * 48, -50, dir * 62, -44);
    g.bezierCurveTo(dir * 62, -8, dir * 34, 8, 0, 0);
    g.fill();
  };
  leaf(1);
  leaf(-1);
  g.fillRect(-46, 50, 92, 9);
};

const flame: Draw = (g) => {
  g.beginPath();
  g.moveTo(0, -68);
  g.bezierCurveTo(10, -30, 52, -18, 50, 22);
  g.bezierCurveTo(48, 58, 22, 66, 0, 66);
  g.bezierCurveTo(-22, 66, -50, 54, -50, 20);
  g.bezierCurveTo(-50, -2, -30, -8, -26, -30);
  g.bezierCurveTo(-14, -22, -10, -14, -10, -4);
  g.bezierCurveTo(0, -20, 4, -44, 0, -68);
  g.fill();
  g.fillStyle = '#ffd24a';
  g.beginPath();
  g.moveTo(2, 8);
  g.bezierCurveTo(8, 24, 26, 30, 24, 44);
  g.bezierCurveTo(22, 58, 8, 62, 0, 62);
  g.bezierCurveTo(-10, 62, -24, 56, -24, 42);
  g.bezierCurveTo(-24, 30, -6, 26, 2, 8);
  g.fill();
};

const summit: Draw = (g) => {
  g.beginPath();
  g.moveTo(-68, 52);
  g.lineTo(-16, -32);
  g.lineTo(8, 4);
  g.lineTo(24, -14);
  g.lineTo(68, 52);
  g.closePath();
  g.fill();
  g.fillStyle = '#ff5a47';
  g.fillRect(-18, -66, 5, 38);
  g.beginPath();
  g.moveTo(-13, -66);
  g.lineTo(16, -56);
  g.lineTo(-13, -46);
  g.fill();
};

export const BADGE_ART: Record<string, BadgeDesign> = {
  joined: { rim: SILVER, face: ['#f59e4b', '#3a2a78'], draw: sunrise },
  'first-repository': { rim: COPPER, face: ['#4f8fd6', '#1f3d7a'], draw: blocks },
  'first-pull-request': { rim: SILVER, face: ['#a06bf0', '#4a2a99'], draw: merge },
  'first-issue': { rim: COPPER, face: ['#35b6c9', '#17567a'], draw: speech },
  'first-contribution': { rim: COPPER, face: ['#5fcf6a', '#17693b'], draw: sprout },
  'hundred-club': { rim: COPPER, face: ['#e0668f', '#7a1f4f'], draw: word('100', 68) },
  'thousand-club': { rim: SILVER, face: ['#6b7cf0', '#2a2f8f'], draw: word('1K', 88) },
  'ten-thousand-club': { rim: GOLD, face: ['#f2b53a', '#a3480f'], draw: word('10K', 72) },
  'full-week': { rim: SILVER, face: ['#38c9a0', '#0f6a66'], draw: word('7', 112) },
  'longest-streak': { rim: GOLD, face: ['#e8553a', '#7a1626'], draw: flame },
  'busiest-day': { rim: GOLD, face: ['#3f7fd0', '#142a5c'], draw: summit },
};

const diagonal = (g: CanvasRenderingContext2D, r: number, [a, b]: [string, string]) => {
  const gradient = g.createLinearGradient(-r, -r, r, r);
  gradient.addColorStop(0, a);
  gradient.addColorStop(1, b);
  return gradient;
};

export function paintBadge(canvas: HTMLCanvasElement, id: string): void {
  const design = BADGE_ART[id];
  const g = canvas.getContext('2d');
  if (!g || !design) return;
  canvas.width = canvas.height = SIZE;
  g.clearRect(0, 0, SIZE, SIZE);
  g.translate(SIZE / 2, SIZE / 2);
  g.scale(SIZE / 200, SIZE / 200);

  g.beginPath();
  g.arc(0, 0, 99, 0, Math.PI * 2);
  g.fillStyle = diagonal(g, 99, design.rim);
  g.fill();
  g.beginPath();
  g.arc(0, 0, 84, 0, Math.PI * 2);
  g.fillStyle = diagonal(g, 84, design.face);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, 84, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,.1)';
  g.beginPath();
  g.ellipse(-16, -62, 100, 54, -0.3, 0, Math.PI * 2);
  g.fill();
  g.restore();

  g.save();
  g.shadowColor = SHADE;
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fillStyle = INK;
  g.strokeStyle = INK;
  design.draw(g);
  g.restore();
}
