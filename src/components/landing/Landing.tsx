"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type * as THREE from "three";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowRight, ChevronsDown, RotateCcw, SkipForward, Volume2, VolumeX } from "lucide-react";
import { enterAsGuest, useUser } from "@/lib/auth";
import { stars, type Character } from "@/lib/data";
import { bloom, chime, isSoundOn, onSoundChange, setSound, sparkle, whoosh } from "@/lib/sound";
import { Logo } from "../AppShell";
import { Portrait } from "../Portrait";
import { makeCardTexture } from "./cardTexture";
import { FallbackUniverse } from "./FallbackUniverse";
import { LandingSections } from "./Sections";
import { INTRO, resetStage, skipIntro, stage, stageTime } from "./stage";

gsap.registerPlugin(useGSAP);

const Scene = dynamic(() => import("./Scene"), { ssr: false });

/** 30 cards: the ten headline characters three times, rotated so repeats never sit side by side. */
const CARDS: Character[] = [0, 3, 7].flatMap((r) => [...stars.slice(r), ...stars.slice(0, r)]);

const LINE_1 = "Trò chuyện với những";
const LINE_2 = "nhân vật có linh hồn";
const GRADIENT = ["#c7dbff", "#8ab4ff", "#a78bfa", "#c4b5fd", "#f0abfc"];

function graphemes(s: string) {
  const seg = new Intl.Segmenter("vi", { granularity: "grapheme" });
  return Array.from(seg.segment(s), (x) => x.segment);
}

