// Shared, mutable timeline state for the landing intro.
// The 3D scene reads it every frame; the DOM overlay writes to it (skip, mode, fly).

export type Stage = {
  /** performance.now() when the intro clock started, or null before the scene is ready. */
  start: number | null;
  /** Seconds to add to the clock (used by "skip"). */
  offset: number;
  mode: "hero" | "cta";
  pointer: { x: number; y: number };
  /** Card being flown to, if any. */
  flying: { index: number; at: number } | null;
  hovered: number | null;
  /** performance.now() of the last extra wave / happy jump (CTA, mascot click). */
  waveAt: number;
  jumpAt: number;
  /** False while the canvas is scrolled out of view. */
  visible: boolean;
  /** QA only (?lpdebug): pin the clock to this time. */
  frozen: number | null;
};

export const stage: Stage = {
  start: null,
  offset: 0,
  mode: "hero",
  pointer: { x: 0, y: 0 },
  flying: null,
  hovered: null,
  waveAt: -1e9,
  jumpAt: -1e9,
  visible: true,
  frozen: null,
};

export const INTRO = {
  spark: 0,
  bloom: 1.8,
  eyes: 3.0,
  wave: 3.3,
  burst: 4.0,
  settle: 7.0,
  title: 7.0,
  sub: 8.2,
  cta: 8.7,
  done: 10,
} as const;

export function stageTime(now = performance.now()) {
  if (stage.frozen !== null) return stage.frozen;
  return stage.start === null ? 0 : (now - stage.start) / 1000 + stage.offset;
}

export function resetStage() {
  stage.start = null;
  stage.offset = 0;
  stage.mode = "hero";
  stage.flying = null;
  stage.hovered = null;
  stage.waveAt = -1e9;
  stage.jumpAt = -1e9;
  stage.visible = true;
}

/** Jump the intro clock to the end (skip button / reduced motion). */
export function skipIntro() {
  if (stage.start === null) stage.start = performance.now();
  const t = stageTime();
  if (t < INTRO.done) stage.offset += INTRO.done - t;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const range = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOutBack = (x: number, s = 1.9) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
export const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
