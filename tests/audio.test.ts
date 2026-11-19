import { describe, expect, it } from 'vitest';
import {
  busiestBetween,
  chordAt,
  CHORDS,
  MELODY,
  melodyLevel,
  melodyNote,
  midiToHz,
  Music,
  STEP,
  type Cue,
} from '../src/music';
import { engineTone, stereo } from '../src/sound';

/** D, F, G, A and C. */
const PENTATONIC = new Set([2, 5, 7, 9, 0]);

describe('melodyNote', () => {
  it('plays a quiet day low and the busiest day at the top', () => {
    expect(melodyNote(0)).toBe(MELODY[0]);
    expect(melodyNote(1)).toBe(MELODY[MELODY.length - 1]);
  });

  it('never falls as a day gets busier', () => {
    let last = -Infinity;
    for (let share = 0; share <= 1; share += 0.01) {
      const note = melodyNote(share);
      expect(note).toBeGreaterThanOrEqual(last);
      last = note;
    }
  });

  it('keeps to D minor pentatonic', () => {
    for (const note of MELODY) expect(PENTATONIC.has(note % 12)).toBe(true);
  });

  it('never lands a semitone above a note of the chord playing under it', () => {
    for (const { pad, bass } of CHORDS) {
      const tones = new Set([...pad, bass].map((n) => n % 12));
      for (const note of MELODY) expect(tones.has((note + 11) % 12), `${note} over ${pad}`).toBe(false);
    }
  });

  it('plays a busier day harder, and even a quiet one audibly', () => {
    expect(melodyLevel(0.01)).toBeGreaterThan(0.4);
    expect(melodyLevel(1)).toBe(1);
  });
});

describe('busiestBetween', () => {
  const counts = [0, 3, 0, 9, 1, 0, 0, 0];

  it('covers the days after the first date up to and including the second', () => {
    expect(busiestBetween(counts, 0, 2)).toBe(3);
    expect(busiestBetween(counts, 1, 2)).toBe(0);
    expect(busiestBetween(counts, 2, 4.6)).toBe(9);
  });

  it('is zero for a quiet stretch, an empty one, or one past the end of the history', () => {
    expect(busiestBetween(counts, 4, 7)).toBe(0);
    expect(busiestBetween(counts, 3, 3)).toBe(0);
    expect(busiestBetween(counts, 7, 40)).toBe(0);
  });
});

