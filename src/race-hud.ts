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
  rival: string;
  /** This ship's fastest time here, or null. */
  best: string | null;
  won: boolean;
  /** Set for the year a challenge or the day's course is on. */
  tag: string | null;
}

/** Writes text into an element only when it has changed, because the readout is written every frame. */
function write(box: HTMLElement, text: string): void {
  if (box.textContent !== text) box.textContent = text;
  box.hidden = text === '';
}

/** The race's readout, countdown and result, its panel of years, and the card a challenge link opens with. */
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

  /** The countdown's number or word in the middle of the view, or nothing with `null`. */
  countdown(text: string | null): void {
    const box = element('countdown');
    box.hidden = text === null;
    if (text !== null) write(box.firstElementChild as HTMLElement, text);
  }

  showResult(title: string, facts: [string, string][]): void {
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
    element('raceResult').hidden = false;
  }

  hideResult(): void {
    element('raceResult').hidden = true;
  }

  get resultShown(): boolean {
    return !element('raceResult').hidden;
  }

  /** The years that can be raced, with the rival's time and this ship's best on each. */
  renderList(rows: RaceRow[], ship: string, start: (year: number) => void): void {
    element('raceShip').textContent = `Bests are kept for each ship. These are the ${ship}'s.`;
    element('raceList').replaceChildren(
      ...rows.map((row) => {
        const item = document.createElement('li');
        const go = document.createElement('button');
        go.type = 'button';
        go.dataset.year = String(row.year);
        const year = document.createElement('b');
        year.textContent = String(row.year);
        if (row.won) {
          const won = document.createElement('em');
          won.textContent = 'Beaten';
          year.append(won);
        }
        if (row.tag) {
          const tag = document.createElement('em');
          tag.className = 'tag';
          tag.textContent = row.tag;
          year.append(tag);
        }
        const times = document.createElement('span');
        times.textContent = row.best ? `Rival ${row.rival} · Best ${row.best}` : `Rival ${row.rival}`;
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
