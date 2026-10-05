"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { MessageCircle, Sparkles } from "lucide-react";
import { formatCount, type Character } from "@/lib/data";
import { Portrait } from "./Portrait";
import { TiltCard } from "./TiltCard";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Poster grid of the headline characters: the first thing a signed-in user picks from. */
export function StarPicker({ characters }: { characters: Character[] }) {
  return (
    <section aria-labelledby="star-picker" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Chọn nhân vật để bắt đầu
          </p>
          <h2 id="star-picker" className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Huyền thoại <span className="text-gradient">anime &amp; game</span>
          </h2>
        </div>
        <Link href="/section/huyen-thoai" className="shrink-0 text-sm text-fg-2 transition-colors hover:text-fg">
          Xem tất cả
        </Link>
      </div>

      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-5 md:gap-4 md:overflow-visible md:px-0">
        {characters.map((c, i) => (
          <motion.li
            key={c.id}
            initial={{ opacity: 0, y: 28, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 + i * 0.045, ease: EASE }}
            className="w-40 shrink-0 snap-start sm:w-48 md:w-auto"
          >
            <TiltCard hue={c.hue} max={8} className="aspect-[3/4]">
              <Link
                href={`/chat/${c.id}`}
                aria-label={`Trò chuyện với ${c.name}`}
                className="group relative block size-full overflow-hidden rounded-2xl border border-white/10 bg-surface"
                style={{ boxShadow: `0 24px 50px -24px hsl(${c.hue} 90% 55% / 0.7)` }}
              >
                <Portrait
                  seed={c.seed ?? c.id}
                  hue={c.hue}
                  className="absolute inset-0 size-full transition-transform duration-700 ease-[var(--ease-expo)] group-hover:scale-[1.08]"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(to top, rgb(5 5 10 / 0.96) 0%, rgb(5 5 10 / 0.8) 26%, hsl(${c.hue} 60% 12% / 0.45) 44%, transparent 64%)`,
                  }}
                />
                <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur">
                  <MessageCircle className="size-3" aria-hidden="true" />
                  {formatCount(c.chats)}
                </span>
                <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: `hsl(${c.hue} 95% 78%)` }}>
                    {c.tags[0]}
                  </p>
                  <h3 className="truncate text-base font-bold leading-tight sm:text-lg">{c.name}</h3>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-white/70">{c.tagline}</p>
                  <span
                    className="mt-2.5 flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold text-black opacity-0 transition-all duration-300 ease-[var(--ease-expo)] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 max-md:opacity-100 md:translate-y-2"
                    style={{ background: `linear-gradient(135deg, hsl(${c.hue} 95% 78%), hsl(${(c.hue + 40) % 360} 95% 80%))` }}
                  >
                    Trò chuyện ngay
                  </span>
                </div>
              </Link>
            </TiltCard>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
