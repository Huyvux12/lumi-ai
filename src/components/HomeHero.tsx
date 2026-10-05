"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Sparkles, WandSparkles } from "lucide-react";
import { useUser } from "@/lib/auth";
import { useHydrated } from "@/lib/store";
import type { Character } from "@/lib/data";
import { Mascot } from "./Mascot";
import { Portrait } from "./Portrait";

const EASE = [0.22, 1, 0.36, 1] as const;

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? "Chào buổi sáng" : h < 14 ? "Chào buổi trưa" : h < 18 ? "Chào buổi chiều" : "Chào buổi tối";
}

export function HomeHero({ faces }: { faces: Character[] }) {
  const hydrated = useHydrated();
  const user = useUser();
  const name = hydrated && user ? user.name.split(" ").at(-1) : null;

  return (
    <section className="relative isolate overflow-hidden rounded-[2rem] border border-white/[0.08] px-6 py-8 sm:px-10 sm:py-10">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(120deg,#1a1440_0%,#0d0d16_45%,#26123a_100%)]" />
      <div aria-hidden="true" className="absolute -left-20 -top-32 -z-10 size-96 animate-aurora rounded-full bg-accent/30 blur-[90px]" />
      <div aria-hidden="true" className="absolute -bottom-40 right-10 -z-10 size-[28rem] animate-aurora rounded-full bg-pink/20 blur-[100px] [animation-delay:-8s]" />
      <div aria-hidden="true" className="grain absolute inset-0 -z-10" />

      {/* orbiting faces */}
      <div aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 hidden size-72 -translate-y-1/2 md:block lg:right-16">
        <div className="absolute inset-0 animate-spin-slow">
          {faces.slice(0, 6).map((c, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.07, type: "spring", stiffness: 220, damping: 16 }}
                className="absolute size-14"
                style={{
                  left: "50%",
                  top: "50%",
                  marginLeft: Math.round(Math.cos(a) * 125 - 28),
                  marginTop: Math.round(Math.sin(a) * 125 - 28),
                }}
              >
                <div className="size-full animate-[spin_14s_linear_infinite_reverse] overflow-hidden rounded-full ring-2 ring-white/15" style={{ boxShadow: `0 0 24px hsl(${c.hue} 90% 60% / 0.6)` }}>
                  <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-full" />
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="absolute inset-10 rounded-full border border-dashed border-white/10" />
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 12, delay: 0.15 }}
          className="absolute inset-0 grid place-items-center"
        >
          <Mascot mood="wave" className="size-36 drop-shadow-[0_0_40px_rgba(167,139,250,0.6)]" />
        </motion.div>
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        className="relative max-w-xl"
      >
        <motion.p variants={item} className="flex items-center gap-2 text-sm font-medium text-accent">
          <Sparkles className="size-4" aria-hidden="true" />
          {greeting()}
          {name ? `, ${name}` : ""}!
        </motion.p>
        <motion.h1 variants={item} className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Hôm nay bạn muốn <span className="text-gradient">trò chuyện với ai</span>?
        </motion.h1>
        <motion.p variants={item} className="mt-3 max-w-md text-fg-2">
          Gojo, Naruto, Rem và hàng chục linh hồn khác đang chờ — hoặc tự tay thổi hồn cho một nhân vật của riêng bạn.
        </motion.p>
        <motion.div variants={item} className="mt-6 flex flex-wrap gap-3">
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <Link href="/create" className="btn-glow flex items-center gap-2 rounded-full px-6 py-3 font-semibold">
              <WandSparkles className="size-4" aria-hidden="true" /> Tạo nhân vật
            </Link>
          </motion.div>
          <Link
            href="/search"
            className="glass flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-colors hover:bg-white/10"
          >
            Tìm kiếm nhân vật
          </Link>
        </motion.div>
      </motion.div>
    </section>
  );
}

const item = {
  hidden: { opacity: 0, y: 18, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE } },
};
