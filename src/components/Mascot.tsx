"use client";

// Lumi — the storytelling spirit mascot (original art, pure SVG + motion).

import { useEffect, useId, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

export type MascotMood = "idle" | "happy" | "cover" | "peek" | "think" | "sad" | "wave";

type Props = {
  mood?: MascotMood;
  /** Pupils follow the pointer. */
  track?: boolean;
  /** Fixed gaze in [-1, 1] (overrides tracking), e.g. look at a form field. */
  look?: { x: number; y: number } | null;
  className?: string;
  /** Accessible label; decorative when omitted. */
  label?: string;
};

const EYE_Y = 112;

export function Mascot({ mood = "idle", track = false, look = null, className, label }: Props) {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const reduce = useReducedMotion();
  const [blink, setBlink] = useState(false);
  const gx = useMotionValue(0);
  const gy = useMotionValue(0);
  const px = useSpring(gx, { stiffness: 220, damping: 20 });
  const py = useSpring(gy, { stiffness: 220, damping: 20 });

  // Gaze: explicit look target wins, otherwise follow the pointer.
  useEffect(() => {
    if (look) {
      gx.set(look.x * 5);
      gy.set(look.y * 4);
      return;
    }
    if (!track) {
      gx.set(0);
      gy.set(0);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
      const dy = (e.clientY - (r.top + r.height * 0.55)) / (window.innerHeight / 2);
      gx.set(Math.max(-1, Math.min(1, dx)) * 5);
      gy.set(Math.max(-1, Math.min(1, dy)) * 4);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [track, look, gx, gy]);

  // Natural, slightly irregular blinking.
  useEffect(() => {
    if (reduce) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => setBlink(false), 140);
          loop();
        },
        2200 + Math.random() * 2800,
      );
    };
    loop();
    return () => clearTimeout(t);
  }, [reduce]);

  const happy = mood === "happy";
  const covering = mood === "cover" || mood === "peek";
  const eyesClosedArc = happy;
  const thinking = mood === "think";
  const sad = mood === "sad";

  const bodyAnim = reduce
    ? {}
    : happy
      ? { y: [0, -26, 0, -12, 0], scaleY: [1, 1.04, 0.94, 1.02, 1], scaleX: [1, 0.97, 1.06, 0.99, 1] }
      : sad
        ? { y: [4, 6, 4], rotate: [-2, 2, -2] }
        : { y: [0, -7, 0] };
  const bodyTrans = happy
    ? { duration: 1.1, repeat: Infinity, repeatDelay: 0.5, ease: "easeInOut" as const }
    : { duration: sad ? 2.8 : 3.2, repeat: Infinity, ease: "easeInOut" as const };

  // Arms: [x, y, rotate]
  const leftArm = covering
    ? { x: 34, y: -20, rotate: -35 }
    : sad
      ? { x: 2, y: 8, rotate: 20 }
      : { x: 0, y: 0, rotate: 0 };
  const rightArm = covering
    ? { x: mood === "peek" ? -14 : -34, y: mood === "peek" ? -6 : -20, rotate: 35 }
    : mood === "wave"
      ? { x: 6, y: -44, rotate: [-20, 25, -20] }
      : thinking
        ? { x: -26, y: -2, rotate: 30 }
        : sad
          ? { x: -2, y: 8, rotate: -20 }
          : { x: 0, y: 0, rotate: 0 };

  const b = `url(#${uid}body)`;

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 210"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      overflow="visible"
    >
      <defs>
        <radialGradient id={`${uid}body`} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#eef4ff" />
          <stop offset="0.35" stopColor="#a9c6ff" />
          <stop offset="0.75" stopColor="#8a7dff" />
          <stop offset="1" stopColor="#6c4ce0" />
        </radialGradient>
        <radialGradient id={`${uid}halo`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8ab4ff" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#a78bfa" stopOpacity="0.15" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}wisp`} x1="0" y1="1" x2="0.4" y2="0">
          <stop offset="0" stopColor="#a9c6ff" />
          <stop offset="1" stopColor="#f0abfc" />
        </linearGradient>
      </defs>

      {/* halo */}
      <motion.circle
        cx="100"
        cy="118"
        r="96"
        fill={`url(#${uid}halo)`}
        animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* ground shadow */}
      <motion.ellipse
        cx="100"
        cy="196"
        rx="42"
        ry="6"
        fill="#000"
        opacity={0.35}
        animate={reduce ? undefined : happy ? { scaleX: [1, 0.6, 1, 0.8, 1] } : { scaleX: [1, 0.85, 1] }}
        transition={bodyTrans}
      />

      <motion.g animate={bodyAnim} transition={bodyTrans} style={{ originX: "100px", originY: "180px" }}>
        {/* wisp flame */}
        <motion.path
          d="M92 62 C82 44 96 30 104 12 C110 30 128 40 114 62 Z"
          fill={`url(#${uid}wisp)`}
          style={{ originX: "103px", originY: "62px" }}
          animate={reduce ? undefined : { rotate: [-8, 8, -8], scaleY: [1, 1.08, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* body */}
        <circle cx="100" cy="118" r="62" fill={b} />
        <ellipse cx="80" cy="84" rx="20" ry="11" fill="#fff" opacity="0.35" transform="rotate(-25 80 84)" />

        {/* cheeks */}
        <motion.ellipse cx="66" cy="134" rx="10" ry="6" fill="#ff8fc7" animate={{ opacity: happy ? 0.85 : 0.45 }} />
        <motion.ellipse cx="134" cy="134" rx="10" ry="6" fill="#ff8fc7" animate={{ opacity: happy ? 0.85 : 0.45 }} />

        {/* eyes */}
        {eyesClosedArc ? (
          <g stroke="#1b1336" strokeWidth="5" strokeLinecap="round" fill="none">
            <path d={`M70 ${EYE_Y + 2} Q80 ${EYE_Y - 10} 90 ${EYE_Y + 2}`} />
            <path d={`M110 ${EYE_Y + 2} Q120 ${EYE_Y - 10} 130 ${EYE_Y + 2}`} />
          </g>
        ) : (
          <motion.g
            style={{ x: px, y: py, originX: "100px", originY: `${EYE_Y}px` }}
            animate={{ scaleY: blink && !covering ? 0.1 : sad ? 0.8 : 1 }}
            transition={{ duration: 0.08 }}
          >
            {[80, 120].map((cx) => (
              <g key={cx}>
                <ellipse cx={cx} cy={thinking ? EYE_Y - 3 : EYE_Y} rx="9.5" ry="12.5" fill="#1b1336" />
                <circle cx={cx + 3.5} cy={(thinking ? EYE_Y - 3 : EYE_Y) - 5} r="3.6" fill="#fff" />
                <circle cx={cx - 3} cy={(thinking ? EYE_Y - 3 : EYE_Y) + 5} r="1.6" fill="#fff" opacity="0.8" />
              </g>
            ))}
          </motion.g>
        )}

        {/* brows for sad / think */}
        {sad && (
          <g stroke="#1b1336" strokeWidth="3.5" strokeLinecap="round">
            <line x1="70" y1="94" x2="88" y2="98" />
            <line x1="130" y1="94" x2="112" y2="98" />
          </g>
        )}
        {thinking && (
          <g stroke="#1b1336" strokeWidth="3.5" strokeLinecap="round">
            <line x1="71" y1="94" x2="88" y2="92" />
            <line x1="112" y1="90" x2="129" y2="94" />
          </g>
        )}

        {/* mouth */}
        {happy ? (
          <path d="M88 132 Q100 150 112 132 Z" fill="#1b1336" stroke="#1b1336" strokeWidth="3" strokeLinejoin="round" />
        ) : sad ? (
          <path d="M90 142 Q100 132 110 142" stroke="#1b1336" strokeWidth="4" strokeLinecap="round" fill="none" />
        ) : thinking ? (
          <circle cx="104" cy="138" r="4.5" fill="#1b1336" />
        ) : covering ? (
          <path d="M90 138 Q95 134 100 138 Q105 142 110 138" stroke="#1b1336" strokeWidth="4" strokeLinecap="round" fill="none" />
        ) : (
          <path d="M91 134 Q100 143 109 134" stroke="#1b1336" strokeWidth="4" strokeLinecap="round" fill="none" />
        )}

        {/* arms */}
        <motion.ellipse
          cx="42"
          cy="132"
          rx="14"
          ry="10"
          fill={b}
          animate={leftArm}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
        />
        <motion.ellipse
          cx="158"
          cy="132"
          rx="14"
          ry="10"
          fill={b}
          animate={rightArm}
          transition={
            mood === "wave"
              ? { rotate: { duration: 0.5, repeat: Infinity, ease: "easeInOut" }, default: { type: "spring", stiffness: 260, damping: 18 } }
              : { type: "spring", stiffness: 260, damping: 18 }
          }
        />
      </motion.g>

      {/* sparkles when happy / thought dots when thinking */}
      {happy &&
        !reduce &&
        [
          [30, 60, 0],
          [170, 50, 0.3],
          [160, 150, 0.6],
          [36, 160, 0.9],
        ].map(([x, y, d]) => (
          <motion.path
            key={`${x}-${y}`}
            d={`M${x} ${y - 8} L${x + 2} ${y - 2} L${x + 8} ${y} L${x + 2} ${y + 2} L${x} ${y + 8} L${x - 2} ${y + 2} L${x - 8} ${y} L${x - 2} ${y - 2} Z`}
            fill="#fde68a"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.2, 0], opacity: [0, 1, 0], rotate: [0, 90] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: d }}
          />
        ))}
      {thinking &&
        !reduce &&
        [0, 1, 2].map((i) => (
          <motion.circle
            key={i}
            cx={150 + i * 12}
            cy={70 - i * 12}
            r={3 + i * 1.5}
            fill="#c4b5fd"
            animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
    </svg>
  );
}
