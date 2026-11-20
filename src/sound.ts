import { CLIMB_SECONDS, type Shell } from './fireworks';
import { Music, STEP, type Cue } from './music';

/** Overall loudness, ahead of a compressor that stops a busy moment clipping. */
const MASTER = 0.5;
/** The music sits under the effects: measured, its peaks land a little below a laser shot's. */
const MUSIC_LEVEL = 0.32;
/** Seconds the music takes to swell in, or to go when it's switched off. */
const MUSIC_IN = 3;
const MUSIC_OUT = 0.4;
/** How long the reverb rings, and how much of it comes back. */
const REVERB_SECONDS = 2.4;
const REVERB_RETURN = 0.45;
/** The echo repeats on the dotted eighth, which sits in time with the music. */
const ECHO_SECONDS = STEP * 1.5;
const ECHO_FEEDBACK = 0.32;
const ECHO_RETURN = 0.32;
/** Hits closer together than this play as one, because two guns firing fast land a lot of them. */
const IMPACT_GAP = 0.06;
/** Towers passing closer together than this make one whoosh, or the alleys would hiss. */
const WHOOSH_GAP = 0.07;
/** Exponential curves can't reach zero, so sounds fade to this instead. */
const QUIET = 0.0001;
/** A fade ends this far down, then drops to silence. Fading all the way turns a short sound into a click. */
const TAIL = 0.03;
/**
 * The events browsers accept as the visitor's go-ahead for sound. A finger's pointerdown isn't one, so audio built then
 * starts out blocked.
 */
const GO_AHEAD = ['mousedown', 'pointerup', 'touchend', 'click', 'keydown'];

/** Values at seconds from a sound's start. */
type Curve = [seconds: number, value: number][];

/** Where a sound plays: when, how far left or right, and how much goes to the reverb. */
interface Place {
  delay?: number;
  /** From -1, hard left, to 1, hard right. */
  pan?: number;
  /** Share sent to the reverb. */
  wet?: number;
}

interface Engine {
  hum: OscillatorNode;
  sub: OscillatorNode;
  whine: OscillatorNode;
  filter: BiquadFilterNode;
  airFilter: BiquadFilterNode;
  whineLevel: GainNode;
  airLevel: GainNode;
  level: GainNode;
  gain: number;
  pitch: number;
}

interface Rig {
  context: AudioContext;
  /** The effects bus. */
  out: GainNode;
  /** Sends into the reverb and the echo. */
  reverb: GainNode;
  echo: GainNode;
  musicBus: GainNode;
  music: Music;
  noise: AudioBuffer;
  engine: Engine;
}

