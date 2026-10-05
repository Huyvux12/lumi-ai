"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { Mascot, type MascotMood } from "@/components/Mascot";
import { Aurora } from "@/components/fx/Aurora";
import { Logo } from "@/components/AppShell";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Split auth layout: Lumi reacts on the left, a glass form sits on the right. */
export function AuthFrame({
  mood,
  look,
  says,
  shake,
  children,
}: {
  mood: MascotMood;
  look?: { x: number; y: number } | null;
  says: string;
  /** Increment to shake the form (errors). */
  shake: number;
  children: React.ReactNode;
}) {
  return (
    <div className="grain relative flex min-h-dvh overflow-hidden bg-void">
      <Aurora />
      {/* star dust */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, #fff8, transparent), radial-gradient(1px 1px at 70% 20%, #fff6, transparent), radial-gradient(1.5px 1.5px at 40% 80%, #c7dbff88, transparent), radial-gradient(1px 1px at 85% 65%, #fff7, transparent), radial-gradient(1px 1px at 10% 75%, #f0abfc88, transparent), radial-gradient(1.5px 1.5px at 55% 45%, #fff5, transparent)",
          backgroundSize: "420px 420px",
        }}
      />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-6 px-4 py-6 lg:grid-cols-2 lg:gap-12 lg:px-10">
        <div className="flex items-center justify-between lg:col-span-2">
          <Logo />
          <Link
            href="/welcome"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-fg-2 transition-colors hover:bg-white/5 hover:text-fg"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Trang giới thiệu
          </Link>
        </div>

        {/* Lumi */}
        <div className="relative flex flex-col items-center justify-center lg:min-h-[560px]">
          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={says}
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
                className="glass relative mx-auto mb-2 max-w-[18rem] rounded-2xl px-4 py-2.5 text-center text-sm font-medium lg:mb-4 lg:text-base"
              >
                {says}
                <span className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r border-white/10 bg-[#1d1f2b]" />
              </motion.div>
            </AnimatePresence>
            <Mascot
              mood={mood}
              look={look}
              track={!look}
              label="PersonaX, linh hồn kể chuyện"
              className="mx-auto h-40 w-40 drop-shadow-[0_0_40px_rgb(138_180_255/0.45)] sm:h-52 sm:w-52 lg:h-80 lg:w-80"
            />
          </div>
        </div>

        {/* form */}
        <motion.div
          initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
          className="w-full"
        >
          <motion.div
            key={shake}
            animate={shake ? { x: [0, -12, 10, -8, 6, -3, 0] } : undefined}
            transition={{ duration: 0.4 }}
            className="glass ring-conic mx-auto w-full max-w-md rounded-3xl p-6 sm:p-8"
          >
            {children}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