describe('chords', () => {
  it('moves through the progression two bars at a time, and round again', () => {
    expect(chordAt(0)).toBe(CHORDS[0]);
    expect(chordAt(15)).toBe(CHORDS[0]);
    expect(chordAt(16)).toBe(CHORDS[1]);
    expect(chordAt(16 * CHORDS.length)).toBe(CHORDS[0]);
  });

  it('tunes A above middle C to 440', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
});

/** Just enough of Web Audio to see what the music books, and when. */
class FakeContext {
  currentTime = 0;
  readonly notes: { hz: number; type: string; at: number }[] = [];

  private param(value = 0) {
    return {
      value,
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
      cancelScheduledValues: () => {},
      setTargetAtTime: () => {},
    };
  }

  private node<T extends object>(extra: T) {
    return { connect: <N>(next: N) => next, ...extra };
  }

  createGain() {
    return this.node({ gain: this.param(1) });
  }

  createBiquadFilter() {
    return this.node({ type: 'lowpass', frequency: this.param(), Q: this.param() });
  }

  createOscillator() {
    const record = { hz: 0, type: 'sine', at: -1 };
    const oscillator = this.node({
      type: 'sine',
      frequency: this.param(),
      detune: this.param(),
      start: (at: number) => {
        record.hz = oscillator.frequency.value;
        record.type = oscillator.type;
        record.at = at;
        this.notes.push(record);
      },
      stop: () => {},
    });
    return oscillator;
  }
}

describe('Music', () => {
  const melodyHz = new Set(MELODY.map(midiToHz));
  /** Melody notes are the triangles at a melody pitch. The pad is saws and the bass sine. */
  const melody = (context: FakeContext) => context.notes.filter((n) => n.type === 'triangle' && melodyHz.has(n.hz));

  /** Runs the music for some seconds of audio clock, a frame at a time, with the cue for each moment. */
  function play(counts: number[], seconds: number, cue: (t: number) => Cue) {
    const context = new FakeContext();
    const music = new Music(context as unknown as BaseAudioContext, {} as AudioNode, {} as AudioNode, counts, 10);
    music.start();
    for (let t = 0; t < seconds; t += 1 / 60) {
      context.currentTime = t;
      music.update(cue(t));
    }
    return { context, music };
  }

  const busy = Array.from({ length: 400 }, (_, i) => (i < 200 ? 1 + (i % 10) : 0));

  it('plays the history as it replays, with notes on the beat', () => {
    const { context } = play(busy, 4, (t) => ({ kind: 'history', day: t * 28 }));
    const notes = melody(context);
    expect(notes.length).toBeGreaterThan(8);
    for (const { at } of notes) expect(((at - 0.1) / STEP) % 1).toBeCloseTo(0, 6);
  });

  it('falls silent over a quiet stretch, and keeps the chords going', () => {
    const { context } = play(busy, 4, (t) => ({ kind: 'history', day: 210 + t * 28 }));
    expect(melody(context)).toEqual([]);
    expect(context.notes.some((n) => n.type === 'sawtooth')).toBe(true);
  });

  it('plays nothing while the date runs backwards, as when the timeline is dragged back', () => {
    const { context } = play(busy, 3, (t) => ({ kind: 'history', day: 150 - t * 28 }));
    expect(melody(context)).toEqual([]);
  });

  it('plays the towers a piloted ship flies over, and nothing while it holds still', () => {
    const flying = play(busy, 3, (t) => ({ kind: 'flight', day: Math.floor(t * 7) }));
    expect(melody(flying.context).length).toBeGreaterThan(4);
    const parked = play(busy, 3, () => ({ kind: 'flight', day: 50 }));
    expect(melody(parked.context).length).toBeLessThanOrEqual(1);
  });

  it('plays a tower pointed at in Orbit', () => {
    const { context, music } = play(busy, 1, () => ({ kind: 'still' }));
    const before = melody(context).length;
    music.touch(9);
    for (let t = 1; t < 1.5; t += 1 / 60) {
      context.currentTime = t;
      music.update({ kind: 'still' });
    }
    expect(melody(context).length).toBe(before + 1);
  });

  it('books nothing more once stopped', () => {
    const { context, music } = play(busy, 2, (t) => ({ kind: 'history', day: t * 28 }));
    music.stop();
    const booked = context.notes.length;
    for (let t = 2; t < 4; t += 1 / 60) {
      context.currentTime = t;
      music.update({ kind: 'history', day: t * 28 });
    }
    expect(context.notes.length).toBe(booked);
  });

  it('picks up from now after a hidden tab, instead of booking everything it missed', () => {
    const { context, music } = play(busy, 1, () => ({ kind: 'still' }));
    const booked = context.notes.length;
    context.currentTime = 120;
    music.update({ kind: 'still' });
    // A pad chord and a bass note at most, not two minutes of them
    expect(context.notes.length - booked).toBeLessThan(12);
  });
});

describe('stereo', () => {
  it('places a sound to the right on the right, and the left on the left', () => {
    expect(stereo(5, 10)).toBeGreaterThan(0);
    expect(stereo(-5, 10)).toBeLessThan(0);
    expect(stereo(0, 10)).toBe(0);
  });

  it('never puts a sound wholly in one ear', () => {
    expect(stereo(100, 100)).toBeLessThan(1);
    expect(stereo(-100, 1)).toBeGreaterThan(-1);
  });
});

describe('engineTone', () => {
  it('whines higher and rushes louder with speed', () => {
    const cruise = engineTone(17 / 46);
    const boost = engineTone(1);
    expect(boost.whine).toBeGreaterThan(cruise.whine);
    expect(boost.air).toBeGreaterThan(cruise.air);
    expect(boost.airHz).toBeGreaterThan(cruise.airHz);
  });
});
