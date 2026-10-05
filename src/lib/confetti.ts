// Celebration effects (client-only; canvas-confetti is loaded lazily).

const COLORS = ["#8ab4ff", "#a78bfa", "#f0abfc", "#fde68a", "#ffffff"];

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One sparkly burst from a point (0..1 viewport coords). */
export async function burst(x = 0.5, y = 0.5) {
  if (reduced()) return;
  const confetti = (await import("canvas-confetti")).default;
  confetti({
    particleCount: 90,
    spread: 80,
    startVelocity: 38,
    origin: { x, y },
    colors: COLORS,
    scalar: 0.9,
    ticks: 180,
  });
  confetti({
    particleCount: 30,
    spread: 120,
    startVelocity: 22,
    origin: { x, y },
    colors: COLORS,
    shapes: ["star"],
    scalar: 1.3,
    ticks: 220,
  });
}

/** A short fireworks show — used when an account or a character is born. */
export async function fireworks(duration = 2600) {
  if (reduced()) return;
  const confetti = (await import("canvas-confetti")).default;
  const end = Date.now() + duration;
  const shoot = () => {
    const left = Date.now() < end;
    confetti({
      particleCount: 60,
      startVelocity: 32,
      spread: 360,
      ticks: 90,
      gravity: 0.9,
      origin: { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.35 },
      colors: COLORS,
      scalar: 0.95,
    });
    if (left) setTimeout(shoot, 280 + Math.random() * 200);
  };
  shoot();
  confetti({ particleCount: 120, angle: 60, spread: 70, origin: { x: 0, y: 0.8 }, colors: COLORS });
  confetti({ particleCount: 120, angle: 120, spread: 70, origin: { x: 1, y: 0.8 }, colors: COLORS });
}
