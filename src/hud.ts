import { describeCount, formatCount, MONTHS, type Calendar, type Span } from './calendar';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const MONO = '"JetBrains Mono",Consolas,monospace';

export interface Scope extends Span {
  key: 'all' | number;
  label: string;
}

/** The readouts, stats and timeline. Nothing here touches the 3D scene. */
export class Hud {
  private scope: Scope;
  private shownDay = -1;
  private play = 0;
  private readonly spark = element<HTMLCanvasElement>('spark');
  private readonly head = element('head');
  readonly scrub = element<HTMLInputElement>('scrub');
  private readonly tip = element('tip');
  private readonly colours = {
    muted: cssVar('--ink-3'),
    label: cssVar('--ink-2'),
    past: cssVar('--g4'),
    future: cssVar('--g4-dim'),
    rule: cssVar('--rule'),
  };

  constructor(
    private readonly cal: Calendar,
    scope: Scope,
    private dragging: () => boolean,
  ) {
    this.scope = scope;
    const timeline = element('timeline');
    timeline.addEventListener('pointermove', (e) => {
      const r = timeline.getBoundingClientRect();
      const { a, b } = this.scope;
      const day = a + Math.floor(clamp((e.clientX - r.left) / r.width, 0, 0.9999) * (b - a + 1));
      const week = a + Math.floor((day - a) / 7) * 7;
      this.showTip(
        e.clientX,
        r.top,
        `Week of ${cal.formatShort(week)}`,
        describeCount(cal.sum(week, Math.min(b, week + 6))),
      );
    });
    timeline.addEventListener('pointerleave', () => this.hideTip());
  }

  setScope(scope: Scope): void {
    this.scope = scope;
    element('scopeLabel').textContent = scope.label;
    this.scrub.min = String(scope.a);
    this.scrub.max = String(scope.b);
    this.shownDay = -1;

    const { cal } = this;
    const { a, b } = scope;
    let best = a;
    let run = 0;
    let longest = 0;
    let active = 0;
    for (let i = a; i <= b; i++) {
      if (cal.counts[i] > cal.counts[best]) best = i;
      if (cal.counts[i]) {
        active++;
        run++;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    element('busiest').textContent = cal.sum(a, b)
      ? `${formatCount(cal.counts[best])} · ${cal.formatShort(best)}`
      : 'None';
    element('streak').textContent = `${formatCount(longest)} day${longest === 1 ? '' : 's'}`;
    element('active').textContent = `${formatCount(active)} of ${formatCount(b - a + 1)}`;
    this.drawTimeline();
  }

  update(play: number): void {
    this.play = play;
    const { a, b } = this.scope;
    const day = clamp(Math.floor(play), a, b);
    this.head.style.left = `${((clamp(play, a, b + 1) - a) / (b - a + 1)) * 100}%`;
    if (day === this.shownDay) return;
    this.shownDay = day;
    element('date').textContent = this.cal.formatDate(day);
    element('dayCount').textContent = describeCount(this.cal.counts[day]);
    element('running').textContent = formatCount(this.cal.sum(a, day));
    if (!this.dragging()) this.scrub.value = String(day);
    this.drawTimeline();
  }

  drawTimeline(): void {
    const canvas = this.spark;
    const box = canvas.getBoundingClientRect();
    const g = canvas.getContext('2d');
    if (!box.width || !g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(box.width * dpr);
    const pixelHeight = Math.round(box.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const { cal, scope, colours } = this;
    const w = box.width;
    const h = box.height;
    const base = h - 14;
    const weeks: { day: number; total: number }[] = [];
    for (let day = scope.a; day <= scope.b; day += 7) {
      weeks.push({ day, total: cal.sum(day, Math.min(scope.b, day + 6)) });
    }
    const tallest = Math.max(1, ...weeks.map((b) => b.total));
    const span = scope.b - scope.a + 1;
    const xOf = (day: number) => ((day - scope.a) / span) * w;
    const pitch = (7 / span) * w;
    const barWidth = Math.max(1, pitch - (pitch > 4 ? 2 : pitch > 2 ? 0.75 : 0));
    const now = clamp(Math.floor(this.play), scope.a, scope.b);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = colours.rule;
    g.fillRect(0, base, w, 1);

    let peak = weeks[0];
    for (const bar of weeks) {
      if (bar.total > peak.total) peak = bar;
      if (!bar.total) continue;
      const height = Math.max(1.5, (bar.total / tallest) * (base - 13));
      const radius = Math.min(barWidth / 2, 3);
      g.fillStyle = bar.day <= now ? colours.past : colours.future;
      g.beginPath();
      g.roundRect(xOf(bar.day), base - height, barWidth, height, [radius, radius, 0, 0]);
      g.fill();
    }

    g.font = `400 10px ${MONO}`;
    g.fillStyle = colours.muted;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    const ticks =
      scope.key === 'all'
        ? cal.years.map((y) => ({ day: cal.span(y).a, text: String(y) }))
        : MONTHS.map((text, month) => ({ day: cal.dayOf(scope.key as number, month), text })).filter(
            (t) => t.day <= scope.b,
          );
    const every = Math.ceil(34 / Math.max(1, w / ticks.length));
    ticks.forEach((tick, i) => {
      const x = xOf(tick.day);
      if (i % every === 0 && x + g.measureText(tick.text).width <= w) g.fillText(tick.text, x, h - 2);
    });

    if (peak.total) {
      const x = xOf(peak.day) + barWidth / 2;
      g.fillStyle = colours.label;
      g.textAlign = x > w - 30 ? 'right' : x < 30 ? 'left' : 'center';
      g.fillText(formatCount(peak.total), clamp(x, 0, w), base - (peak.total / tallest) * (base - 13) - 3);
    }
  }

  showTip(x: number, y: number, title: string, detail: string): void {
    const tip = this.tip;
    const heading = document.createElement('b');
    const body = document.createElement('span');
    heading.textContent = title;
    body.textContent = detail;
    tip.replaceChildren(heading, body);
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.transform = `translate(${clamp(x + 14, 8, innerWidth - r.width - 8)}px,${clamp(y - r.height - 12, 8, innerHeight - r.height - 8)}px)`;
  }

  hideTip(): void {
    this.tip.hidden = true;
  }
}
