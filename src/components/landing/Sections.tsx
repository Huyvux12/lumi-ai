"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView } from "motion/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { ArrowRight, Compass, MessageCircle, Send, Sparkles, WandSparkles } from "lucide-react";
import { enterAsGuest } from "@/lib/auth";
import { burst } from "@/lib/confetti";
import { characters, formatCount, getCharacter, scenes } from "@/lib/data";
import { sparkle } from "@/lib/sound";
import { Logo } from "../AppShell";
import { Mascot, type MascotMood } from "../Mascot";
import { Portrait } from "../Portrait";
import { RichText } from "../RichText";
import { TiltCard } from "../TiltCard";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: "spring", stiffness: 380, damping: 26, mass: 0.8 } as const;
const BG = "bg-[#05050a]";

function Kicker({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-accent">
      <span className="font-mono text-fg-3">{n}</span>
      <span className="h-px w-8 bg-gradient-to-r from-accent to-transparent" />
      {children}
    </p>
  );
}

function FadeUp({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── Marquee ───────────────────────── */

function Marquee() {
  const row = [...characters, ...characters];
  return (
    <div className="relative bg-[linear-gradient(to_bottom,transparent,#05050a_55%)] pb-10 pt-24">
      <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <div className="flex w-max animate-marquee gap-3">
          {row.map((c, i) => (
            <div key={i} className="glass flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-sm">
              <span className="size-7 overflow-hidden rounded-full" style={{ boxShadow: `0 0 14px hsl(${c.hue} 90% 60% / 0.7)` }}>
                <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-full" />
              </span>
              <span className="font-medium">{c.name}</span>
              <span className="text-fg-3">· {c.tags[0]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 01 Discover: cards fall from the universe ───────────────────────── */

function Discover() {
  const ref = useRef<HTMLElement>(null);
  const router = useRouter();
  const picks = [...characters].sort((a, b) => b.chats - a.chats).slice(0, 8);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const cards = gsap.utils.toArray<HTMLElement>(".lp-fall");
        gsap.fromTo(
          cards,
          {
            y: (i) => -window.innerHeight * (0.75 + (i % 3) * 0.18),
            x: (i) => ((i % 4) - 1.5) * -90,
            rotate: (i) => (i % 2 ? 1 : -1) * (18 + i * 5),
            rotateX: 65,
            scale: 0.3,
            opacity: 0,
            filter: "blur(12px) brightness(2.2)",
          },
          {
            y: 0,
            x: 0,
            rotate: 0,
            rotateX: 0,
            scale: 1,
            opacity: 1,
            filter: "blur(0px) brightness(1)",
            ease: "power3.out",
            stagger: { each: 0.09, from: "random" },
            scrollTrigger: { trigger: ".lp-grid", start: "top 100%", end: "top 25%", scrub: 1 },
          },
        );
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className={`relative ${BG} overflow-hidden px-4 pb-28 pt-10 sm:px-8`}>
      <div aria-hidden="true" className="absolute left-1/2 top-0 h-[40rem] w-[60rem] -translate-x-1/2 rounded-full bg-accent/10 blur-[140px]" />
      <div className="relative mx-auto max-w-6xl">
        <FadeUp>
          <Kicker n="01">Khám phá</Kicker>
          <h2 className="mt-4 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Cả một vũ trụ nhân vật, <span className="text-gradient">rơi vào tầm tay bạn.</span>
          </h2>
          <p className="mt-4 max-w-xl text-lg text-fg-2">Chú thuật sư, ninja, siêu đạo chích, Lôi Thần… mỗi người một giọng nói, một ký ức, một thế giới.</p>
        </FadeUp>

        <div className="lp-grid mt-14 grid grid-cols-2 gap-4 [perspective:1200px] md:grid-cols-4 md:gap-5">
          {picks.map((c) => (
            <div key={c.id} className="lp-fall will-change-transform">
              <TiltCard hue={c.hue} className="h-full">
                <Link
                  href={`/character/${c.id}`}
                  className="group relative block aspect-[3/4] overflow-hidden rounded-2xl border border-white/10"
                  style={{ boxShadow: `0 20px 50px -20px hsl(${c.hue} 90% 50% / 0.6)` }}
                >
                  <Portrait seed={c.seed ?? c.id} hue={c.hue} className="absolute inset-0 size-full transition-transform duration-700 group-hover:scale-110" />
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.95)_0%,rgb(0_0_0/0.7)_28%,transparent_58%)]" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="text-lg font-bold leading-tight">{c.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-white/75">{c.tagline}</p>
                    <p className="mt-2 flex items-center gap-1 text-xs text-fg-3">
                      <MessageCircle className="size-3" aria-hidden="true" /> {formatCount(c.chats)}
                    </p>
                  </div>
                </Link>
              </TiltCard>
            </div>
          ))}
        </div>

        <FadeUp className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => {
              enterAsGuest();
              router.push("/");
            }}
            className="glass group flex items-center gap-2 rounded-full px-6 py-3 font-medium transition-all hover:scale-105 hover:bg-white/10 active:scale-95"
          >
            <Compass className="size-4 transition-transform duration-500 group-hover:rotate-180" aria-hidden="true" />
            Xem tất cả nhân vật
          </button>
        </FadeUp>
      </div>
    </section>
  );
}

/* ───────────────────────── 02 Chat: a self-playing conversation ───────────────────────── */

type Step =
  | { who: "user"; text: string; mood: MascotMood; lumi: string }
  | { who: "bot"; text: string; mood: MascotMood; lumi: string; emotion: string };

const SCRIPT: Step[] = [
  { who: "user", text: "Thầy Gojo! Thầy thật sự là mạnh nhất à?", mood: "think", lumi: "Có người dám hỏi thẳng kìa…" },
  {
    who: "bot",
    text: "*Kéo kính đen xuống, cười toe.* Hỏi thừa rồi. Tôi là mạnh nhất mà — nhưng cảm ơn đã hỏi nhé. 😎",
    emotion: "😎 Tự tin",
    mood: "happy",
    lumi: "Gojo đang khoái chí kìa!",
  },
  { who: "user", text: "Vậy sao lúc nào thầy cũng có vẻ cô đơn thế?", mood: "think", lumi: "Ồ… câu hỏi khó đây." },
  {
    who: "bot",
    text: "*Nụ cười khựng lại.* …Đứng trên đỉnh thì gió lạnh lắm. Chẳng mấy ai theo kịp đâu.",
    emotion: "🥺 Trầm lại",
    mood: "sad",
    lumi: "Gojo buồn mất rồi…",
  },
  { who: "user", text: "Em sẽ luyện tập để theo kịp thầy. Hứa đấy.", mood: "peek", lumi: "Ôi, quyết tâm ghê!" },
  {
    who: "bot",
    text: "*Xoa đầu bạn, bật cười.* Được! Buổi học đầu tiên: đi ăn bánh mochi với tôi. Tôi bao. 🍡",
    emotion: "✨ Tin tưởng",
    mood: "happy",
    lumi: "Thầy trò thành đôi rồi! ✨",
  },
];

type Msg = { id: number; who: "user" | "bot"; text: string; emotion?: string };

function ChatDemo() {
  const star = getCharacter("gojo") ?? characters[0];
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box, { margin: "-20% 0px" });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [mood, setMood] = useState<MascotMood>("wave");
  const [lumi, setLumi] = useState("Cùng xem Gojo trò chuyện nhé!");

  useEffect(() => {
    if (!inView) return;
    let alive = true;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    (async () => {
      let id = 0;
      while (alive) {
        setMsgs([]);
        setMood("wave");
        setLumi("Cùng xem Gojo trò chuyện nhé!");
        await sleep(900);
        for (const step of SCRIPT) {
          if (!alive) return;
          if (step.who === "user") {
            for (let i = 1; i <= step.text.length && alive; i++) {
              setDraft(step.text.slice(0, i));
              await sleep(26);
            }
            await sleep(250);
            setDraft("");
            setMsgs((m) => [...m, { id: id++, who: "user", text: step.text }]);
            setMood(step.mood);
            setLumi(step.lumi);
            await sleep(500);
          } else {
            setTyping(true);
            setMood("think");
            await sleep(1300);
            if (!alive) return;
            setTyping(false);
            setMsgs((m) => [...m, { id: id++, who: "bot", text: step.text, emotion: step.emotion }]);
            setMood(step.mood);
            setLumi(step.lumi);
            await sleep(2300);
          }
        }
        await sleep(3500);
      }
    })();
    return () => {
      alive = false;
    };
  }, [inView]);

  return (
    <section className={`relative ${BG} overflow-hidden px-4 py-28 sm:px-8`}>
      <div aria-hidden="true" className="absolute right-0 top-1/4 size-[36rem] rounded-full blur-[140px]" style={{ background: `hsl(${star.hue} 80% 45% / 0.18)` }} />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <FadeUp>
            <Kicker n="02">Trò chuyện</Kicker>
            <h2 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              Họ trả lời bằng <span className="text-gradient">cảm xúc</span>, không phải khuôn mẫu.
            </h2>
            <p className="mt-4 max-w-md text-lg text-fg-2">
              Mỗi nhân vật nhớ cá tính của mình, phản ứng theo từng câu bạn nói — vui, buồn, trêu chọc hay tin tưởng.
            </p>
          </FadeUp>

          {/* Lumi reacts */}
          <div className="mt-10 flex items-end gap-4">
            <motion.div layout className="relative size-32 shrink-0 sm:size-40">
              <div aria-hidden="true" className="absolute inset-4 rounded-full bg-violet/30 blur-2xl" />
              <Mascot mood={mood} track className="relative size-full drop-shadow-[0_0_30px_rgba(167,139,250,0.6)]" />
            </motion.div>
            <div className="relative mb-12 min-h-12">
              <AnimatePresence mode="wait">
                <motion.p
                  key={lumi}
                  initial={{ opacity: 0, y: 10, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.9 }}
                  transition={SPRING}
                  className="glass origin-bottom-left rounded-2xl rounded-bl-md px-4 py-2.5 text-sm font-medium"
                >
                  {lumi}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* phone-like chat window */}
        <FadeUp delay={0.1}>
          <div
            ref={box}
            className="glass relative mx-auto w-full max-w-lg overflow-hidden rounded-[2rem]"
            style={{ boxShadow: `0 40px 120px -30px hsl(${star.hue} 90% 50% / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.08)` }}
          >
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
              <span className="relative size-10 overflow-hidden rounded-full ring-2" style={{ boxShadow: `0 0 20px hsl(${star.hue} 90% 60% / 0.7)` }}>
                <Portrait seed={star.seed ?? star.id} hue={star.hue} className="size-full" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{star.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-fg-3">
                  <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
                  {typing ? "đang trả lời…" : "đang trực tuyến"}
                </p>
              </div>
            </div>
            <div className="flex h-[26rem] flex-col justify-end gap-3 overflow-hidden px-4 py-5">
              <AnimatePresence initial={false}>
                {msgs.map((m) =>
                  m.who === "user" ? (
                    <motion.div
                      key={m.id}
                      layout
                      initial={{ opacity: 0, x: 40, scale: 0.85 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={SPRING}
                      className="ml-auto max-w-[80%] origin-bottom-right rounded-2xl rounded-br-md bg-user-bubble px-4 py-2.5 text-[15px]"
                    >
                      {m.text}
                    </motion.div>
                  ) : (
                    <motion.div
                      key={m.id}
                      layout
                      initial={{ opacity: 0, x: -40, scale: 0.85 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={SPRING}
                      className="flex max-w-[88%] origin-bottom-left items-end gap-2"
                    >
                      <span className="size-7 shrink-0 overflow-hidden rounded-full">
                        <Portrait seed={star.seed ?? star.id} hue={star.hue} className="size-full" />
                      </span>
                      <div className="relative">
                        <div
                          className="rounded-2xl rounded-bl-md border border-white/10 px-4 py-2.5 text-[15px] leading-relaxed"
                          style={{ background: `linear-gradient(150deg, hsl(${star.hue} 60% 30% / 0.55), rgb(30 30 38 / 0.8))` }}
                        >
                          <RichText text={m.text} />
                        </div>
                        {m.emotion && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0, rotate: -20 }}
                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                            transition={{ ...SPRING, delay: 0.35 }}
                            className="absolute -right-3 -top-3 rounded-full border border-white/15 bg-[#1a1626] px-2.5 py-0.5 text-xs font-semibold"
                            style={{ boxShadow: `0 0 16px hsl(${star.hue} 90% 60% / 0.6)` }}
                          >
                            {m.emotion}
                          </motion.span>
                        )}
                      </div>
                    </motion.div>
                  ),
                )}
                {typing && (
                  <motion.div
                    key="typing"
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex w-fit items-center gap-1.5 rounded-2xl rounded-bl-md bg-white/5 px-4 py-3.5"
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="size-2 rounded-full"
                        style={{ background: `hsl(${star.hue} 90% 72%)` }}
                        animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="border-t border-white/[0.07] p-3">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 py-1.5 pl-4 pr-1.5">
                <p className="min-h-6 flex-1 truncate text-[15px]">
                  {draft || <span className="text-fg-3">Nhắn cho {star.name}…</span>}
                  {draft && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-accent" />}
                </p>
                <motion.span
                  animate={draft ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.6, repeat: draft ? Infinity : 0 }}
                  className="grid size-9 place-items-center rounded-full"
                  style={{ background: `linear-gradient(135deg, hsl(${star.hue} 90% 65%), hsl(${(star.hue + 40) % 360} 90% 65%))` }}
                >
                  <Send className="size-4 text-black" aria-hidden="true" />
                </motion.span>
              </div>
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ───────────────────────── 03 Create: a character assembles on scroll ───────────────────────── */

const DV = {
  name: "Đăng Vân",
  tagline: "Người giữ ngọn hải đăng cuối cùng",
  traits: ["🌊 Trầm lặng", "🔥 Ấm áp", "📜 Kể chuyện biển", "🌙 Hay thức khuya"],
  greeting: "*Khêu lại bấc đèn.* Bão sắp tới rồi. Vào đây sưởi ấm đi, tôi kể cậu nghe về con tàu ma…",
  hue: 195,
  seed: "dang-van-lighthouse",
};
const STEPS = ["Đặt tên & gương mặt", "Thổi tính cách", "Dạy lời chào", "Ra đời"];

function Assemble() {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const fired = useRef(false);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({
          defaults: { ease: "power3.out" },
          scrollTrigger: {
            trigger: ref.current,
            start: "top top",
            end: "+=170%",
            scrub: 0.8,
            pin: true,
            anticipatePin: 1,
            onUpdate: (self) => {
              const s = self.progress > 0.9 ? 3 : self.progress > 0.62 ? 2 : self.progress > 0.35 ? 1 : 0;
              if (s !== stepRef.current) {
                stepRef.current = s;
                setStep(s);
              }
              if (self.progress > 0.93 && !fired.current) {
                fired.current = true;
                const r = ref.current?.querySelector(".as-frame")?.getBoundingClientRect();
                if (r) burst((r.left + r.width / 2) / window.innerWidth, (r.top + r.height / 2) / window.innerHeight);
                sparkle([0, 7, 12, 16, 19, 24]);
              }
            },
          },
        });
        tl.from(".as-frame", { opacity: 0, scale: 0.85, duration: 0.5 })
          .from(".as-avatar", { x: -560, y: -300, rotate: -170, scale: 0.2, opacity: 0, filter: "blur(14px)", duration: 1 })
          .from(".as-name", { x: 520, y: -160, rotate: 25, opacity: 0, filter: "blur(10px)", duration: 0.8 }, "-=0.45")
          .from(".as-tagline", { y: 280, opacity: 0, filter: "blur(8px)", duration: 0.8 }, "-=0.45")
          .from(
            ".as-trait",
            {
              x: (i) => (i % 2 ? 1 : -1) * 460,
              y: (i) => -220 + i * 140,
              rotate: (i) => (i % 2 ? 1 : -1) * 70,
              opacity: 0,
              scale: 0.4,
              stagger: 0.14,
              duration: 0.7,
            },
            "-=0.2",
          )
          .from(".as-greet", { y: 240, scale: 0.6, opacity: 0, duration: 0.8 }, "-=0.1")
          .to(".as-flash", { opacity: 1, scale: 1.3, duration: 0.2, ease: "power2.out" })
          .to(".as-frame", { boxShadow: `0 0 0 1px hsl(${DV.hue} 95% 70% / 0.7), 0 0 120px 20px hsl(${DV.hue} 95% 55% / 0.45)`, duration: 0.4 }, "<")
          .to(".as-flash", { opacity: 0, scale: 2.2, duration: 0.5 })
          .from(".as-born", { scale: 0, opacity: 0, rotate: -25, ease: "back.out(3)", duration: 0.5 }, "<");
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className={`relative ${BG} flex min-h-svh items-center overflow-hidden px-4 py-20 sm:px-8`}>
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 size-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[150px]" style={{ background: `hsl(${DV.hue} 80% 40% / 0.14)` }} />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Kicker n="03">Sáng tạo</Kicker>
          <h2 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Thổi hồn cho <span className="text-gradient">nhân vật của riêng bạn.</span>
          </h2>
          <ol className="mt-8 space-y-2">
            {STEPS.map((s, i) => (
              <li key={s} className="relative flex items-center gap-3 rounded-xl px-4 py-3">
                {step === i && (
                  <motion.span layoutId="as-step" transition={SPRING} className="absolute inset-0 rounded-xl border border-white/10 bg-gradient-to-r from-accent/20 via-violet/10 to-transparent" />
                )}
                <span
                  className={`relative grid size-7 place-items-center rounded-full text-xs font-bold transition-all duration-300 ${
                    i <= step ? "bg-accent text-black shadow-[0_0_16px_rgb(138_180_255/0.7)]" : "bg-white/10 text-fg-3"
                  }`}
                >
                  {i === 3 ? <Sparkles className="size-3.5" aria-hidden="true" /> : i + 1}
                </span>
                <span className={`relative font-medium transition-colors ${i <= step ? "text-fg" : "text-fg-3"}`}>{s}</span>
              </li>
            ))}
          </ol>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="mt-8 w-fit">
            <Link href="/create" className="btn-glow flex items-center gap-2 rounded-full px-7 py-3.5 font-semibold">
              <WandSparkles className="size-4" aria-hidden="true" /> Tự tạo nhân vật
            </Link>
          </motion.div>
        </div>

        <div className="relative mx-auto w-full max-w-sm">
          <div className="as-frame relative rounded-[2rem] border border-dashed border-white/15 bg-white/[0.02] p-5">
            <div className="as-flash pointer-events-none absolute inset-0 rounded-[2rem] opacity-0" style={{ background: `radial-gradient(circle, hsl(${DV.hue} 95% 80% / 0.9), transparent 70%)` }} />
            <div className="as-avatar relative aspect-square overflow-hidden rounded-3xl" style={{ boxShadow: `0 20px 60px -20px hsl(${DV.hue} 95% 55% / 0.8)` }}>
              <Portrait seed={DV.seed} hue={DV.hue} className="size-full" />
              <span className="as-born absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-bold backdrop-blur" style={{ color: `hsl(${DV.hue} 95% 80%)` }}>
                ✨ Vừa ra đời
              </span>
            </div>
            <p className="as-name mt-4 text-3xl font-bold tracking-tight">{DV.name}</p>
            <p className="as-tagline mt-1 text-fg-2">{DV.tagline}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {DV.traits.map((t) => (
                <span key={t} className="as-trait rounded-full border border-white/10 px-3 py-1 text-sm" style={{ background: `hsl(${DV.hue} 70% 50% / 0.14)` }}>
                  {t}
                </span>
              ))}
            </div>
            <div className="as-greet mt-4 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed">
              <RichText text={DV.greeting} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Stats ───────────────────────── */

function Count({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    const c = animate(0, to, {
      duration: 1.8,
      ease: EASE,
      onUpdate: (v) => (el.textContent = `${to >= 1000 ? formatCount(Math.round(v)) : Math.round(v)}${suffix}`),
    });
    return () => c.stop();
  }, [inView, to, suffix]);
  return <span ref={ref}>0{suffix}</span>;
}

function Stats() {
  const total = characters.reduce((s, c) => s + c.chats, 0);
  const items = [
    { n: characters.length, s: "", label: "nhân vật sẵn sàng" },
    { n: total, s: "+", label: "lượt trò chuyện" },
    { n: scenes.length, s: "", label: "bối cảnh nhập vai" },
    { n: 4, s: " bước", label: "để tạo nhân vật" },
  ];
  return (
    <section className={`relative ${BG} px-4 pb-32 pt-10 sm:px-8`}>
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 md:grid-cols-4">
        {items.map((it, i) => (
          <FadeUp key={it.label} delay={i * 0.08}>
            <div className="glass group rounded-3xl p-6 transition-transform duration-300 hover:-translate-y-1">
              <p className="text-gradient text-4xl font-bold tracking-tight sm:text-5xl">
                <Count to={it.n} suffix={it.s} />
              </p>
              <p className="mt-2 text-sm text-fg-2">{it.label}</p>
            </div>
          </FadeUp>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── Final CTA: back to the universe ───────────────────────── */

function FinalCta({ ctaRef, webgl, signedIn }: { ctaRef: React.RefObject<HTMLElement | null>; webgl: boolean; signedIn: boolean }) {
  const router = useRouter();
  return (
    <section ref={ctaRef} className="pointer-events-none relative flex min-h-svh flex-col items-center justify-end px-4 pb-24 text-center">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-[#05050a] to-transparent" />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-[70%] bg-[radial-gradient(ellipse_62%_55%_at_50%_68%,rgb(5_5_10/0.8)_0%,rgb(5_5_10/0.45)_45%,transparent_75%)]"
      />
      {!webgl && <Mascot mood="wave" track className="absolute left-1/2 top-[18%] w-44 -translate-x-1/2" />}
      <motion.div
        initial={{ opacity: 0, scale: 0.6, y: 20 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={{ once: false, amount: "all" }}
        transition={{ ...SPRING, delay: 0.6 }}
        className="glass absolute left-1/2 top-[9%] max-w-xs !bg-[#0b0b16]/85 shadow-[0_0_40px_-8px_rgb(167_139_250/0.6)] backdrop-blur-xl -translate-x-1/2 rounded-2xl rounded-bl-md px-4 py-3 text-sm font-medium sm:left-[62%] sm:top-[17%] sm:translate-x-0"
      >
        Psst! Mình là <span className="text-gradient font-bold">Lumi</span> — người dẫn chuyện ở đây. Vào đi, mọi người đang đợi bạn đó ✨
      </motion.div>
      <FadeUp>
        <h2 className="text-5xl font-bold leading-[1.02] tracking-tight [text-shadow:0_4px_40px_rgb(5_5_10/0.9)] sm:text-7xl">
          Nhân vật của bạn
          <br />
          <span className="text-gradient">đang chờ.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-md text-lg text-fg-2 [text-shadow:0_2px_20px_rgb(5_5_10/0.9)]">
          Miễn phí. Không cần thẻ. Chỉ cần một câu chào đầu tiên.
        </p>
      </FadeUp>
      <FadeUp delay={0.15} className="pointer-events-auto mt-8 flex flex-wrap justify-center gap-3">
        <motion.div whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }}>
          <Link href={signedIn ? "/" : "/signup"} className="btn-glow group flex animate-pulse-glow items-center gap-2 rounded-full px-8 py-4 text-base font-semibold">
            {signedIn ? "Vào thế giới của bạn" : "Tạo tài khoản miễn phí"}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
        </motion.div>
        {!signedIn && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              enterAsGuest();
              router.push("/");
            }}
            className="glass rounded-full px-6 py-4 font-medium transition-colors hover:bg-white/10"
          >
            Dạo xem trước
          </motion.button>
        )}
      </FadeUp>
    </section>
  );
}

function Footer() {
  return (
    <footer className={`relative ${BG} border-t border-white/[0.06] px-4 py-10 sm:px-8`}>
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-fg-3 sm:flex-row">
        <Logo />
        <p className="text-center">Nhân vật anime & game thuộc về tác giả gốc, dùng cho bản demo fan-made — tài khoản lưu ngay trên trình duyệt của bạn.</p>
      </div>
    </footer>
  );
}

export function LandingSections(props: { ctaRef: React.RefObject<HTMLElement | null>; webgl: boolean; signedIn: boolean }) {
  return (
    <div className="relative z-10">
      <Marquee />
      <Discover />
      <ChatDemo />
      <Assemble />
      <Stats />
      <FinalCta {...props} />
      <Footer />
    </div>
  );
}
