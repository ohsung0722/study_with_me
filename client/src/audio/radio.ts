// Lounge radio. All three sounds are synthesized with the Web Audio API (no audio files), quietly:
//   rain = filtered white noise with a slow swell; cafe = soft brown noise + occasional faint cup clinks;
//   lofi = a slow looping maj7/m7 progression on soft triangle pads through a low-pass.
// play() must be called from a user gesture (key press / click) so the browser lets audio start.
// The choice is remembered in localStorage 'studyverse.radio'.

export type RadioKind = 'lofi' | 'rain' | 'cafe' | 'off';
export const RADIO_STORAGE_KEY = 'studyverse.radio';
const KINDS: readonly RadioKind[] = ['lofi', 'rain', 'cafe', 'off'];
const FADE_IN_S = 1.5;
const FADE_OUT_MS = 400;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A running sound: its output gain, long-lived sources and timers, torn down together. */
class Voice {
  readonly out: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(readonly ctx: AudioContext, volume: number) {
    this.out = ctx.createGain();
    const t = ctx.currentTime;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(volume, t + FADE_IN_S);
    this.out.connect(ctx.destination);
  }

  /** Starts a long-lived source (stopped on teardown). */
  keep<T extends AudioScheduledSourceNode>(src: T): T {
    src.start();
    this.sources.push(src);
    return src;
  }

  /** setTimeout that is cancelled on teardown. */
  every(nextDelayMs: () => number, fn: () => void): void {
    const tick = () => {
      fn();
      this.timers.push(setTimeout(tick, nextDelayMs()));
    };
    this.timers.push(setTimeout(tick, nextDelayMs()));
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, FADE_OUT_MS / 4000);
    const sources = this.sources;
    this.sources = [];
    setTimeout(() => {
      for (const s of sources) {
        try { s.stop(); } catch { /* already stopped */ }
        s.disconnect();
      }
      this.out.disconnect();
    }, FADE_OUT_MS);
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buf;
}

function loopedNoise(v: Voice, seconds: number, brown: boolean): AudioBufferSourceNode {
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx, seconds, brown);
  src.loop = true;
  return src;
}

function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function rain(ctx: AudioContext): Voice {
  const v = new Voice(ctx, 0.05);
  const src = loopedNoise(v, 3, false);
  const hp = filter(ctx, 'highpass', 450);
  const lp = filter(ctx, 'lowpass', 2600);
  const swell = ctx.createGain();
  swell.gain.value = 0.85;
  // slow swell so it doesn't sound like a static hiss
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = ctx.createGain();
  depth.gain.value = 0.15;
  lfo.connect(depth);
  depth.connect(swell.gain);
  src.connect(hp);
  hp.connect(lp);
  lp.connect(swell);
  swell.connect(v.out);
  v.keep(src);
  v.keep(lfo);
  return v;
}

function cafe(ctx: AudioContext): Voice {
  const v = new Voice(ctx, 0.09);
  const src = loopedNoise(v, 4, true);
  const lp = filter(ctx, 'lowpass', 650);
  src.connect(lp);
  lp.connect(v.out);
  v.keep(src);
  // occasional faint cup / spoon clink: two short decaying sine partials
  v.every(() => 3000 + Math.random() * 6000, () => {
    const t = ctx.currentTime + 0.02;
    const base = 2400 + Math.random() * 1200;
    for (const [mul, peak] of [[1, 0.1], [2.76, 0.04]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(g);
      g.connect(v.out);
      osc.start(t);
      osc.stop(t + 0.4); // self-ending; not tracked
    }
  });
  return v;
}

// Fmaj7 → Em7 → Dm7 → Cmaj7 (bass + 4 chord tones, Hz)
const PROGRESSION = [
  [87.31, 174.61, 220.0, 261.63, 329.63],
  [82.41, 164.81, 196.0, 246.94, 293.66],
  [73.42, 146.83, 174.61, 220.0, 261.63],
  [65.41, 130.81, 164.81, 196.0, 246.94],
];
const CHORD_MS = 4800;

function lofi(ctx: AudioContext): Voice {
  const v = new Voice(ctx, 0.5);
  const lp = filter(ctx, 'lowpass', 900, 0.5);
  lp.connect(v.out);
  // gentle tape wobble shared by every voice
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 0.3;
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 4; // cents
  wobble.connect(wobbleDepth);
  v.keep(wobble);

  const voices = PROGRESSION[0].map((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = f;
    osc.detune.value = (Math.random() - 0.5) * 10;
    wobbleDepth.connect(osc.detune);
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(lp);
    v.keep(osc);
    return { osc, g, peak: i === 0 ? 0.05 : 0.025 };
  });

  let step = 0;
  const playChord = () => {
    const t = ctx.currentTime + 0.05;
    const chord = PROGRESSION[step % PROGRESSION.length];
    step++;
    voices.forEach(({ osc, g, peak }, i) => {
      osc.frequency.setTargetAtTime(chord[i], t, 0.06);
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(peak * 0.35, t, 0.05);          // soft dip at the change
      g.gain.setTargetAtTime(peak, t + 0.15, 0.3);           // slow swell
      g.gain.setTargetAtTime(peak * 0.55, t + 1.6, 1.4);     // gentle decay through the bar
    });
  };
  playChord();
  v.every(() => CHORD_MS, playChord);
  return v;
}

const SOUNDS: Record<Exclude<RadioKind, 'off'>, (ctx: AudioContext) => Voice> = { rain, cafe, lofi };

export class Radio {
  private kind: RadioKind = 'off';
  private ctx: AudioContext | null = null;
  private voice: Voice | null = null;

  constructor(
    private storage: KeyValueStore | null = defaultStorage(),
    private makeContext: () => AudioContext = () => new AudioContext(),
  ) {
    try {
      const saved = storage?.getItem(RADIO_STORAGE_KEY);
      if (saved && (KINDS as readonly string[]).includes(saved)) this.kind = saved as RadioKind;
    } catch { /* storage unavailable → off */ }
  }

  /** The current (or saved, not yet started) choice. */
  current(): RadioKind {
    return this.kind;
  }

  /** Switches sound; 'off' stops. Call from a user gesture. */
  play(kind: RadioKind): void {
    this.voice?.stop();
    this.voice = null;
    this.kind = kind;
    try { this.storage?.setItem(RADIO_STORAGE_KEY, kind); } catch { /* not persisted */ }
    if (kind === 'off') return;
    try {
      this.ctx ??= this.makeContext();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { /* retried on the next play() */ });
      this.voice = SOUNDS[kind](this.ctx);
    } catch {
      this.voice = null; // no Web Audio: stay silent
    }
  }
}
