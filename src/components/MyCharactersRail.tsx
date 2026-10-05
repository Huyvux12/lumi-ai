"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Plus } from "lucide-react";
import { useUser } from "@/lib/auth";
import { burst } from "@/lib/confetti";
import { takeNew, useUserChars } from "@/lib/userCharacters";
import { CharacterCard } from "./CharacterCard";

/** "Nhân vật của bạn" — only renders once the signed-in user has creations. */
export function MyCharactersRail() {
  const user = useUser();
  const mine = useUserChars(user?.id ?? null);
  const [born, setBorn] = useState<string | null>(null);

  useEffect(() => {
    const id = takeNew();
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot flag from sessionStorage
    setBorn(id);
    const t = setTimeout(() => burst(0.3, 0.35), 500);
    return () => clearTimeout(t);
  }, []);

  if (!user || mine.length === 0) return null;

  return (
    <section aria-labelledby="rail-mine">
      <h2
        id="rail-mine"
        className="mb-3 flex items-center justify-between text-[17px] font-semibold"
      >
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 hover:text-accent"
        >
          Nhân vật của bạn{" "}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </h2>
      <ul className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <AnimatePresence>
          {mine.map((c) => {
            const isNew = c.id === born;
            return (
              <motion.li
                key={c.id}
                layout
                initial={
                  isNew
                    ? {
                        opacity: 0,
                        scale: 0.3,
                        y: -60,
                        rotate: -8,
                        filter: "blur(12px) brightness(3)",
                      }
                    : { opacity: 0, y: 12 }
                }
                animate={{
                  opacity: 1,
                  scale: 1,
                  y: 0,
                  rotate: 0,
                  filter: "blur(0px) brightness(1)",
                }}
                transition={
                  isNew
                    ? {
                        type: "spring",
                        stiffness: 120,
                        damping: 12,
                        delay: 0.35,
                      }
                    : { duration: 0.4 }
                }
                className="relative w-[85vw] max-w-sm shrink-0 snap-start sm:w-80"
              >
                {isNew && (
                  <motion.div
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-3 rounded-3xl"
                    style={{
                      background: `radial-gradient(closest-side, hsl(${c.hue} 95% 70% / 0.6), transparent)`,
                    }}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: [0, 1, 0.35], scale: [0.6, 1.3, 1] }}
                    transition={{ duration: 1.6, delay: 0.3 }}
                  />
                )}
                <CharacterCard
                  character={c}
                  badge={isNew ? "✨ Vừa ra đời" : "Của bạn"}
                />
              </motion.li>
            );
          })}
        </AnimatePresence>
        <li className="w-40 shrink-0">
          <Link
            href="/create"
            className="group flex h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/10 text-sm text-fg-2 transition-colors hover:border-accent/50 hover:text-fg"
          >
            <span className="grid size-10 place-items-center rounded-full bg-white/5 transition-transform duration-300 group-hover:rotate-90 group-hover:bg-accent/20">
              <Plus className="size-5" aria-hidden="true" />
            </span>
            Tạo thêm
          </Link>
        </li>
      </ul>
    </section>
  );
}
