// Character artwork when one exists; otherwise deterministic, fully original SVG portrait art.

import { imageFor } from "@/lib/data";

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Props = {
  seed: string;
  hue: number;
  className?: string;
  variant?: "portrait" | "scene";
};

export function Portrait({ seed, hue, className, variant = "portrait" }: Props) {
  const src = variant === "portrait" ? imageFor(seed) : undefined;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- also rendered inside tiny avatars and 3D texture sources
      <img src={src} alt="" aria-hidden="true" draggable={false} decoding="async" className={`object-cover ${className ?? ""}`} />
    );
  }

  const h = hash(seed);
  const id = `p${h.toString(36)}`;
  const hair = (hue + 20 + (h % 60)) % 360;
  const skin = 25 + (h % 15);
  const hairStyle = h % 3;
  const eyeY = 48 + ((h >>> 3) % 3);
  const stars = Array.from({ length: 7 }, (_, i) => {
    const r = hash(seed + i);
    return { x: r % 100, y: (r >>> 8) % 60, s: 0.6 + ((r >>> 16) % 10) / 10 };
  });

  if (variant === "scene") {
    return (
      <svg
        viewBox="0 0 100 140"
        preserveAspectRatio="xMidYMid slice"
        className={className}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`hsl(${hue} 55% 22%)`} />
            <stop offset="0.6" stopColor={`hsl(${(hue + 30) % 360} 45% 30%)`} />
            <stop offset="1" stopColor={`hsl(${hue} 40% 10%)`} />
          </linearGradient>
          <radialGradient id={`${id}g`} cx="0.5" cy="0.3" r="0.5">
            <stop offset="0" stopColor={`hsl(${(hue + 40) % 360} 90% 75%)`} stopOpacity="0.8" />
            <stop offset="1" stopColor={`hsl(${hue} 90% 60%)`} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="140" fill={`url(#${id}s)`} />
        <circle cx={30 + (h % 40)} cy="38" r="30" fill={`url(#${id}g)`} />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.s * 0.6} fill="white" opacity={0.5} />
        ))}
        <path
          d={`M0 ${95 + (h % 8)} L18 ${78 + (h % 10)} L34 ${90} L52 ${70 + ((h >>> 4) % 12)} L70 ${88} L86 ${76} L100 ${86} L100 140 L0 140Z`}
          fill={`hsl(${hue} 35% 14%)`}
        />
        <path
          d={`M0 112 L22 100 L45 110 L65 98 L100 108 L100 140 L0 140Z`}
          fill={`hsl(${hue} 30% 8%)`}
        />
        <g fill={`hsl(${hue} 30% 5%)`}>
          <circle cx="40" cy="104" r="4" />
          <path d="M34 124 Q40 104 46 124Z" />
          <circle cx="58" cy="102" r="3.6" />
          <path d="M53 124 Q58 104 63 124Z" />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 60% 40%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 50) % 360} 55% 18%)`} />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${hair} 55% 55%)`} />
          <stop offset="1" stopColor={`hsl(${hair} 50% 28%)`} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id}b)`} />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y / 2} r={s.s} fill="white" opacity={0.35} />
      ))}
      {/* shoulders */}
      <path d="M14 100 Q18 74 50 72 Q82 74 86 100Z" fill={`hsl(${(hue + 180) % 360} 30% 22%)`} />
      <path d="M42 72 L50 84 L58 72Z" fill={`hsl(${skin} 45% 70%)`} />
      {/* back hair */}
      {hairStyle !== 1 && (
        <path d="M27 46 Q26 20 50 18 Q74 20 73 46 L76 78 Q64 70 50 70 Q36 70 24 78Z" fill={`url(#${id}h)`} />
      )}
      {/* neck + face */}
      <rect x="44" y="58" width="12" height="16" rx="4" fill={`hsl(${skin} 42% 64%)`} />
      <ellipse cx="50" cy="46" rx="17" ry="20" fill={`hsl(${skin} 50% 76%)`} />
      {/* eyes */}
      <ellipse cx="43" cy={eyeY} rx="2.4" ry="3" fill={`hsl(${hue} 60% 25%)`} />
      <ellipse cx="57" cy={eyeY} rx="2.4" ry="3" fill={`hsl(${hue} 60% 25%)`} />
      <circle cx="43.8" cy={eyeY - 1} r="0.8" fill="white" />
      <circle cx="57.8" cy={eyeY - 1} r="0.8" fill="white" />
      <path d={`M46 ${eyeY + 9} Q50 ${eyeY + 11} 54 ${eyeY + 9}`} stroke={`hsl(${skin} 40% 45%)`} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* fringe */}
      {hairStyle === 0 && <path d="M32 44 Q34 24 50 24 Q66 24 68 44 Q60 32 50 34 Q40 30 32 44Z" fill={`url(#${id}h)`} />}
      {hairStyle === 1 && <path d="M31 46 Q30 22 50 22 Q70 22 69 46 L64 34 L58 38 L52 31 L45 37 L38 32Z" fill={`url(#${id}h)`} />}
      {hairStyle === 2 && <path d="M32 42 Q36 22 54 24 Q70 28 68 44 Q58 30 40 40Z" fill={`url(#${id}h)`} />}
    </svg>
  );
}