/** What the music plays from: the days' counts, and the count that plays the top note. */
export interface Tune {
  counts: ArrayLike<number>;
  peak: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** How loud a sound plays this far from the camera, as a share of full volume. */
export const distanceGain = (distance: number): number => 12 / (12 + Math.max(0, distance));

/** Left or right of the camera, from how far to its right a sound is and how far away. Never fully one side. */
export const stereo = (right: number, distance: number): number => clamp(right / Math.max(distance, 1), -1, 1) * 0.8;

/**
 * The engine at a share of top speed, from 0 parked to 1 on full boost, or null when no ship is flying. A low saw hum
 * and sub, a turbine whine above them, and rushing air that grows with speed.
 */
export function engineTone(level: number | null): {
  gain: number;
  pitch: number;
  cutoff: number;
  whine: number;
  air: number;
  airHz: number;
} {
  const k = clamp(level ?? 0, 0, 1);
  return {
    gain: level === null ? 0 : 0.015 + 0.03 * k,
    pitch: 50 + 60 * k,
    cutoff: 280 + 1100 * k,
    whine: 0.1 + 0.45 * k,
    air: 0.25 + 0.9 * k,
    airHz: 500 + 1900 * k,
  };
}

/** Moves a setting along a curve, on the exponential steps that pitch and loudness are heard in. */
function shape(param: AudioParam, start: number, curve: Curve): void {
  const [[at, first], ...rest] = curve;
  param.setValueAtTime(first, start + at);
  for (const [t, value] of rest) param.exponentialRampToValueAtTime(value, start + t);
}

const sweep = (from: number, to: number, seconds: number): Curve => [
  [0, from],
  [seconds, to],
];
/** Out to a peak halfway through and back. */
const arc = (from: number, peak: number, to: number, seconds: number): Curve => [
  [0, from],
  [seconds / 2, peak],
  [seconds, to],
];
const fade = (peak: number, seconds: number, attack = 0.004): Curve => [
  [0, QUIET],
  [attack, peak],
  [seconds, peak * TAIL],
  [seconds + 0.02, QUIET],
];

const end = (curve: Curve) => curve[curve.length - 1][0];

/** Connects a sound's last node to the effects bus, panned, with its share sent to the reverb. */
function route(rig: Rig, node: AudioNode, { pan = 0, wet = 0 }: Place): void {
  const { context } = rig;
  if (pan) {
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    node.connect(panner).connect(rig.out);
    if (wet) panner.connect(new GainNode(context, { gain: wet })).connect(rig.reverb);
  } else {
    node.connect(rig.out);
    if (wet) node.connect(new GainNode(context, { gain: wet })).connect(rig.reverb);
  }
}

function tone(rig: Rig, type: OscillatorType, pitch: Curve, loudness: Curve, place: Place = {}): void {
  const { context } = rig;
  const start = context.currentTime + (place.delay ?? 0);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  shape(oscillator.frequency, start, pitch);
  shape(gain.gain, start, loudness);
  oscillator.connect(gain);
  route(rig, gain, place);
  oscillator.start(start);
  oscillator.stop(start + end(loudness));
}

function hiss(rig: Rig, type: BiquadFilterType, cutoff: Curve, loudness: Curve, place: Place = {}, q = 1): void {
  const { context, noise } = rig;
  const start = context.currentTime + (place.delay ?? 0);
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = noise;
  source.loop = true;
  filter.type = type;
  filter.Q.value = q;
  shape(filter.frequency, start, cutoff);
  shape(gain.gain, start, loudness);
  source.connect(filter).connect(gain);
  route(rig, gain, place);
  // From a random place in the noise, so a repeated sound never repeats exactly
  source.start(start, Math.random() * noise.duration);
  source.stop(start + end(loudness));
}

/**
 * A room for the sound to ring in, made rather than recorded: decaying noise in each ear, losing its highs as it fades
 * the way a real space does.
 */
function impulse(context: BaseAudioContext): AudioBuffer {
  const length = Math.round(context.sampleRate * REVERB_SECONDS);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const k = i / length;
      // The smoothing grows as the tail goes on, which darkens it
      low += (Math.random() * 2 - 1 - low) * (0.9 - 0.75 * k);
      samples[i] = low * Math.pow(1 - k, 2.6);
    }
  }
  return buffer;
}

function startEngine(context: AudioContext, out: AudioNode, noise: AudioBuffer): Engine {
  const idle = engineTone(null);
  const hum = new OscillatorNode(context, { type: 'sawtooth', frequency: idle.pitch });
  const sub = new OscillatorNode(context, { type: 'triangle', frequency: idle.pitch / 2 });
  const whine = new OscillatorNode(context, { type: 'sine', frequency: idle.pitch * 14 });
  const air = new AudioBufferSourceNode(context, { buffer: noise, loop: true });
  const filter = new BiquadFilterNode(context, { type: 'lowpass', Q: 3, frequency: idle.cutoff });
  const airFilter = new BiquadFilterNode(context, { type: 'bandpass', Q: 0.8, frequency: idle.airHz });
  const whineLevel = new GainNode(context, { gain: 0 });
  const airLevel = new GainNode(context, { gain: 0 });
  const level = new GainNode(context, { gain: 0 });
  hum.connect(filter);
  sub.connect(filter);
  filter.connect(level);
  whine.connect(whineLevel).connect(level);
  air.connect(airFilter).connect(airLevel).connect(level);
  level.connect(out);
  [hum, sub, whine, air].forEach((source) => source.start());
  return { hum, sub, whine, filter, airFilter, whineLevel, airLevel, level, gain: 0, pitch: idle.pitch };
}

/**
 * The sound effects and music, made in the browser so there are no audio files to load. Browsers only let a page start
 * audio after a click, tap or key press, so nothing is built until the first one.
 */
export class Sound {
  private rig: Rig | null = null;
  private lastImpact = -Infinity;
  private lastWhoosh = -Infinity;
  private side = 1;
  private festive = false;

  constructor(
    private on: boolean,
    private musicOn: boolean,
    private readonly tune: Tune,
  ) {
    for (const type of GO_AHEAD) window.addEventListener(type, () => this.unlock(), true);
    document.addEventListener('visibilitychange', () => {
      // The frame loop stops in a hidden tab, which would leave the engine running at its last setting
      if (document.hidden) void this.rig?.context.suspend();
      else this.unlock();
    });
  }

