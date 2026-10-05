"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, UserPlus } from "lucide-react";
import { getCharacter, type Scene } from "@/lib/data";
import { Portrait } from "./Portrait";

export function SceneCarousel({ scenes }: { scenes: Scene[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section
      aria-labelledby="rail-canh"
      aria-roledescription="carousel"
      className="relative"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="rail-canh" className="text-[17px] font-semibold">
          Cảnh
        </h2>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Cảnh trước"
            disabled={edges.start}
            onClick={() => scrollBy(-1)}
            className="rounded-full bg-white/[0.06] p-1.5 text-fg-2 transition-[background,transform] hover:bg-white/10 hover:text-fg active:scale-90 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Cảnh tiếp theo"
            disabled={edges.end}
            onClick={() => scrollBy(1)}
            className="rounded-full bg-white/[0.06] p-1.5 text-fg-2 transition-[background,transform] hover:bg-white/10 hover:text-fg active:scale-90 disabled:opacity-40"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <ul
        ref={ref}
        onScroll={update}
        tabIndex={0}
        aria-label="Danh sách cảnh, dùng phím mũi tên để cuộn"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          scrollBy(e.key === "ArrowRight" ? 1 : -1);
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || !ref.current) return;
          drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !ref.current) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 5) {
            d.moved = true;
            ref.current.style.scrollSnapType = "none";
          }
          ref.current.scrollLeft = d.left - dx;
        }}
        onPointerUp={() => {
          if (ref.current) ref.current.style.scrollSnapType = "";
          setTimeout(() => (drag.current = null), 0);
        }}
        onPointerLeave={() => {
          if (ref.current) ref.current.style.scrollSnapType = "";
          drag.current = null;
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="no-scrollbar -mx-4 flex cursor-grab snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 px-4 pb-6 pt-2 active:cursor-grabbing sm:mx-0 sm:scroll-px-0 sm:px-0"
      >
        {scenes.map((s, i) => {
          const lead = getCharacter(s.characterIds[0]);
          return (
            <li
              key={s.id}
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${scenes.length}: ${s.title}`}
              className="w-[44vw] max-w-[200px] shrink-0 snap-start sm:w-[200px]"
            >
              <Link href={`/scene/${s.id}`} className="group block" draggable={false}>
                <div
                  className="relative aspect-[5/7] overflow-hidden rounded-2xl bg-surface ring-1 ring-white/[0.06] transition-[transform,box-shadow] duration-500 ease-[var(--ease-expo)] group-hover:-translate-y-1.5 group-hover:shadow-[0_24px_50px_-12px_var(--glow)] group-hover:ring-white/20"
                  style={{ "--glow": `hsl(${s.hue} 90% 55% / 0.65)` } as React.CSSProperties}
                >
                  <Portrait
                    seed={s.id}
                    hue={s.hue}
                    variant="scene"
                    className="absolute inset-0 size-full transition-transform duration-700 ease-[var(--ease-expo)] group-hover:scale-[1.1]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
                  />
                  <span className="absolute right-2.5 top-2.5 rounded-md bg-white/90 p-1 text-black">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="absolute inset-x-3 bottom-3">
                    <p className="line-clamp-2 text-[15px] font-medium leading-snug">{s.title}</p>
                    <p className="mt-2 flex items-center gap-1.5 text-xs">
                      {lead ? (
                        <Portrait seed={lead.seed ?? lead.id} hue={lead.hue} className="size-5 rounded-full ring-1 ring-white/40" />
                      ) : (
                        <UserPlus className="size-4" aria-hidden="true" />
                      )}
                      Chọn nhân vật
                    </p>
                  </div>
                </div>
                <p className="mt-1.5 truncate text-center text-xs text-fg-2">
                  Người thực hiện @{s.creator}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
