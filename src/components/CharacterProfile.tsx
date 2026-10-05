"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { ChevronLeft, MessageCircle, Pencil, Sparkles } from "lucide-react";
import { formatCount, similarCharacters, type Character } from "@/lib/data";
import { CharacterCard } from "./CharacterCard";
import { Portrait } from "./Portrait";
import { RichText } from "./RichText";
import { TiltCard } from "./TiltCard";

const EASE = [0.22, 1, 0.36, 1] as const;

export function CharacterProfile({ character: c, editable = false }: { character: Character; editable?: boolean }) {
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, 120]);
  const bgO = useTransform(scrollY, [0, 400], [1, 0.3]);
  const similar = similarCharacters(c);
  const [fresh, setFresh] = useState(false);

  // Just-born characters get a one-off glow burst.
  useEffect(() => {
    try {
      const k = `rb:born:${c.id}`;
      if (c.id.startsWith("u-") && !sessionStorage.getItem(k)) {
        sessionStorage.setItem(k, "1");
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot celebratory flag from session storage
        setFresh(true);
      }
    } catch {}
  }, [c.id]);

  return (
    <div className="relative isolate overflow-hidden pb-16">
      {/* blurred portrait backdrop */}
      <motion.div aria-hidden="true" style={{ y: bgY, opacity: bgO }} className="absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_45%,transparent)]">
        <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-full scale-125 object-cover opacity-40 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-canvas/60 to-canvas" />
        <div
          className="absolute left-1/2 top-24 size-[36rem] -translate-x-1/2 animate-breathe rounded-full blur-[100px]"
          style={{ background: `radial-gradient(circle, hsl(${c.hue} 90% 60% / 0.35), transparent 65%)` }}
        />
      </motion.div>

      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-6 sm:px-6">
        <Link href="/" className="group flex w-fit items-center gap-1 text-sm text-fg-2 transition-colors hover:text-fg">
          <ChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" /> Khám phá
        </Link>

        <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-center sm:text-left">
          <motion.div
            initial={{ opacity: 0, scale: 0.7, rotateY: -40 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            transition={{ type: "spring", stiffness: 140, damping: 16 }}
            style={{ perspective: 800 }}
            className="relative shrink-0"
          >
            {fresh && (
              <motion.div
                aria-hidden="true"
                className="absolute inset-0 rounded-[2rem] border-2"
                style={{ borderColor: `hsl(${c.hue} 90% 75%)` }}
                initial={{ scale: 1, opacity: 1 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ duration: 1.4, ease: "easeOut", repeat: 2 }}
              />
            )}
            <TiltCard hue={c.hue} max={14}>
              <div
                className="overflow-hidden rounded-[2rem] ring-1 ring-white/15"
                style={{ boxShadow: `0 30px 80px -20px hsl(${c.hue} 90% 50% / 0.7)` }}
              >
                <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-48 sm:size-56" />
              </div>
            </TiltCard>
          </motion.div>

          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } } }}
            className="flex min-w-0 flex-col gap-2"
          >
            {fresh && (
              <motion.p variants={item} className="flex w-fit items-center gap-1.5 self-center rounded-full bg-pink/15 px-3 py-1 text-xs font-semibold text-pink sm:self-start">
                <Sparkles className="size-3.5" aria-hidden="true" /> Vừa ra đời
              </motion.p>
            )}
            <motion.h1 variants={item} className="text-4xl font-bold tracking-tight sm:text-5xl">
              {c.name}
            </motion.h1>
            <motion.p variants={item} className="text-lg text-fg-2">
              {c.tagline}
            </motion.p>
            <motion.div variants={item} className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-fg-3 sm:justify-start">
              <span>bởi @{c.creator}</span>
              <span className="flex items-center gap-1">
                <MessageCircle className="size-4" aria-hidden="true" /> {formatCount(c.chats)} lượt trò chuyện
              </span>
            </motion.div>
            <motion.ul variants={item} className="mt-1 flex flex-wrap justify-center gap-1.5 sm:justify-start" aria-label="Thẻ">
              {c.tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`/search?tag=${encodeURIComponent(t)}`}
                    className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-fg-2 transition-colors hover:border-accent/50 hover:text-fg"
                  >
                    #{t}
                  </Link>
                </li>
              ))}
            </motion.ul>
            <motion.div variants={item} className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">
              <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                <Link
                  href={`/chat/${c.id}`}
                  className="btn-glow inline-flex items-center gap-2 rounded-full px-7 py-3.5 font-semibold"
                >
                  <MessageCircle className="size-5" aria-hidden="true" /> Bắt đầu trò chuyện
                </Link>
              </motion.div>
              {editable && (
                <Link
                  href={`/create?edit=${c.id}`}
                  className="glass inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-sm font-medium transition-colors hover:bg-white/10"
                >
                  <Pencil className="size-4" aria-hidden="true" /> Chỉnh sửa
                </Link>
              )}
            </motion.div>
          </motion.div>
        </div>

        <section aria-labelledby="about" className="grid gap-4 sm:grid-cols-5">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: EASE }}
            className="glass rounded-3xl p-6 sm:col-span-3"
          >
            <h2 id="about" className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-3">
              Giới thiệu
            </h2>
            <p className="leading-relaxed text-fg-2">{c.description}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.08, ease: EASE }}
            className="relative overflow-hidden rounded-3xl border border-white/10 p-6 sm:col-span-2"
            style={{ background: `linear-gradient(160deg, hsl(${c.hue} 40% 18%), #141419 80%)` }}
          >
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-3">Lời chào</h2>
            <p className="relative rounded-2xl rounded-tl-sm bg-black/25 p-4 text-[15px] leading-relaxed">
              <RichText text={c.greeting} />
            </p>
          </motion.div>
        </section>

        {similar.length > 0 && (
          <section aria-labelledby="similar">
            <h2 id="similar" className="mb-4 text-xl font-semibold">
              Nhân vật tương tự
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {similar.map((o, i) => (
                <motion.li
                  key={o.id}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: i * 0.06, ease: EASE }}
                >
                  <CharacterCard character={o} />
                </motion.li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

const item = {
  hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: EASE } },
};