  get enabled(): boolean {
    return this.on;
  }

  get musicEnabled(): boolean {
    return this.musicOn;
  }

  /** Bells in the music, for a year's flight. */
  setFestive(on: boolean): void {
    this.festive = on;
    if (this.rig) this.rig.music.festive = on;
  }

  /** Switching on is always a click or key press, so audio can start straight away. */
  setEnabled(on: boolean): void {
    this.on = on;
    if (on) this.unlock();
    else void this.rig?.context.suspend();
  }

  /** The music has its own switch. It only plays while sound is on too. */
  setMusic(on: boolean): void {
    this.musicOn = on;
    const rig = this.rig;
    if (!rig) return;
    const now = rig.context.currentTime;
    const level = rig.musicBus.gain;
    level.cancelScheduledValues(now);
    level.setValueAtTime(level.value, now);
    if (on) {
      rig.music.start();
      level.linearRampToValueAtTime(MUSIC_LEVEL, now + MUSIC_IN);
    } else {
      level.linearRampToValueAtTime(0, now + MUSIC_OUT);
      rig.music.stop();
    }
  }

  /** Starts audio, or wakes it after a hidden tab. */
  unlock(): void {
    if (!this.on || document.hidden) return;
    const context = this.rig?.context ?? this.build();
    if (!context || context.state === 'running') return;
    context.resume().catch(() => {});
    // The usual fix for iOS also starts a sound during the tap, so a moment of silence plays
    const blank = context.createBufferSource();
    blank.buffer = context.createBuffer(1, 1, context.sampleRate);
    blank.connect(context.destination);
    blank.start();
  }

  private build(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    const context = new AudioContext();
    // Close to a limiter. The defaults squeeze everything above a whisper and then turn the lot up.
    const squeeze = new DynamicsCompressorNode(context, { threshold: -4, knee: 4, ratio: 12, attack: 0.002 });
    const master = new GainNode(context, { gain: MASTER });
    master.connect(squeeze).connect(context.destination);
    const out = new GainNode(context, { gain: 1 });
    out.connect(master);

    const reverb = new GainNode(context, { gain: 1 });
    const room = new ConvolverNode(context, { buffer: impulse(context) });
    reverb
      .connect(room)
      .connect(new GainNode(context, { gain: REVERB_RETURN }))
      .connect(master);

    const echo = new GainNode(context, { gain: 1 });
    const delay = new DelayNode(context, { delayTime: ECHO_SECONDS, maxDelayTime: 1 });
    const darken = new BiquadFilterNode(context, { type: 'lowpass', frequency: 2600 });
    const feedback = new GainNode(context, { gain: ECHO_FEEDBACK });
    echo.connect(delay).connect(darken).connect(feedback).connect(delay);
    darken.connect(new GainNode(context, { gain: ECHO_RETURN })).connect(master);
    darken.connect(new GainNode(context, { gain: 0.3 })).connect(reverb);

    const musicBus = new GainNode(context, { gain: 0 });
    musicBus.connect(master);
    musicBus.connect(new GainNode(context, { gain: 0.6 })).connect(reverb);

    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const music = new Music(context, musicBus, echo, this.tune.counts, this.tune.peak);
    music.festive = this.festive;
    this.rig = { context, out, reverb, echo, musicBus, music, noise, engine: startEngine(context, out, noise) };
    if (this.musicOn) this.setMusic(true);
    return context;
  }

  /** The rig, while sound is on and playing. Anything asked for at other times is dropped, not saved up. */
  private live(): Rig | null {
    return this.on && this.rig?.context.state === 'running' ? this.rig : null;
  }

  /** What the music follows this frame. */
  cue(cue: Cue): void {
    const rig = this.live();
    if (rig && this.musicOn) rig.music.update(cue);
  }

  /** A tower pointed at in Orbit plays its note. */
  touch(day: number): void {
    if (this.live() && this.musicOn) this.rig?.music.touch(day);
  }

  /** Both guns, as one shot, from alternate sides so a burst spreads across the ears. */
  laser(): void {
    const rig = this.live();
    if (!rig) return;
    this.side = -this.side;
    const pan = this.side * 0.22;
    const pitch = 1600 * (0.94 + Math.random() * 0.12);
    tone(rig, 'sawtooth', sweep(pitch, 150, 0.14), fade(0.07, 0.15), { pan, wet: 0.08 });
    tone(rig, 'sine', sweep(pitch * 1.5, 500, 0.08), fade(0.05, 0.09), { pan });
    hiss(rig, 'highpass', [[0, 4000]], fade(0.05, 0.015, 0.001), { pan });
  }

