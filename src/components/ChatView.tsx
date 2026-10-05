"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ChevronLeft, RotateCcw, Square, UserRound } from "lucide-react";
import type { Character, Scene } from "@/lib/data";
import {
  clearHistory,
  loadHistory,
  saveHistory,
  streamReply,
  type ChatMessage,
} from "@/lib/chat/client";
import { Mascot } from "./Mascot";
import { Portrait } from "./Portrait";
import { RichText } from "./RichText";

const SPRING = { type: "spring", stiffness: 380, damping: 26, mass: 0.8 } as const;

export function ChatView({ character: c, scene }: { character: Character; scene?: Scene }) {
  const greeting: ChatMessage = { role: "assistant", content: c.greeting };
  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);

  // Restore saved conversation after mount (localStorage is client-only).
  useEffect(() => {
    const saved = loadHistory(c.id, scene?.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from external storage once
    if (saved?.length) setMessages(saved);
    loaded.current = true;
    return () => abortRef.current?.abort();
  }, [c.id, scene?.id]);

  useEffect(() => {
    if (loaded.current && messages.length > 1 && !streaming) saveHistory(c.id, scene?.id, messages);
  }, [messages, streaming, c.id, scene?.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  async function send(history: ChatMessage[]) {
    setError(null);
    setStreaming(true);
    setMessages([...history, { role: "assistant", content: "" }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";
    try {
      const m = await streamReply(
        // The greeting is added server-side; don't send it twice.
        {
          characterId: c.id,
          character: c.id.startsWith("u-") ? c : undefined,
          sceneId: scene?.id,
          messages: history.slice(1),
        },
        (chunk) => {
          acc += chunk;
          setMessages([...history, { role: "assistant", content: acc }]);
        },
        ctrl.signal,
      );
      setMode(m);
      if (!acc.trim()) throw new Error("Nhân vật không trả lời. Hãy thử lại.");
    } catch (e) {
      if (ctrl.signal.aborted) {
        if (!acc) setMessages(history);
      } else {
        setMessages(acc ? [...history, { role: "assistant", content: acc }] : history);
        setError(e instanceof Error ? e.message : "Đã có lỗi xảy ra.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function submit() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    send([...messages, { role: "user", content: text }]);
  }

  function retry() {
    const lastUser = messages.at(-1)?.role === "user" ? messages : messages.slice(0, -1);
    if (lastUser.at(-1)?.role === "user") send(lastUser);
  }

  function reset() {
    abortRef.current?.abort();
    clearHistory(c.id, scene?.id);
    setMessages([greeting]);
    setError(null);
    inputRef.current?.focus();
  }

  const waitingFirstToken = streaming && messages.at(-1)?.content === "";
  const lumiMood = error ? "sad" : waitingFirstToken ? "think" : streaming ? "happy" : "idle";

  return (
    <div className="relative flex h-[calc(100dvh-57px)] flex-col overflow-hidden lg:h-dvh">
      {/* ambient character-coloured light */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -top-40 left-1/2 size-[60rem] -translate-x-1/2 animate-breathe rounded-full blur-[120px]"
          style={{ background: `radial-gradient(circle, hsl(${c.hue} 90% 55% / 0.22), transparent 60%)` }}
        />
        <div
          className="absolute -bottom-40 -right-20 size-[36rem] animate-aurora rounded-full blur-[110px]"
          style={{ background: `radial-gradient(circle, hsl(${(c.hue + 60) % 360} 85% 60% / 0.14), transparent 60%)` }}
        />
      </div>

      <header className="glass relative z-10 flex items-center gap-3 border-x-0 border-t-0 px-4 py-3 sm:px-6">
        <Link href={`/character/${c.id}`} aria-label="Quay lại hồ sơ" className="rounded-full p-1.5 text-fg-2 transition-colors hover:bg-white/10 hover:text-fg">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <div className="relative">
          <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-10 shrink-0 rounded-full" />
          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-canvas bg-emerald-400" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{c.name}</h1>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={streaming ? "typing" : "idle"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={`truncate text-xs ${streaming ? "text-accent" : "text-fg-2"}`}
            >
              {streaming ? "đang trả lời…" : scene ? `Cảnh: ${scene.title}` : `Người thực hiện @${c.creator}`}
            </motion.p>
          </AnimatePresence>
        </div>
        <Link
          href={`/character/${c.id}`}
          className="hidden items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm text-fg-2 transition-colors hover:bg-white/10 hover:text-fg sm:flex"
        >
          <UserRound className="size-4" aria-hidden="true" /> Hồ sơ
        </Link>
        <motion.button
          type="button"
          onClick={reset}
          whileTap={{ scale: 0.94 }}
          className="group flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm text-fg-2 transition-colors hover:bg-white/10 hover:text-fg"
        >
          <RotateCcw className="size-4 transition-transform duration-500 group-hover:-rotate-180" aria-hidden="true" />
          <span className="hidden sm:inline">Cuộc trò chuyện mới</span>
          <span className="sr-only sm:hidden">Cuộc trò chuyện mới</span>
        </motion.button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6" role="log" aria-live="polite" aria-label={`Cuộc trò chuyện với ${c.name}`}>
          <motion.div
            initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-2 pb-4 text-center"
          >
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute -inset-3 animate-pulse-glow rounded-full blur-xl"
                style={{ background: `hsl(${c.hue} 90% 60% / 0.45)` }}
              />
              <Portrait seed={c.seed ?? c.id} hue={c.hue} className="relative size-24 rounded-full ring-2 ring-white/15" />
            </div>
            <p className="mt-1 text-lg font-semibold">{c.name}</p>
            <p className="max-w-md text-sm text-fg-2">{c.tagline}</p>
            {mode === "demo" && (
              <p className="rounded-md bg-accent-bg px-2 py-1 text-xs text-accent">Chế độ demo (chưa cấu hình LLM)</p>
            )}
          </motion.div>

          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            if (m.role === "assistant" && isLast && waitingFirstToken) {
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -16, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={SPRING}
                  className="flex items-end gap-3"
                >
                  <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-8 shrink-0 rounded-full" />
                  <div
                    className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-white/[0.06] px-4 py-3"
                    style={{ background: `linear-gradient(135deg, hsl(${c.hue} 35% 20% / 0.9), rgb(44 44 49 / 0.9))` }}
                    aria-label={`${c.name} đang nhập`}
                  >
                    {[0, 1, 2].map((d) => (
                      <motion.span
                        key={d}
                        className="size-2 rounded-full"
                        style={{ background: `hsl(${c.hue} 90% 75%)` }}
                        animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15, ease: "easeInOut" }}
                      />
                    ))}
                  </div>
                </motion.div>
              );
            }
            return m.role === "assistant" ? (
              <motion.div
                key={i}
                initial={i === 0 ? false : { opacity: 0, x: -24, scale: 0.94 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={SPRING}
                style={{ originX: 0, originY: 1 }}
                className="flex gap-3"
              >
                <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium text-fg-2">{c.name}</p>
                  <div
                    className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm border border-white/[0.06] px-4 py-2.5 text-[15px] leading-relaxed shadow-lg shadow-black/20"
                    style={{ background: `linear-gradient(135deg, hsl(${c.hue} 30% 19% / 0.92), rgb(40 40 46 / 0.92))` }}
                  >
                    <RichText text={m.content} />
                    {streaming && isLast && (
                      <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-fg-2" />
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 24, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                transition={SPRING}
                style={{ originX: 1, originY: 1 }}
                className="flex justify-end"
              >
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#4a4a58] to-user-bubble px-4 py-2.5 text-[15px] leading-relaxed shadow-lg shadow-black/20">
                  <RichText text={m.content} />
                </div>
              </motion.div>
            );
          })}

          <AnimatePresence>
            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: 8, x: 0 }}
                animate={{ opacity: 1, y: 0, x: [0, -8, 7, -4, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm"
              >
                <span className="flex-1 text-danger">{error}</span>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  onClick={retry}
                  className="rounded-full bg-surface-2 px-3 py-1 text-fg hover:bg-user-bubble"
                >
                  Thử lại
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="relative mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6"
      >
        {/* Lumi keeps the user company while the character thinks */}
        <div className="pointer-events-none absolute -top-14 right-6 hidden sm:block" aria-hidden="true">
          <motion.div animate={{ y: streaming ? [0, -6, 0] : 0 }} transition={{ duration: 1.2, repeat: streaming ? Infinity : 0, ease: "easeInOut" }}>
            <Mascot mood={lumiMood} className="size-14 drop-shadow-[0_0_18px_rgba(167,139,250,0.55)]" />
          </motion.div>
        </div>
        <div className="glass flex items-end gap-2 rounded-3xl p-2 pl-4 transition-shadow duration-300 focus-within:border-accent/60 focus-within:shadow-[0_0_0_4px_rgba(138,180,255,0.12),0_0_40px_-8px_rgba(138,180,255,0.5)]">
          <label htmlFor="msg" className="sr-only">
            Nhắn tin cho {c.name}
          </label>
          <textarea
            id="msg"
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`Nhắn tin cho ${c.name}…`}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] placeholder:text-fg-3 focus:outline-none focus-visible:outline-none [field-sizing:content]"
          />
          <AnimatePresence mode="popLayout" initial={false}>
            {streaming ? (
              <motion.button
                key="stop"
                type="button"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => abortRef.current?.abort()}
                aria-label="Dừng trả lời"
                className="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-canvas"
              >
                <Square className="size-4 fill-current" aria-hidden="true" />
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="submit"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                whileHover={input.trim() ? { scale: 1.08 } : undefined}
                whileTap={input.trim() ? { scale: 0.88, y: -2 } : undefined}
                aria-label="Gửi"
                disabled={!input.trim()}
                className="grid size-10 shrink-0 place-items-center rounded-full text-black transition-[background,box-shadow] disabled:bg-surface-2 disabled:text-fg-3"
                style={
                  input.trim()
                    ? { background: `linear-gradient(135deg, hsl(${c.hue} 90% 80%), hsl(${(c.hue + 50) % 360} 85% 68%))`, boxShadow: `0 0 20px -2px hsl(${c.hue} 90% 65% / 0.6)` }
                    : undefined
                }
              >
                <ArrowUp className="size-5" aria-hidden="true" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <p className="mt-2 text-center text-[11px] text-fg-3">
          Đây là nhân vật AI hư cấu, không phải người thật. Hãy coi mọi điều nhân vật nói là hư cấu.
        </p>
      </form>
    </div>
  );
}
