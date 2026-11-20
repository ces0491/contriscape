/**
 * The music: a slow chord progression on a soft pad and bass, with a melody played from the history itself. Busier days
 * play higher notes, and a quiet stretch plays nothing, so a year's shape can be heard as well as seen.
 */

export const TEMPO = 96;
/** The melody moves on eighth notes. */
export const STEP = 60 / TEMPO / 2;
/** Steps in a bar of four beats. */
const BAR_STEPS = 8;
/** Each chord lasts two bars. */
const CHORD_STEPS = BAR_STEPS * 2;
/** How far ahead of the audio clock notes are booked, in seconds. Enough to ride out a slow frame. */
const LOOKAHEAD = 0.16;
/** A clock this far behind its next step has been asleep, in a hidden tab, and starts again from now. */
const ASLEEP = 0.4;
const PAD_ATTACK = 1.4;
const PAD_RELEASE = 2.2;
const QUIET = 0.0001;

/** D minor pentatonic over two octaves, from D4. */
export const MELODY = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86];

/**
 * Dm7, B♭maj7, F6 and Csus2, as MIDI notes for the pad, with the root an octave or two down for the bass. They're voiced
 * so no melody note lands a semitone above a chord note, the clash a pentatonic melody can still make.
 */
export const CHORDS: { pad: number[]; bass: number }[] = [
  { pad: [50, 57, 60, 65], bass: 38 },
  { pad: [46, 53, 57, 62], bass: 34 },
  { pad: [53, 57, 60, 62], bass: 41 },
  { pad: [48, 55, 60, 62], bass: 36 },
];

export const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/** The melody note for a day, from its share of the busiest day. Heights are square roots, so the notes are too. */
export function melodyNote(share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return MELODY[Math.min(MELODY.length - 1, Math.round(Math.sqrt(s) * (MELODY.length - 1)))];
}

/** How hard a note is played, from its share of the busiest day. Even a quiet day is heard. */
export const melodyLevel = (share: number): number => 0.4 + 0.6 * Math.sqrt(Math.min(1, Math.max(0, share)));

/** The busiest count among days after `from` up to and including `to`. Zero when the span is empty or out of range. */
export function busiestBetween(counts: ArrayLike<number>, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from) + 1);
  const b = Math.min(counts.length - 1, Math.floor(to));
  let best = 0;
  for (let i = a; i <= b; i++) best = Math.max(best, counts[i]);
  return best;
}

/** The chord playing at a step. */
export const chordAt = (step: number): (typeof CHORDS)[number] =>
  CHORDS[Math.floor(step / CHORD_STEPS) % CHORDS.length];

/**
 * What the music follows this frame: the date as Autopilot replays it, the day under a piloted ship, or nothing, which
 * leaves the chords playing on their own.
 */
export type Cue = { kind: 'history'; day: number } | { kind: 'flight'; day: number } | { kind: 'still' };

interface Pad {
  stop(at: number): void;
}

