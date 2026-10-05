// Tiny generative sound engine for the landing: ambient pad + chimes + whoosh.
// Everything is synthesised with WebAudio — no audio files. Off by default.

type Engine = { ctx: AudioContext; master: GainNode; pad: GainNode; stopPad: () => void };

let engine: Engine | null = null;
let enabled = false;
const listeners = new Set<(on: boolean) => void>();

function build(): Engine {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.7;
  // Soft space via feedback delay.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.38;
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(ctx.destination);
  master.connect(ctx.destination);
  master.connect(delay);

  const pad = ctx.createGain();
  pad.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  lp.Q.value = 0.6;
  pad.connect(lp).connect(master);

  // Dreamy Dmaj9 cluster with slow detune shimmer.
  const oscs: OscillatorNode[] = [];
  [146.83, 220, 277.18, 329.63, 440].forEach((f, i) => {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.09 : 0.035;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + i * 0.03;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain).connect(g.gain);
      o.connect(g).connect(pad);
      o.start();
      lfo.start();
      oscs.push(o, lfo);
    }
  });
  return { ctx, master, pad, stopPad: () => oscs.forEach((o) => o.stop()) };
}

export function isSoundOn() {
  return enabled;
}

export function onSoundChange(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function setSound(on: boolean) {
  enabled = on;
  listeners.forEach((l) => l(on));
  try {
    if (on) {
      engine ??= build();
      await engine.ctx.resume();
      const t = engine.ctx.currentTime;
      engine.pad.gain.cancelScheduledValues(t);
      engine.pad.gain.setTargetAtTime(0.55, t, 1.2);
    } else if (engine) {
      const t = engine.ctx.currentTime;
      engine.pad.gain.cancelScheduledValues(t);
      engine.pad.gain.setTargetAtTime(0, t, 0.25);
    }
  } catch {
    // Audio unavailable — stay silent.
  }
}

/** Bell-like chime. `pitch` in semitones above A5. */
export function chime(pitch = 0, gain = 0.18) {
  if (!enabled || !engine) return;
  const { ctx, master } = engine;
  const t = ctx.currentTime;
  const base = 880 * Math.pow(2, pitch / 12);
  [1, 2.01, 3.02, 4.2].forEach((mult, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = base * mult;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain / (i + 1.5), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 / (i + 1));
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 2.4);
  });
}

/** Arpeggio sparkle: a quick run of chimes. */
export function sparkle(notes = [0, 4, 7, 12, 16]) {
  notes.forEach((n, i) => setTimeout(() => chime(n, 0.1), i * 70));
}

/** Filtered-noise swoosh, for bursts and camera flights. */
export function whoosh(duration = 1.1, gain = 0.28) {
  if (!enabled || !engine) return;
  const { ctx, master } = engine;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(3200, t + duration * 0.6);
  bp.frequency.exponentialRampToValueAtTime(800, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + duration * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}

/** Soft low "bloom" thump for the mascot birth. */
export function bloom() {
  if (!enabled || !engine) return;
  const { ctx, master } = engine;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 1.5);
}
