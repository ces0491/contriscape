import { LOGIN_PATTERN } from '../shared/contract';
import { cardText, type Story } from './story';
import { drawCard } from './story-art';

/** How long a card stays before the next, while nobody has touched the story. `.story-bars` in the CSS matches it. */
export const CARD_SECONDS = 6;
/** A press held longer than this pauses the story, and letting go doesn't also turn the card. */
const HOLD_MS = 300;

const element = (id: string) => document.getElementById(id) as HTMLElement;

/** Whether this browser can hand a picture to another app, as phones can. */
function sharesFiles(): boolean {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([new Uint8Array(1)], 'card.png', { type: 'image/png' })] })
    );
  } catch {
    return false;
  }
}

/**
 * A year's story, card by card, over the city. Each card is drawn on a canvas the size of a phone's story, which is
 * the picture Share and Save hand over, so what is shared is what is on screen. Cards turn by themselves until the
 * visitor does anything with them, and a press held on a card pauses it.
 */
export class StoryView {
  private story: Story | null = null;
  private city: HTMLCanvasElement | null = null;
  private index = 0;
  private timer = 0;
  private shownAt = 0;
  /** Time left on the card while paused, in milliseconds. */
  private left = 0;
  private paused = false;
  /** Cards turn by themselves until the visitor steps through them or uses a button. */
  private auto = true;
  private pressedAt = 0;
  private swallow = false;
  private picture: Promise<Blob | null> = Promise.resolve(null);
  private readonly canvas = element('storyCard') as HTMLCanvasElement;