function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [r1, g1, b1] = ch(pa);
  const [r2, g2, b2] = ch(pb);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)} ${Math.round(g1 + (g2 - g1) * t)} ${Math.round(b1 + (b2 - b1) * t)})`;
}

function gradientAt(t: number) {
  const x = t * (GRADIENT.length - 1);
  const i = Math.min(GRADIENT.length - 2, Math.floor(x));
  return mixHex(GRADIENT[i], GRADIENT[i + 1], x - i);
}

/** Split a line into words → grapheme spans (words never break mid-way). */
function SplitLine({ text, gradient }: { text: string; gradient?: boolean }) {
  const words = text.split(" ");
  const total = graphemes(text.replace(/ /g, "")).length;
  let n = 0;
  return (
    <span className="block">
      {words.map((w, wi) => (
        <span key={wi} className="inline-block whitespace-nowrap">
          {graphemes(w).map((g, gi) => {
            const color = gradient ? gradientAt(n++ / Math.max(1, total - 1)) : undefined;
            return (
              <span key={gi} className="lp-char" style={{ color, opacity: 0 }}>
                {g}
              </span>
            );
          })}
          {wi < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
    </span>
  );
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function Landing() {
  const router = useRouter();
  const user = useUser();
  const [gl, setGl] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [textures, setTextures] = useState<Map<string, THREE.Texture> | null>(null);
  const [active, setActive] = useState(true);
  const [sound, setSoundState] = useState(false);
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState<Character | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const portraits = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const cta = useRef<HTMLElement>(null);

  const unique = useMemo(() => stars, []);

  // Boot: reset the clock, detect WebGL, track the pointer.
  useEffect(() => {
    resetStage();
    if (window.location.search.includes("lpdebug")) (window as unknown as { __lp: typeof stage }).__lp = stage;
    // `?nogl` forces the CSS fallback so it can be previewed on any machine.
    const ok = !window.location.search.includes("nogl") && hasWebGL();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capability probe needs the DOM
    setGl(ok);
    if (!ok) stage.start = performance.now();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) skipIntro();
    const onMove = (e: PointerEvent) => {
      stage.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      stage.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);
    const off = onSoundChange(setSoundState);
    return () => {
      window.removeEventListener("pointermove", onMove);
      off();
      document.body.style.cursor = "";
    };
  }, []);

  // Paint card textures from the hidden SVG portraits once fonts are in.
  useEffect(() => {
    if (!gl) return;
    let cancelled = false;
    (async () => {
      await document.fonts.ready;
      const font = getComputedStyle(document.body).fontFamily;
      const map = new Map<string, THREE.Texture>();
      await Promise.all(
        unique.map(async (c) => {
          const svg = portraits.current?.querySelector(`[data-cid="${c.id}"] svg`)?.outerHTML;
          map.set(c.id, await makeCardTexture(c, svg, font));
        }),
      );
      if (!cancelled) setTextures(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [gl, unique]);

  // Only render the canvas while the hero or the final CTA is on screen.
  useEffect(() => {
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          seen.set(e.target, e.isIntersecting);
          if (e.target === cta.current) {
            stage.mode = e.isIntersecting ? "cta" : "hero";
            if (e.isIntersecting) stage.waveAt = performance.now();
          }
        }
        const on = [...seen.values()].some(Boolean);
        stage.visible = on;
        setActive(on);
      },
      { threshold: 0.02 },
    );
    if (hero.current) io.observe(hero.current);
    if (cta.current) io.observe(cta.current);
    return () => io.disconnect();
  }, []);

  const onReady = useCallback(() => {
    if (stage.start === null) stage.start = performance.now();
    setReady(true);
  }, []);

  const onSelect = useCallback(
    (i: number) => {
      const c = CARDS[i];
      stage.flying = { index: i, at: performance.now() };
      stage.hovered = null;
      whoosh(1.2, 0.3);
      chime(7, 0.12);
      router.prefetch(`/character/${c.id}`);
      setLeaving(c);
      window.setTimeout(() => router.push(`/character/${c.id}`), 1150);
    },
    [router],
  );

  const onPoke = useCallback(() => sparkle([12, 16, 19, 24]), []);

  // Hero timeline — driven by the shared stage clock so "skip" and "replay" just seek it.
  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const chars1 = q(".lp-title-1 .lp-char");
      const chars2 = q(".lp-title-2 .lp-char");
      const tl = gsap.timeline({ paused: true });
      tl.set(q(".lp-hud-late"), { autoAlpha: 0, y: -12 }, 0)
        .fromTo(q(".lp-scrim"), { opacity: 0 }, { opacity: 1, duration: 1.4, ease: "sine.inOut" }, INTRO.title - 0.6)
        .fromTo(
          [...chars1, ...chars2],
          { opacity: 0, yPercent: 70, rotateX: -85, scale: 0.6, filter: "blur(14px)" },
          {
            opacity: 1,
            yPercent: 0,
            rotateX: 0,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.9,
            ease: "expo.out",
            stagger: 0.028,
          },
          INTRO.title,
        )
        .fromTo(q(".lp-streak"), { x: "-110%", opacity: 0 }, { x: "260%", opacity: 1, duration: 1.1, ease: "power2.inOut" }, INTRO.title + 0.7)
        .to(q(".lp-streak"), { opacity: 0, duration: 0.3 }, INTRO.title + 1.5)
        .to(
          [...chars1, ...chars2],
          {
            keyframes: [
              { textShadow: "0 0 18px rgba(255,255,255,0.95), 0 0 42px rgba(167,139,250,0.9)", filter: "brightness(1.9)", duration: 0.16 },
              { textShadow: "0 0 0px rgba(255,255,255,0), 0 0 0px rgba(167,139,250,0)", filter: "brightness(1)", duration: 0.45 },
            ],
            stagger: 0.022,
            ease: "sine.inOut",
          },
          INTRO.title + 0.75,
        )
        .fromTo(q(".lp-sub"), { opacity: 0, y: 24, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.8, ease: "expo.out" }, INTRO.sub)
        .fromTo(
          q(".lp-cta-item"),
          { opacity: 0, y: 30, scale: 0.7 },
          { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: "back.out(2.2)", stagger: 0.12 },
          INTRO.cta,
        )
        .to(q(".lp-hud-late"), { autoAlpha: 1, y: 0, duration: 0.6, ease: "expo.out", stagger: 0.08 }, INTRO.title - 0.4)
        .fromTo(q(".lp-scroll"), { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.6 }, INTRO.done - 0.4);

      // Sound cues (only audible once the viewer turns sound on).
      const cues: [number, () => void][] = [
        [0.3, () => chime(-12, 0.06)],
        [INTRO.bloom, () => {
          bloom();
          chime(0, 0.16);
        }],
        [INTRO.eyes, () => chime(7, 0.12)],
        [INTRO.wave, () => sparkle([12, 16, 19])],
        [INTRO.burst, () => {
          whoosh(1.6, 0.34);
          sparkle([0, 4, 7, 11, 14, 19, 24]);
        }],
        [INTRO.title, () => chime(12, 0.1)],
        [INTRO.cta, () => chime(19, 0.08)],
      ];
      let last = -1;
      let wasDone = false;
      const tick = () => {
        const t = stageTime();
        if (stage.start === null) return;
        tl.time(Math.min(t, tl.duration()));
        if (t < last - 0.25) last = -1; // replay
        for (const [at, fn] of cues) if (last < at && t >= at && t - at < 0.5) fn();
        last = t;
        const d = t >= INTRO.done - 0.5;
        if (d !== wasDone) {
          wasDone = d;
          setDone(d);
        }
      };
      gsap.ticker.add(tick);
      return () => gsap.ticker.remove(tick);
    },
    { scope: root },
  );

  const replay = () => {
    stage.start = performance.now();
    stage.offset = 0;
    stage.flying = null;
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  // Presenter shortcuts: M = sound, R = replay, S = skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (e.key === "m" || e.key === "M") void setSound(!isSoundOn());
      if (e.key === "r" || e.key === "R") replay();
      if (e.key === "s" || e.key === "S") skipIntro();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const primary = user ? { href: "/", label: "Vào thế giới của bạn" } : { href: "/signup", label: "Bắt đầu miễn phí" };

  return (
    <div ref={root} className="relative min-h-svh overflow-x-clip bg-[#05050a] text-fg">
      {/* 3D universe (fixed behind everything) */}
      <div className="fixed inset-0 z-0" aria-hidden={gl === false ? undefined : true}>
        {gl && (
          <Scene cards={CARDS} textures={textures} onSelect={onSelect} onReady={onReady} onPoke={onPoke} active={active} />
        )}
        {gl === false && <FallbackUniverse faces={CARDS.slice(0, 12)} />}
        {/* the first breath, before WebGL is warm */}
        <AnimatePresence>
          {gl !== false && !ready && (
            <motion.div key="spark" exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-[#05050a]">
              <span className="lp-spark" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* hidden SVG portraits → card textures */}
      <div ref={portraits} aria-hidden="true" className="pointer-events-none fixed -left-[9999px] top-0 size-0 overflow-hidden">
        {unique.map((c) => (
          <div key={c.id} data-cid={c.id}>
            <Portrait seed={c.seed ?? c.id} hue={c.hue} />
          </div>
        ))}
      </div>

      {/* HUD */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <div className="lp-hud-late invisible">
          <Logo />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void setSound(!sound)}
            aria-pressed={sound}
            aria-label={sound ? "Tắt âm thanh" : "Bật âm thanh"}
            title="Âm thanh (M)"
            className={`group relative grid size-10 place-items-center rounded-full border backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 ${
              sound ? "border-accent/60 bg-accent/15 text-accent shadow-[0_0_24px_rgb(138_180_255/0.5)]" : "border-white/10 bg-white/5 text-fg-2 opacity-60 hover:opacity-100"
            }`}
          >
            {sound ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
            {sound && <span className="absolute inset-0 animate-ping rounded-full border border-accent/40 [animation-duration:2.4s]" />}
          </button>
          <button
            type="button"
            onClick={done ? replay : skipIntro}
            title={done ? "Xem lại mở màn (R)" : "Bỏ qua (S)"}
            className="flex h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-fg-2 opacity-70 backdrop-blur-md transition-all hover:scale-105 hover:text-fg hover:opacity-100 active:scale-95"
          >
            {done ? (
              <>
                <RotateCcw className="size-3.5" aria-hidden="true" /> Xem lại
              </>
            ) : (
              <>
                Bỏ qua <SkipForward className="size-3.5" aria-hidden="true" />
              </>
            )}
          </button>
          {!user && (
            <Link
              href="/login"
              className="lp-hud-late invisible hidden h-10 items-center rounded-full border border-white/15 bg-white/10 px-5 text-sm font-medium backdrop-blur-md transition-all hover:scale-105 hover:bg-white/20 sm:flex"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </header>

      {/* HERO — transparent so the universe shows; clicks fall through to the cards */}
      <section ref={hero} aria-labelledby="lp-title" className="pointer-events-none relative z-10 flex h-svh flex-col items-center justify-end px-4 pb-[9vh] text-center">
        <div aria-hidden="true" className="lp-scrim absolute inset-x-0 bottom-0 h-[78%] bg-[radial-gradient(ellipse_62%_52%_at_50%_62%,rgb(5_5_10/0.78)_0%,rgb(5_5_10/0.45)_45%,transparent_75%)] opacity-0" />
        <h1
          id="lp-title"
          aria-label={`${LINE_1} ${LINE_2}`}
          className="relative text-[clamp(2.2rem,6.4vw,5.6rem)] font-bold leading-[1.02] tracking-[-0.035em] [perspective:800px] [text-shadow:0_4px_40px_rgb(5_5_10/0.8)]"
        >
          <span aria-hidden="true" className="lp-title-1 block text-white">
            <SplitLine text={LINE_1} />
          </span>
          <span aria-hidden="true" className="lp-title-2 block">
            <SplitLine text={LINE_2} gradient />
          </span>
          <span aria-hidden="true" className="lp-streak" />
        </h1>
        <p className="lp-sub mt-5 max-w-xl text-balance text-base text-fg-2 opacity-0 sm:text-lg [text-shadow:0_2px_20px_rgb(5_5_10/0.9)]">
          Gojo, Naruto, Conan, Rem… cùng hàng chục nhân vật có ký ức và cá tính riêng — đang chờ bạn bắt chuyện. Hoặc tự tay thổi hồn cho một nhân vật mới.
        </p>
        <div className="lp-cta pointer-events-auto mt-8 flex flex-wrap items-center justify-center gap-3">
          <div className="lp-cta-item opacity-0">
            <motion.div whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }}>
              <Link href={primary.href} className="btn-glow group flex animate-pulse-glow items-center gap-2 rounded-full px-8 py-4 text-base font-semibold">
                {primary.label}
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </motion.div>
          </div>
          {!user && (
            <div className="lp-cta-item opacity-0">
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  enterAsGuest();
                  router.push("/");
                }}
                className="glass rounded-full px-6 py-4 text-base font-medium transition-colors hover:bg-white/10"
              >
                Dạo xem trước
              </motion.button>
            </div>
          )}
        </div>
        <div className="lp-scroll invisible absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-xs text-fg-3">
          <span>Cuộn để khám phá</span>
          <ChevronsDown className="size-4 animate-bounce" aria-hidden="true" />
        </div>
      </section>

      <LandingSections ctaRef={cta} webgl={gl !== false} signedIn={!!user} />

      {/* flight → page transition */}
      <AnimatePresence>
        {leaving && (
          <motion.div
            key="leave"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.75, duration: 0.4 }}
            className="fixed inset-0 z-50 grid place-items-center"
            style={{ background: `radial-gradient(circle at 50% 50%, hsl(${leaving.hue} 70% 22%), #05050a 70%)` }}
          >
            <motion.p
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.85 }}
              className="text-lg font-medium text-fg-2"
            >
              Đang mở hồ sơ <span className="font-semibold text-fg">{leaving.name}</span>…
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
