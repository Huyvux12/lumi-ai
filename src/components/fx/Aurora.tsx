// Slow drifting colour fields behind glass UI. Pure CSS, no JS.
export function Aurora({ hue, className = "" }: { hue?: number; className?: string }) {
  const a = hue ?? 220;
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div
        className="absolute -left-1/4 -top-1/3 size-[70vmax] animate-aurora rounded-full opacity-40 blur-[110px]"
        style={{ background: `radial-gradient(circle, hsl(${a} 90% 65% / 0.55), transparent 65%)` }}
      />
      <div
        className="absolute -bottom-1/3 -right-1/4 size-[65vmax] animate-aurora rounded-full opacity-35 blur-[120px] [animation-delay:-6s]"
        style={{ background: `radial-gradient(circle, hsl(${(a + 60) % 360} 85% 65% / 0.5), transparent 65%)` }}
      />
      <div
        className="absolute left-1/3 top-1/4 size-[45vmax] animate-aurora rounded-full opacity-25 blur-[100px] [animation-delay:-12s]"
        style={{ background: `radial-gradient(circle, hsl(${(a + 120) % 360} 80% 70% / 0.45), transparent 65%)` }}
      />
    </div>
  );
}