  constructor(private readonly hooks: { again: () => void; closed: () => void }) {
    const frame = element('storyFrame');
    frame.addEventListener('pointerdown', () => {
      this.pressedAt = performance.now();
      this.pause();
    });
    const release = () => {
      if (!this.pressedAt) return;
      this.swallow = performance.now() - this.pressedAt > HOLD_MS;
      this.pressedAt = 0;
      this.resume();
    };
    frame.addEventListener('pointerup', release);
    frame.addEventListener('pointercancel', release);
    frame.addEventListener('pointerleave', release);
    element('storyBack').addEventListener('click', () => this.step(-1));
    element('storyNext').addEventListener('click', () => this.step(1));
    element('storyClose').addEventListener('click', () => this.close());
    element('storyAgain').addEventListener('click', () => {
      this.close(false);
      this.hooks.again();
    });
    element('storySave').addEventListener('click', () => void this.save());
    element('storyShare').addEventListener('click', () => void this.share());
    element('storyCopy').addEventListener('click', (e) => void this.copy(e.currentTarget as HTMLElement));
    // Anyone watching someone else's year can fly their own, the same year, straight from here
    const own = element('storyOwnLogin') as HTMLInputElement;
    own.addEventListener('focus', () => this.hold());
    own.addEventListener('input', () => own.setCustomValidity(''));
    element('storyOwn').addEventListener('submit', (e) => {
      e.preventDefault();
      const login = own.value.trim().replace(/^@/, '');
      if (!this.story) return;
      if (!LOGIN_PATTERN.test(login)) {
        own.setCustomValidity("That isn't a GitHub username");
        own.reportValidity();
        return;
      }
      location.assign(`/${login}/${this.story.year}`);
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pause() : this.resume()));
    // In the capture phase, so the keys that fly the ship and pause a flight don't reach the app behind the story
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  get isOpen(): boolean {
    return this.story !== null;
  }

  /** The card on screen, from 0. */
  get at(): number {
    return this.index;
  }

  /** Opens a story at its first card. Waits for the fonts the cards are lettered in, briefly. */
  async open(story: Story, city: HTMLCanvasElement | null): Promise<void> {
    this.story = story;
    this.city = city;
    this.auto = true;
    this.paused = false;
    element('storyShare').hidden = !sharesFiles();
    element('storyCopy').textContent = 'Copy link';
    element('storyOwnLabel').textContent = `Fly your own ${story.year}`;
    element('storyBars').replaceChildren(...story.cards.map(() => document.createElement('span')));
    element('story').hidden = false;
    await Promise.race([
      Promise.all([
        document.fonts.load(`800 100px "Mona Sans"`),
        document.fonts.load(`600 40px "JetBrains Mono"`),
      ]).catch(() => undefined),
      new Promise((done) => setTimeout(done, 1500)),
    ]);
    // Closed while the fonts loaded
    if (this.story !== story) return;
    this.show(0);
  }

  /** Closes the story. `closed` is told unless the story is closing for another flight. */
  close(tell = true): void {
    if (!this.story) return;
    clearTimeout(this.timer);
    this.story = null;
    this.city = null;
    element('story').hidden = true;
    if (tell) this.hooks.closed();
  }

  private show(index: number): void {
    const story = this.story;
    if (!story) return;
    this.index = Math.max(0, Math.min(story.cards.length - 1, index));
    const card = story.cards[this.index];
    drawCard(this.canvas, story, card, this.city);
    this.canvas.setAttribute('aria-label', cardText(card));
    element('storySaid').textContent = cardText(card);
    // Restarts the entrance on every card, which reading the width between the two class changes forces
    this.canvas.classList.remove('enter');
    void this.canvas.offsetWidth;
    this.canvas.classList.add('enter');
    [...element('storyBars').children].forEach((bar, n) => {
      bar.className = n < this.index ? 'seen' : n === this.index && this.auto ? 'live' : n === this.index ? 'seen' : '';
    });
    const last = this.index === story.cards.length - 1;
    element('storyFrame').classList.toggle('last', last);
    this.picture = new Promise((done) => this.canvas.toBlob(done, 'image/png'));
    clearTimeout(this.timer);
    this.paused = false;
    element('story').classList.remove('paused');
    this.shownAt = performance.now();
    if (this.auto && !last) this.timer = window.setTimeout(() => this.show(this.index + 1), CARD_SECONDS * 1000);
  }

  private step(by: number): void {
    if (this.swallow) {
      this.swallow = false;
      return;
    }
    this.auto = false;
    this.show(this.index + by);
  }

  private pause(): void {
    if (!this.story || this.paused || !this.auto) return;
    clearTimeout(this.timer);
    this.paused = true;
    this.left = Math.max(0, CARD_SECONDS * 1000 - (performance.now() - this.shownAt));
    element('story').classList.add('paused');
  }

  private resume(): void {
    if (!this.story || !this.paused) return;
    this.paused = false;
    element('story').classList.remove('paused');
    const last = this.index === this.story.cards.length - 1;
    if (!this.auto || last) return;
    this.shownAt = performance.now() - (CARD_SECONDS * 1000 - this.left);
    this.timer = window.setTimeout(() => this.show(this.index + 1), this.left);
  }

  /** Stops the cards turning by themselves, once the visitor is doing something with one. */
  private hold(): void {
    this.auto = false;
    clearTimeout(this.timer);
    const live = element('storyBars').querySelector('.live');
    if (live) live.className = 'seen';
  }

  private key(e: KeyboardEvent): void {
    if (!this.story) return;
    // Typing a username moves the caret, and Enter sends the form
    const typing = e.target instanceof HTMLInputElement;
    if (!typing && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) {
      e.preventDefault();
      this.step(e.code === 'ArrowRight' ? 1 : -1);
    } else if (e.code === 'Escape') {
      this.close();
    } else if (e.code !== 'Space' && e.code !== 'Tab' && e.code !== 'Enter') {
      return;
    }
    e.stopPropagation();
  }

  private fileName(): string {
    const story = this.story as Story;
    const card = story.cards[this.index];
    return `contriscape-${story.login}-${story.year}-${String(this.index + 1).padStart(2, '0')}-${card.kind}.png`;
  }

  private link(): string {
    const story = this.story as Story;
    return `${location.origin}/${story.login}/${story.year}`;
  }

  private async save(): Promise<void> {
    if (!this.story) return;
    this.hold();
    const name = this.fileName();
    const blob = await this.picture;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private async share(): Promise<void> {
    const story = this.story;
    if (!story) return;
    this.hold();
    const name = this.fileName();
    const text = `${cardText(story.cards[this.index])} ${this.link()}`;
    // Drawn when the card was shown, so the share starts while the press still counts as one
    const blob = await this.picture;
    if (!blob) return;
    await navigator.share({ files: [new File([blob], name, { type: 'image/png' })], text }).catch(() => undefined);
  }

  private async copy(button: HTMLElement): Promise<void> {
    if (!this.story) return;
    this.hold();
    await navigator.clipboard
      .writeText(this.link())
      .then(() => {
        button.textContent = 'Copied';
      })
      .catch(() => undefined);
  }
}
