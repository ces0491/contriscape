/**
 * A readout of what the browser does with sound, for phones that can't open developer tools. `/<login>#sound-check`
 * shows it. It watches audio from outside the game, so it must run before the first tap builds any.
 */
export function checkSound(): void {
  const box = document.createElement('div');
  box.id = 'soundCheck';
  const text = document.createElement('pre');
  const beep = document.createElement('button');
  beep.type = 'button';
  beep.textContent = 'Beep';
  box.append(text, beep);
  document.body.append(box);

  const events: string[] = [];
  const note = (line: string) => {
    events.push(`${(performance.now() / 1000).toFixed(1)}s ${line}`);
    if (events.length > 12) events.shift();
  };
  const contexts: AudioContext[] = [];
  let started = 0;

  const Real = typeof AudioContext === 'undefined' ? null : AudioContext;
  if (Real) {
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
        note(`audio made, ${this.state}`);
        this.addEventListener('statechange', () => note(`audio now ${this.state}`));
      }
    };
    const resume = Real.prototype.resume;
    Real.prototype.resume = function (this: AudioContext) {
      const whose = contexts.includes(this) ? 'game' : 'beep';
      return resume.call(this).then(
        () => note(`${whose} resume worked, ${this.state}`),
        (error: Error) => {
          note(`${whose} resume refused: ${error.name}`);
          throw error;
        },
      );
    };
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (this: AudioScheduledSourceNode, ...args) {
      started++;
      return start.apply(this, args);
    };
  }
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, () => note(type), true);
  }
  window.addEventListener('error', (e) => note(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => note(`rejected: ${String(e.reason)}`));

  // A tone made straight from a button press, outside the game, shows whether this browser can play sound at all
  beep.addEventListener('click', () => {
    if (!Real) return;
    const context = new Real();
    void context.resume();
    const tone = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.3;
    tone.connect(gain).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.4);
    note(`beep, its audio ${context.state}`);
  });

  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  const setting = () => {
    try {
      return localStorage.getItem('contriscape:sound') ?? 'default';
    } catch {
      return 'unreadable';
    }
  };
  const draw = () => {
    const game = contexts[0];
    text.textContent = [
      navigator.userAgent,
      `Web Audio: ${Real ? 'yes' : 'no'} · audio session: ${session?.type ?? 'none'}`,
      game
        ? `game audio: ${game.state} · ${game.sampleRate} Hz · clock ${game.currentTime.toFixed(1)}s · sounds started ${started}`
        : 'game audio: not made yet',
      `audio made: ${contexts.length} · sound setting: ${setting()}`,
      ...events,
    ].join('\n');
  };
  draw();
  setInterval(draw, 400);
}