  /** A bolt striking a tower or the street, quieter the further away it lands. Glass rings when it hits a tower. */
  impact(distance: number, pan = 0, glass = false): void {
    const rig = this.live();
    if (!rig || rig.context.currentTime - this.lastImpact < IMPACT_GAP) return;
    this.lastImpact = rig.context.currentTime;
    const loud = distanceGain(distance);
    hiss(rig, 'bandpass', sweep(2600, 800, 0.08), fade(0.4 * loud, 0.09, 0.002), { pan, wet: 0.15 }, 1.2);
    tone(rig, 'triangle', sweep(380, 120, 0.07), fade(0.16 * loud, 0.08, 0.002), { pan });
    if (glass) {
      const ping = 2600 + Math.random() * 1600;
      tone(rig, 'sine', [[0, ping]], fade(0.045 * loud, 0.22, 0.002), { pan, wet: 0.35 });
      tone(rig, 'sine', [[0, ping * 2.76]], fade(0.02 * loud, 0.12, 0.002), { pan, wet: 0.35 });
    }
  }

  /** The ship striking a tower, heavier head on. */
  bump(headOn: boolean): void {
    const rig = this.live();
    if (!rig) return;
    const loud = headOn ? 1 : 0.5;
    tone(rig, 'sine', sweep(120, 36, 0.3), fade(0.55 * loud, 0.34, 0.006), { wet: 0.15 });
    hiss(rig, 'lowpass', sweep(1500, 180, 0.22), fade(0.3 * loud, 0.24), { wet: 0.15 });
  }

  /** A tower rushing past close to the ship, on its side, louder the faster and closer it goes by. */
  whoosh(pan: number, loud: number): void {
    const rig = this.live();
    if (!rig || loud <= 0.02 || rig.context.currentTime - this.lastWhoosh < WHOOSH_GAP) return;
    this.lastWhoosh = rig.context.currentTime;
    // Loud enough to stand out from the engine for the moment it lasts
    const level = 0.32 * Math.min(1, loud);
    hiss(
      rig,
      'bandpass',
      arc(450, 1700, 650, 0.32),
      [
        [0, QUIET],
        [0.07, level],
        [0.32, level * TAIL],
        [0.34, QUIET],
      ],
      {
        pan,
        wet: 0.1,
      },
      1.3,
    );
  }

  /** The afterburner lighting as a boost starts. */
  ignite(): void {
    const rig = this.live();
    if (!rig) return;
    hiss(rig, 'lowpass', sweep(300, 2600, 0.35), fade(0.22, 0.55, 0.02), { wet: 0.12 });
    tone(rig, 'sine', sweep(75, 42, 0.4), fade(0.3, 0.45, 0.01));
  }

  /** Two quick high notes as the targeting computer locks on to a badge. */
  lock(): void {
    const rig = this.live();
    if (!rig) return;
    [0, 0.075].forEach((delay) => tone(rig, 'sine', [[0, 1760]], fade(0.07, 0.05, 0.003), { delay, wet: 0.2 }));
  }

  /** A beep for each second of a race's countdown, and a longer one an octave up for the start. */
  count(go: boolean): void {
    const rig = this.live();
    if (!rig) return;
    const pitch = go ? 1318.5 : 659.25;
    tone(rig, 'square', [[0, pitch]], fade(0.06, go ? 0.42 : 0.14, 0.004), { wet: 0.15 });
    tone(rig, 'sine', [[0, pitch]], fade(0.14, go ? 0.42 : 0.14, 0.004), { wet: 0.15 });
  }

  /** A quick rising note for flying through a race's gate. */
  gate(): void {
    const rig = this.live();
    if (!rig) return;
    tone(rig, 'triangle', sweep(1046.5, 1568, 0.06), fade(0.16, 0.22, 0.004), { wet: 0.3 });
  }

  /** A badge going up. */
  blast(pan = 0): void {
    const rig = this.live();
    if (!rig) return;
    hiss(rig, 'lowpass', sweep(5000, 110, 1.1), fade(0.6, 1.25, 0.008), { pan, wet: 0.45 }, 0.5);
    tone(rig, 'sine', sweep(150, 30, 0.7), fade(0.65, 0.8, 0.008), { wet: 0.2 });
  }

  /** Two rising notes for an earned badge. */
  chime(): void {
    const rig = this.live();
    if (!rig) return;
    [880, 1318.5].forEach((pitch, i) =>
      tone(rig, 'triangle', [[0, pitch]], fade(0.22, 0.6, 0.01), { delay: i * 0.09, wet: 0.4 }),
    );
  }

