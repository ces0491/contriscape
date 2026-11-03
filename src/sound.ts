import { BETWEEN_SHELLS, SHELLS } from './fireworks';

/** Overall loudness, ahead of a compressor that stops a busy moment clipping. */
const MASTER = 0.5;
/** Hits closer together than this play as one, because two guns firing fast land a lot of them. */
const IMPACT_GAP = 0.06;
/** Exponential curves can't reach zero, so sounds fade to this instead. */
const QUIET = 0.0001;
/** A fade ends this far down, then drops to silence. Fading all the way turns a short sound into a click. */
const TAIL = 0.03;

/** Values at seconds from a sound's start. */
type Curve = [seconds: number, value: number][];

interface Engine {
  hum: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  level: GainNode;
  gain: number;
  pitch: number;
}

interface Rig {
  context: AudioContext;
  out: GainNode;
  noise: AudioBuffer;
  engine: Engine;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** How loud a sound plays this far from the camera, as a share of full volume. */
export const distanceGain = (distance: number): number => 12 / (12 + Math.max(0, distance));

/** The engine at a share of top speed, from 0 parked to 1 on full boost, or null when no ship is being flown. */
export function engineTone(level: number | null): { gain: number; pitch: number; cutoff: number } {
  const k = clamp(level ?? 0, 0, 1);
  return { gain: level === null ? 0 : 0.015 + 0.03 * k, pitch: 50 + 60 * k, cutoff: 280 + 1100 * k };
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

function tone(rig: Rig, type: OscillatorType, pitch: Curve, loudness: Curve, delay = 0): void {
  const { context, out } = rig;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  shape(oscillator.frequency, start, pitch);
  shape(gain.gain, start, loudness);
  oscillator.connect(gain).connect(out);
  oscillator.start(start);
  oscillator.stop(start + end(loudness));
}

function hiss(rig: Rig, type: BiquadFilterType, cutoff: Curve, loudness: Curve, delay = 0, q = 1): void {
  const { context, out, noise } = rig;
  const start = context.currentTime + delay;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = noise;
  source.loop = true;
  filter.type = type;
  filter.Q.value = q;
  shape(filter.frequency, start, cutoff);
  shape(gain.gain, start, loudness);
  source.connect(filter).connect(gain).connect(out);
  // From a random place in the noise, so a repeated sound never repeats exactly
  source.start(start, Math.random() * noise.duration);
  source.stop(start + end(loudness));
}

function startEngine(context: AudioContext, out: AudioNode, noise: AudioBuffer): Engine {
  const hum = context.createOscillator();
  const sub = context.createOscillator();
  const air = context.createBufferSource();
  const airLevel = context.createGain();
  const filter = context.createBiquadFilter();
  const level = context.createGain();
  const idle = engineTone(null);
  hum.type = 'sawtooth';
  sub.type = 'triangle';
  hum.frequency.value = idle.pitch;
  sub.frequency.value = idle.pitch / 2;
  air.buffer = noise;
  air.loop = true;
  airLevel.gain.value = 0.6;
  filter.type = 'lowpass';
  filter.Q.value = 3;
  filter.frequency.value = idle.cutoff;
  level.gain.value = 0;
  hum.connect(filter);
  sub.connect(filter);
  air.connect(airLevel).connect(filter);
  filter.connect(level).connect(out);
  [hum, sub, air].forEach((source) => source.start());
  return { hum, sub, filter, level, gain: 0, pitch: idle.pitch };
}

/**
 * The sound effects, made in the browser so there are no audio files to load. Browsers only let a page start audio
 * after a click, tap or key press, so nothing is built until the first one.
 */
export class Sound {
  private rig: Rig | null = null;
  private lastImpact = -Infinity;

  constructor(private on: boolean) {
    // Browsers differ on which events let a page start audio, so each of these tries
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'])
      window.addEventListener(type, () => this.unlock(), true);
    document.addEventListener('visibilitychange', () => {
      // The frame loop stops in a hidden tab, which would leave the engine running at its last setting
      if (document.hidden) void this.rig?.context.suspend();
      else this.unlock();
    });
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Switching on is always a click or key press, so audio can start straight away. */
  setEnabled(on: boolean): void {
    this.on = on;
    if (on) this.unlock();
    else void this.rig?.context.suspend();
  }

  /** Starts audio, or wakes it after a hidden tab. */
  unlock(): void {
    if (!this.on || document.hidden) return;
    const context = this.rig?.context ?? this.build();
    if (context && context.state !== 'running') context.resume().catch(() => {});
  }

  private build(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    const context = new AudioContext();
    // Close to a limiter. The defaults squeeze everything above a whisper and then turn the lot up.
    const squeeze = new DynamicsCompressorNode(context, { threshold: -4, knee: 4, ratio: 12, attack: 0.002 });
    const out = context.createGain();
    out.gain.value = MASTER;
    out.connect(squeeze).connect(context.destination);
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.rig = { context, out, noise, engine: startEngine(context, out, noise) };
    return context;
  }

  /** The rig, while sound is on and playing. Anything asked for at other times is dropped, not saved up. */
  private live(): Rig | null {
    return this.on && this.rig?.context.state === 'running' ? this.rig : null;
  }

  /** Both guns, as one shot. */
  laser(): void {
    const rig = this.live();
    if (!rig) return;
    const pitch = 1600 * (0.94 + Math.random() * 0.12);
    tone(rig, 'sawtooth', sweep(pitch, 150, 0.14), fade(0.07, 0.15));
    tone(rig, 'sine', sweep(pitch * 1.5, 500, 0.08), fade(0.05, 0.09));
  }

  /** A bolt striking a tower or the street, quieter the further away it lands. */
  impact(distance: number): void {
    const rig = this.live();
    if (!rig || rig.context.currentTime - this.lastImpact < IMPACT_GAP) return;
    this.lastImpact = rig.context.currentTime;
    const loud = distanceGain(distance);
    hiss(rig, 'bandpass', sweep(2600, 800, 0.08), fade(0.4 * loud, 0.09, 0.002), 0, 1.2);
    tone(rig, 'triangle', sweep(380, 120, 0.07), fade(0.16 * loud, 0.08, 0.002));
  }

  /** The ship striking a tower, heavier head on. */
  bump(headOn: boolean): void {
    const rig = this.live();
    if (!rig) return;
    const loud = headOn ? 1 : 0.5;
    tone(rig, 'sine', sweep(120, 36, 0.3), fade(0.55 * loud, 0.34, 0.006));
    hiss(rig, 'lowpass', sweep(1500, 180, 0.22), fade(0.3 * loud, 0.24));
  }

  /** A badge going up. */
  blast(): void {
    const rig = this.live();
    if (!rig) return;
    hiss(rig, 'lowpass', sweep(5000, 110, 1.1), fade(0.6, 1.25, 0.008), 0, 0.5);
    tone(rig, 'sine', sweep(150, 30, 0.7), fade(0.65, 0.8, 0.008));
  }

  /** Two rising notes for an earned badge. */
  chime(): void {
    const rig = this.live();
    if (!rig) return;
    [880, 1318.5].forEach((pitch, i) => tone(rig, 'triangle', [[0, pitch]], fade(0.22, 0.6, 0.01), i * 0.09));
  }

  /** A rising run of notes for a cleared city. */
  fanfare(): void {
    const rig = this.live();
    if (!rig) return;
    // C, E and G, then the C above, held
    [523.25, 659.25, 783.99, 1046.5].forEach((pitch, i, notes) => {
      const seconds = i === notes.length - 1 ? 1.1 : 0.22;
      tone(rig, 'triangle', [[0, pitch]], fade(0.24, seconds, 0.01), i * 0.11);
      tone(rig, 'square', [[0, pitch / 2]], fade(0.03, seconds, 0.01), i * 0.11);
    });
  }

  /** A bang and a crackle for each shell of the fireworks, in time with the show. */
  fireworks(): void {
    const rig = this.live();
    if (!rig) return;
    for (let shell = 0; shell < SHELLS; shell++) {
      const at = shell * BETWEEN_SHELLS;
      const loud = 0.6 + Math.random() * 0.4;
      hiss(rig, 'lowpass', sweep(3200, 260, 0.4), fade(0.35 * loud, 0.45, 0.003), at);
      tone(rig, 'sine', sweep(170, 45, 0.3), fade(0.25 * loud, 0.32, 0.003), at);
      for (let n = 0; n < 7; n++) {
        hiss(rig, 'highpass', [[0, 3500]], fade(0.07 * loud, 0.035, 0.001), at + 0.2 + Math.random() * 0.9);
      }
    }
  }

  /** The jump to hyperspace: a rush that builds to the flash halfway through, a crack, then dies away. */
  jump(seconds: number): void {
    const rig = this.live();
    if (!rig) return;
    hiss(rig, 'bandpass', arc(160, 2800, 200, seconds), arc(QUIET, 0.4, QUIET, seconds), 0, 0.9);
    tone(rig, 'sine', arc(70, 560, 50, seconds), arc(QUIET, 0.12, QUIET, seconds));
    hiss(rig, 'lowpass', sweep(2400, 140, 0.5), fade(0.4, 0.55), seconds / 2);
  }

  /** Sets the engine for this frame, at a share of top speed, or null when no ship is being flown. */
  engine(level: number | null): void {
    const rig = this.live();
    if (!rig) return;
    const { context, engine } = rig;
    const { gain, pitch, cutoff } = engineTone(level);
    // Most frames change nothing, and each change queues work on the audio thread
    if (Math.abs(gain - engine.gain) < 0.001 && Math.abs(pitch - engine.pitch) < 0.5) return;
    engine.gain = gain;
    engine.pitch = pitch;
    const now = context.currentTime;
    engine.level.gain.setTargetAtTime(gain, now, 0.08);
    engine.hum.frequency.setTargetAtTime(pitch, now, 0.15);
    engine.sub.frequency.setTargetAtTime(pitch / 2, now, 0.15);
    engine.filter.frequency.setTargetAtTime(cutoff, now, 0.15);
  }
}
