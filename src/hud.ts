import { describeCount, formatCount, MONTHS, type Calendar, type Span } from './calendar';
import type { ColourRow, Colours, Rgb } from './colours';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const MONO = '"JetBrains Mono",Consolas,monospace';
const TOAST_SECONDS = 5;

export interface Scope extends Span {
  key: 'all' | number;
  label: string;
}

/** The readouts, stats and timeline. Nothing here touches the 3D scene. */
export class Hud {
  private scope: Scope;
  private shownDay = -1;
  private play = 0;
  private toastTimer = 0;
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
    let active = 0;
    for (let i = a; i <= b; i++) {
      if (cal.counts[i] > cal.counts[best]) best = i;
      if (cal.counts[i]) active++;
    }
    const longest = cal.longestStreak(a, b).length;
    element('busiest').textContent = cal.sum(a, b)
      ? `${formatCount(cal.counts[best])} · ${cal.formatShort(best)}`
      : 'None';
    element('streak').textContent = `${formatCount(longest)} day${longest === 1 ? '' : 's'}`;
    element('active').textContent = `${formatCount(active)} of ${formatCount(b - a + 1)}`;
    this.drawTimeline();
  }

  /** Keeps the timeline and the green controls matched to the buildings. */
  setAccent(colour: Rgb): void {
    const channels = colour.map((v) => Math.round(v * 255)).join(',');
    const root = document.documentElement.style;
    root.setProperty('--g4', `rgb(${channels})`);
    root.setProperty('--g4-dim', `rgba(${channels},0.3)`);
    this.colours.past = cssVar('--g4');
    this.colours.future = cssVar('--g4-dim');
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

  showToast(title: string, detail: string, picture: string): void {
    const toast = element('toast');
    const image = document.createElement('img');
    image.src = picture;
    image.alt = '';
    this.fill(toast, title, detail);
    toast.prepend(image);
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, TOAST_SECONDS * 1000);
  }

  showCaption(title: string, detail: string): void {
    const caption = element('caption');
    this.fill(caption, title, detail);
    caption.hidden = false;
  }

  hideCaption(): void {
    element('caption').hidden = true;
  }

  private fill(box: HTMLElement, title: string, detail: string): void {
    const heading = document.createElement('b');
    const body = document.createElement('span');
    heading.textContent = title;
    body.textContent = detail;
    box.replaceChildren(heading, body);
  }

  /** The badge count, and the list a visitor can jump to a badge from. */
  renderBadges(
    rows: { name: string; detail: string; date: string; earned: boolean; picture: string }[],
    visit: (index: number) => void,
  ): void {
    const button = element('badges');
    const earned = rows.filter((r) => r.earned).length;
    button.textContent = `Badges ${earned}/${rows.length}`;
    button.hidden = rows.length === 0;
    element('badgeReset').hidden = earned === 0;
    const list = element('badgeList');
    list.replaceChildren(
      ...rows.map((row, i) => {
        const item = document.createElement('li');
        const go = document.createElement('button');
        go.type = 'button';
        go.className = row.earned ? 'earned' : '';
        const image = document.createElement('img');
        image.src = row.picture;
        image.alt = '';
        const name = document.createElement('b');
        name.textContent = `${row.earned ? '✓ ' : ''}${row.name}`;
        const detail = document.createElement('span');
        detail.textContent = `${row.detail} · ${row.date}`;
        const words = document.createElement('div');
        words.append(name, detail);
        go.append(image, words);
        go.addEventListener('click', () => visit(i));
        item.append(go);
        return item;
      }),
    );
  }

  /** A row of swatches and a free picker for each part of the scene. */
  renderColours(rows: ColourRow[], choose: (key: keyof Colours, hex: string) => void): void {
    element('colourRows').replaceChildren(
      ...rows.map(({ key, label, swatches }) => {
        const row = document.createElement('div');
        row.className = 'colour-row';
        const heading = document.createElement('h3');
        heading.textContent = label;
        const choices = document.createElement('div');
        choices.className = 'swatches';
        choices.dataset.key = key;
        swatches.forEach(({ name, hex }) => {
          const swatch = document.createElement('button');
          swatch.type = 'button';
          swatch.dataset.hex = hex;
          swatch.style.background = hex;
          swatch.setAttribute('aria-label', `${name} ${label.toLowerCase()}`);
          swatch.addEventListener('click', () => choose(key, hex));
          choices.append(swatch);
        });
        const custom = document.createElement('label');
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.setAttribute('aria-label', `Custom ${label.toLowerCase()} colour`);
        picker.addEventListener('input', () => choose(key, picker.value));
        custom.append(picker, 'Custom');
        choices.append(custom);
        row.append(heading, choices);
        return row;
      }),
    );
  }

  /** Shows the current choices. It leaves the rows in place, because rebuilding one would close an open picker. */
  syncColours(colours: Colours): void {
    document.querySelectorAll<HTMLElement>('.swatches').forEach((choices) => {
      const current = colours[choices.dataset.key as keyof Colours];
      choices.querySelectorAll('button').forEach((swatch) => {
        swatch.setAttribute('aria-pressed', String(swatch.dataset.hex === current));
      });
      (choices.querySelector('input') as HTMLInputElement).value = current;
    });
  }

  showSummary(title: string, facts: [string, string][]): void {
    element('summaryTitle').textContent = title;
    element('summaryFacts').replaceChildren(
      ...facts.flatMap(([label, value]) => {
        const term = document.createElement('dt');
        const definition = document.createElement('dd');
        term.textContent = label;
        definition.textContent = value;
        return [term, definition];
      }),
    );
    element('summary').hidden = false;
  }
}