  /** Three falling notes for a time attack whose clock ran out. */
  timeUp(): void {
    const rig = this.live();
    if (!rig) return;
    // E, C and the G below, the last held
    [659.25, 523.25, 392].forEach((pitch, i, notes) =>
      tone(rig, 'triangle', [[0, pitch]], fade(0.22, i === notes.length - 1 ? 0.7 : 0.2, 0.01), {
        delay: i * 0.14,
        wet: 0.4,
      }),
    );
  }

  /** A rising run of notes for a cleared city. */
  fanfare(): void {
    const rig = this.live();
    if (!rig) return;
    // C, E and G, then the C above, held
    [523.25, 659.25, 783.99, 1046.5].forEach((pitch, i, notes) => {
      const seconds = i === notes.length - 1 ? 1.1 : 0.22;
      tone(rig, 'triangle', [[0, pitch]], fade(0.24, seconds, 0.01), { delay: i * 0.11, wet: 0.4 });
      tone(rig, 'square', [[0, pitch / 2]], fade(0.03, seconds, 0.01), { delay: i * 0.11, wet: 0.2 });
    });
  }

  /** For each shell of the fireworks: a rocket's whistle as it climbs, then a bang and a crackle, on its side. */
  fireworks(shells: Shell[]): void {
    const rig = this.live();
    if (!rig) return;
    for (const { at, pan } of shells) {
      const loud = 0.6 + Math.random() * 0.4;
      const launch = at - CLIMB_SECONDS;
      const place = { pan: pan * 0.7, wet: 0.45 };
      tone(rig, 'sine', sweep(700, 1900, CLIMB_SECONDS * 0.9), fade(0.03, CLIMB_SECONDS * 0.9, 0.04), {
        ...place,
        delay: launch,
      });
      hiss(rig, 'lowpass', sweep(3200, 260, 0.4), fade(0.35 * loud, 0.45, 0.003), { ...place, delay: at });
      tone(rig, 'sine', sweep(170, 45, 0.3), fade(0.25 * loud, 0.32, 0.003), { ...place, delay: at });
      for (let n = 0; n < 7; n++) {
        hiss(rig, 'highpass', [[0, 3500]], fade(0.07 * loud, 0.035, 0.001), {
          ...place,
          delay: at + 0.2 + Math.random() * 0.9,
        });
      }
    }
  }

  /** The jump to hyperspace: a rush that builds to the flash halfway through, a crack, then dies away. */
  jump(seconds: number): void {
    const rig = this.live();
    if (!rig) return;
    hiss(rig, 'bandpass', arc(160, 2800, 200, seconds), arc(QUIET, 0.4, QUIET, seconds), { wet: 0.3 }, 0.9);
    tone(rig, 'sine', arc(70, 560, 50, seconds), arc(QUIET, 0.12, QUIET, seconds));
    hiss(rig, 'lowpass', sweep(2400, 140, 0.5), fade(0.4, 0.55), { delay: seconds / 2, wet: 0.4 });
  }

  /**
   * Sets the engine for this frame, at a share of top speed, or null when no ship is flying. `share` turns it down,
   * for Autopilot, where the ship is watched rather than flown.
   */
  engine(level: number | null, share = 1): void {
    const rig = this.live();
    if (!rig) return;
    const { context, engine } = rig;
    const tone = engineTone(level);
    const gain = tone.gain * share;
    // Most frames change nothing, and each change queues work on the audio thread
    if (Math.abs(gain - engine.gain) < 0.001 && Math.abs(tone.pitch - engine.pitch) < 0.5) return;
    engine.gain = gain;
    engine.pitch = tone.pitch;
    const now = context.currentTime;
    engine.level.gain.setTargetAtTime(gain, now, 0.08);
    engine.hum.frequency.setTargetAtTime(tone.pitch, now, 0.15);
    engine.sub.frequency.setTargetAtTime(tone.pitch / 2, now, 0.15);
    engine.whine.frequency.setTargetAtTime(tone.pitch * 14, now, 0.2);
    engine.filter.frequency.setTargetAtTime(tone.cutoff, now, 0.15);
    engine.whineLevel.gain.setTargetAtTime(tone.whine, now, 0.2);
    engine.airLevel.gain.setTargetAtTime(tone.air, now, 0.2);
    engine.airFilter.frequency.setTargetAtTime(tone.airHz, now, 0.2);
  }
}