/** Plays the music into `out`, booking notes a little ahead on the audio clock. */
export class Music {
  private next = 0;
  private step = 0;
  private lastDay: number | null = null;
  /** The busiest day the ship has crossed since the last step, in Pilot. */
  private crossed = 0;
  private lastCell = -1;
  /** A tower pointed at in Orbit, played on the next step. */
  private touched = -1;
  private pad: Pad | null = null;
  private running = false;
  /** Bells for a year's flight: the melody rung, and the chord's notes run up high as it changes. */
  festive = false;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly echo: AudioNode,
    private readonly counts: ArrayLike<number>,
    private readonly peak: number,
  ) {}

  /** Starts on the next step, from the top of the progression. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.next = this.context.currentTime + 0.1;
    this.step = 0;
    this.lastDay = null;
  }

  /** Lets the pad ring out and books nothing more. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.pad?.stop(this.context.currentTime);
    this.pad = null;
  }

  /** A tower pointed at, played on the next step if nothing else is. */
  touch(day: number): void {
    this.touched = day;
  }

  /** Follows this frame's cue and books every step that falls inside the lookahead. */
  update(cue: Cue): void {
    if (!this.running) return;
    if (cue.kind === 'flight' && cue.day !== this.lastCell) {
      this.lastCell = cue.day;
      if (cue.day >= 0) this.crossed = Math.max(this.crossed, this.counts[cue.day] ?? 0);
    }
    const now = this.context.currentTime;
    if (this.next < now - ASLEEP) this.next = now + 0.05;
    while (this.next < now + LOOKAHEAD) {
      this.play(this.step, this.next, cue);
      this.step++;
      this.next += STEP;
    }
  }

  private play(step: number, at: number, cue: Cue): void {
    const chord = chordAt(step);
    if (step % CHORD_STEPS === 0) {
      this.pad?.stop(at + 0.3);
      this.pad = this.startPad(chord.pad, at);
      // The chord's own notes, two octaves up, so they can't clash with the melody any more than the chord does
      if (this.festive) chord.pad.forEach((note, i) => this.bell(note + 24, 0.35, at + (i * STEP) / 2));
    }
    if (step % BAR_STEPS === 0) this.bass(chord.bass, at);

    let count = 0;
    if (cue.kind === 'history') {
      if (this.lastDay !== null && cue.day > this.lastDay) count = busiestBetween(this.counts, this.lastDay, cue.day);
      this.lastDay = cue.day;
    } else {
      this.lastDay = null;
      if (cue.kind === 'flight') count = this.crossed;
    }
    this.crossed = 0;
    if (!count && this.touched >= 0) count = this.counts[this.touched] ?? 0;
    this.touched = -1;
    if (count > 0 && this.peak > 0) this.pluck(melodyNote(count / this.peak), melodyLevel(count / this.peak), at);
  }

  /**
   * A rung bell: a sine at the note with two quieter partials at the uneven ratios a bell's metal gives, ringing for two
   * seconds, into the echo too.
   */
  private bell(note: number, level: number, at: number): void {
    const { context } = this;
    const hz = midiToHz(note);
    const gain = context.createGain();
    gain.gain.setValueAtTime(QUIET, at);
    gain.gain.exponentialRampToValueAtTime(0.1 * level, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(QUIET, at + 2.2);
    gain.connect(this.out);
    gain.connect(this.echo);
    [
      [hz, 1],
      [hz * 2.76, 0.4],
      [hz * 5.4, 0.16],
    ].forEach(([frequency, share]) => {
      const oscillator = context.createOscillator();
      const voice = context.createGain();
      oscillator.frequency.value = frequency;
      voice.gain.value = share;
      oscillator.connect(voice).connect(gain);
      oscillator.start(at);
      oscillator.stop(at + 2.25);
    });
  }

  /** A soft bell: a triangle with a quieter octave above, fading over most of a second, into the echo too. */
  private pluck(note: number, level: number, at: number): void {
    if (this.festive) {
      this.bell(note, level, at);
      return;
    }
    const { context } = this;
    const hz = midiToHz(note);
    const gain = context.createGain();
    gain.gain.setValueAtTime(QUIET, at);
    gain.gain.exponentialRampToValueAtTime(0.11 * level, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(QUIET, at + 1.1);
    gain.connect(this.out);
    gain.connect(this.echo);
    [
      ['triangle', hz, 1],
      ['sine', hz * 2, 0.35],
    ].forEach(([type, frequency, share]) => {
      const oscillator = context.createOscillator();
      const voice = context.createGain();
      oscillator.type = type as OscillatorType;
      oscillator.frequency.value = frequency as number;
      voice.gain.value = share as number;
      oscillator.connect(voice).connect(gain);
      oscillator.start(at);
      oscillator.stop(at + 1.15);
    });
  }

  private bass(note: number, at: number): void {
    const { context } = this;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = midiToHz(note);
    gain.gain.setValueAtTime(QUIET, at);
    gain.gain.exponentialRampToValueAtTime(0.13, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(QUIET, at + STEP * BAR_STEPS * 0.95);
    oscillator.connect(gain).connect(this.out);
    oscillator.start(at);
    oscillator.stop(at + STEP * BAR_STEPS);
  }

  /** A warm pad: two slightly detuned saws per note through a low-pass, swelling in and fading out slowly. */
  private startPad(notes: number[], at: number): Pad {
    const { context } = this;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 820;
    filter.Q.value = 0.6;
    const gain = context.createGain();
    gain.gain.setValueAtTime(QUIET, at);
    gain.gain.exponentialRampToValueAtTime(0.045, at + PAD_ATTACK);
    filter.connect(gain).connect(this.out);
    const oscillators = notes.flatMap((note) =>
      [-6, 6].map((cents) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = midiToHz(note);
        oscillator.detune.value = cents;
        oscillator.connect(filter);
        oscillator.start(at);
        return oscillator;
      }),
    );
    return {
      stop(when) {
        const from = Math.max(when, context.currentTime);
        gain.gain.cancelScheduledValues(from);
        gain.gain.setTargetAtTime(QUIET, from, PAD_RELEASE / 4);
        oscillators.forEach((oscillator) => oscillator.stop(from + PAD_RELEASE));
      },
    };
  }
}
