"use client";

// No-WebGL version of the universe: the same choreography in CSS 3D + SVG.

import { motion } from "motion/react";
import type { Character } from "@/lib/data";
import { Mascot } from "../Mascot";
import { Portrait } from "../Portrait";
import { INTRO } from "./stage";

export function FallbackUniverse({ faces }: { faces: Character[] }) {
  const n = faces.length;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,#1a1440_0%,#07070b_60%)]">
      <motion.div
        className="lp-stars absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.9 }}
        transition={{ delay: INTRO.bloom, duration: 3 }}
      />
      <div className="absolute -left-1/4 top-0 size-[70vmax] animate-aurora rounded-full bg-accent/10 blur-[120px]" />
      <div className="absolute -right-1/4 bottom-0 size-[60vmax] animate-aurora rounded-full bg-pink/10 blur-[120px] [animation-delay:-9s]" />

      {/* spark → Lumi */}
      <motion.div
        className="absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0, scale: 3 }}
        transition={{ delay: INTRO.bloom, duration: 0.5 }}
      >
        <span className="lp-spark block" />
      </motion.div>
      <motion.div
        className="absolute left-1/2 top-[34%] w-[min(38vw,240px)] -translate-x-1/2 -translate-y-1/2"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: INTRO.bloom, type: "spring", stiffness: 140, damping: 11 }}
      >
        <Mascot mood="wave" track className="w-full drop-shadow-[0_0_60px_rgba(167,139,250,0.75)]" />
      </motion.div>

      {/* card ring */}
      <div className="absolute left-1/2 top-[34%] size-0 [perspective:1400px]">
        <div className="lp-ring">
          {faces.map((c, i) => {
            const a = (i / n) * 360;
            return (
              <motion.div
                key={`${c.id}-${i}`}
                className="absolute -left-12 -top-16 h-32 w-24"
                style={{ transform: `rotateY(${a}deg) translateZ(min(44vw, 520px))` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: INTRO.burst + i * 0.08, duration: 0.6 }}
              >
                <div
                  className="size-full overflow-hidden rounded-2xl border border-white/15"
                  style={{ boxShadow: `0 0 40px -6px hsl(${c.hue} 95% 60% / 0.8)` }}
                >
                  <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-full" />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
