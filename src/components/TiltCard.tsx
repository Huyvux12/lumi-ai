"use client";

import { useRef } from "react";
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";

/** Wrapper that tilts in 3D toward the pointer and paints a glow under it. */
export function TiltCard({
  children,
  className = "",
  hue = 220,
  max = 10,
}: {
  children: React.ReactNode;
  className?: string;
  hue?: number;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 200, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 200, damping: 18 });
  const gx = useTransform(mx, (v) => `${v * 100}%`);
  const gy = useTransform(my, (v) => `${v * 100}%`);
  const glow = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, hsl(${hue} 95% 70% / 0.25), transparent 45%)`;
  const glare = useMotionTemplate`radial-gradient(260px circle at ${gx} ${gy}, rgb(255 255 255 / 0.09), transparent 60%)`;

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
  };
  const reset = () => {
    mx.set(0.5);
    my.set(0.5);
  };

  return (
    <div style={{ perspective: 900 }} className={className}>
      <motion.div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={reset}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        whileHover={{ scale: 1.025 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="group/tilt relative h-full rounded-2xl"
      >
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-3 z-0 rounded-3xl opacity-0 blur-xl transition-opacity duration-300 group-hover/tilt:opacity-100"
          style={{ background: glow }}
        />
        <div className="relative z-10 h-full">{children}</div>
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-2xl opacity-0 transition-opacity duration-300 group-hover/tilt:opacity-100"
          style={{ background: glare }}
        />
      </motion.div>
    </div>
  );
}
