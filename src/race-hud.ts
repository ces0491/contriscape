const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** What the race readout shows this frame. */
export interface Readout {
  gate: string;
  clock: string;
  /** Ahead of or behind the rival at the last gate, or empty before the first. */
  gap: string;
  /** The time a challenge set, or empty. */
  target: string;
  score: string;
  /** The chain of near misses not yet banked, or empty. */
  chain: string;
}

/** A year in the Race panel. */
export interface RaceRow {
  year: number;
  /** The times to beat and this ship's best here. */
  times: string;
  /** What has been done on this year in any ship, such as beating the rival, or null. */
  mark: string | null;
  /** Set for the year a challenge or the day's course is on. */
  tag: string | null;
}

/** The two kinds of race: against Autopilot through gates, or against the clock through rings. */
export type RaceKind = 'rival' | 'clock';

const ABOUT: Record<RaceKind, string> = {
  rival:
    "Race the Autopilot down a year's alleys and once round its busiest day. Fly through each gold gate in turn. " +
    "Clipping a tower costs speed. Passing close to towers at speed scores near misses, which a clip loses before they're banked.",
  clock:
    'Beat the clock through gold rings, out to the far end of a year and back: low down its alleys, over its roofs, ' +
    'and round a loop past the end. Each ring adds time, and the clock running out ends the run. Clipping a tower costs speed.',
};
const COUNTDOWN_NOTE: Record<RaceKind, string> = {
  rival: 'Fly through each gold gate in turn',
  clock: 'Each ring adds time. Keep the clock from running out',
};

/** Writes text into an element only when it has changed, because the readout is written every frame. */
function write(box: HTMLElement, text: string): void {
  if (box.textContent !== text) box.textContent = text;
  box.hidden = text === '';
}

/**
 * The readout, countdown and result of a race or a time attack, the panel of years for each, and the card a challenge
 * link opens with.
 */
export class RaceHud {
  private readonly box = element('raceHud');
  private readonly parts = {
    gate: element('raceGate'),
    clock: element('raceClock'),
    gap: element('raceGap'),
    target: element('raceTarget'),
    score: element('raceScore'),
    chain: element('raceChain'),
  };
  private lostTimer = 0;

  /** Shows the readout, or hides it with `null`. */
  show(readout: Readout | null): void {
    this.box.hidden = readout === null;
    if (!readout) return;
    (Object.keys(this.parts) as (keyof Readout)[]).forEach((key) => write(this.parts[key], readout[key]));
  }

  /** Marks the score for a moment when a clip loses a chain. */
  lost(): void {
    this.parts.score.classList.add('lost');
    clearTimeout(this.lostTimer);
    this.lostTimer = window.setTimeout(() => this.parts.score.classList.remove('lost'), 900);
  }

  /** Marks the clock as running low, or not. */
  urgent(on: boolean): void {
    this.parts.clock.classList.toggle('low', on);
  }

  /** The countdown's number or word in the middle of the view, or nothing with `null`, and what to do in this race. */
  countdown(text: string | null, kind: RaceKind = 'rival'): void {
    const box = element('countdown');
    box.hidden = text === null;
    if (text === null) return;
    write(box.firstElementChild as HTMLElement, text);
    write(box.lastElementChild as HTMLElement, COUNTDOWN_NOTE[kind]);
  }

  /** The result of a race, with a challenge to copy only where there is one to send. */
  showResult(title: string, facts: [string, string][], copyable = true): void {
    element('raceResultTitle').textContent = title;
    element('raceResultFacts').replaceChildren(
      ...facts.flatMap(([label, value]) => {
        const term = document.createElement('dt');
        const definition = document.createElement('dd');
        term.textContent = label;
        definition.textContent = value;
        return [term, definition];
      }),
    );
    element('raceCopy').textContent = 'Copy a challenge';
    element('raceCopy').hidden = !copyable;
    element('raceResult').hidden = false;
  }

  hideResult(): void {
    element('raceResult').hidden = true;
  }

  get resultShown(): boolean {
    return !element('raceResult').hidden;
  }

  /** The years that can be raced in this kind of race, with the times to beat and this ship's best on each. */
  renderList(kind: RaceKind, rows: RaceRow[], ship: string, start: (year: number) => void): void {
    (['rival', 'clock'] as const).forEach((each) =>
      element(each === 'rival' ? 'raceKindRival' : 'raceKindClock').setAttribute('aria-pressed', String(each === kind)),
    );
    element('raceAbout').textContent = ABOUT[kind];
    element('raceShip').textContent = `Bests are kept for each ship. These are the ${ship}'s.`;
    element('raceList').replaceChildren(
      ...rows.map((row) => {
        const item = document.createElement('li');
        const go = document.createElement('button');
        go.type = 'button';
        go.dataset.year = String(row.year);
        const year = document.createElement('b');
        year.textContent = String(row.year);
        if (row.mark) {
          const mark = document.createElement('em');
          mark.textContent = row.mark;
          year.append(mark);
        }
        if (row.tag) {
          const tag = document.createElement('em');
          tag.className = 'tag';
          tag.textContent = row.tag;
          year.append(tag);
        }
        const times = document.createElement('span');
        times.textContent = row.times;
        go.append(year, times);
        go.addEventListener('click', () => start(row.year));
        item.append(go);
        return item;
      }),
    );
  }

  /** The card a challenge link or the day's course opens with, or nothing with `null`. */
  showChallenge(text: string | null): void {
    element('challenge').hidden = text === null;
    if (text !== null) element('challengeText').textContent = text;
  }
}
