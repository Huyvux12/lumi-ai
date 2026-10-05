"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  ChevronLeft,
  RotateCcw,
  Square,
  UserRound,
  Mic,
  Volume2,
  Upload,
  Loader2,
} from "lucide-react";
import type { Character, Scene } from "@/lib/data";
import {
  streamTurn,
  refreshRecent,
  type ChatMessage,
  type Conversation,
} from "@/lib/chat/client";
import { api, mutation, requestId } from "@/lib/api";
import { useAuthReady, useUser } from "@/lib/auth";
import { DialoguePlayer, transcript, type Voice } from "@/lib/chat/speech";
import { Mascot } from "./Mascot";
import { Portrait } from "./Portrait";
import { RichText } from "./RichText";

const SPRING = {
  type: "spring",
  stiffness: 380,
  damping: 26,
  mass: 0.8,
} as const;

export function ChatView({
  character: c,
  scene,
  initialConversationId,
}: {
  character: Character;
  scene?: Scene;
  initialConversationId?: string;
}) {
  const user = useUser();
  const authReady = useAuthReady();
  const greeting: ChatMessage = { role: "assistant", content: c.greeting };
  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [older, setOlder] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptionRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<string | null>(null);
  const answerRef = useRef<string | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const voiceEpoch = useRef(0);
  const player = useRef<DialoguePlayer | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const tracks = useRef<MediaStream | null>(null);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequest = useRef<{ text: string; userId?: string } | null>(null);
  function stopVoice() {
    voiceEpoch.current++;
    player.current?.stop();
    setPlaying(null);
  }
  function stopTurn() {
    if (answerRef.current)
      void api(`/turns/${answerRef.current}/cancel`, mutation()).catch(
        () => {},
      );
    abortRef.current?.abort();
    stopVoice();
  }
  function discardRecording() {
    if (recordTimer.current) clearTimeout(recordTimer.current);
    if (recorder.current) {
      recorder.current.onstop = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
    }
    tracks.current?.getTracks().forEach((t) => t.stop());
    tracks.current = null;
    recorder.current = null;
    transcriptionRef.current?.abort();
  }
  useEffect(() => {
    if (!authReady) return;
    const versions = epoch;
    const version = ++versions.current;
    conversationRef.current = null;
    busy.current = false;
    // Reset view when the authenticated account or character changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([{ role: "assistant", content: c.greeting }]);
    setLoading(!!user);
    setError(null);
    setStreaming(false);
    if (user) {
      api<Conversation[]>(
        `/conversations?character_id=${encodeURIComponent(c.id)}`,
      )
        .then(async (list) => {
          const found = initialConversationId
            ? await api<Conversation>(
                `/conversations/${encodeURIComponent(initialConversationId)}`,
              )
            : list.find((x) => x.scene_id === (scene?.id ?? null));
          if (found && found.character_id !== c.id)
            throw new Error("Hội thoại không thuộc nhân vật này.");
          if (found) {
            const saved = await api<ChatMessage[]>(
              `/conversations/${found.id}/messages`,
            );
            if (version !== epoch.current) return;
            conversationRef.current = found.id;
            setMessages(
              saved.length
                ? saved
                : [{ role: "assistant", content: c.greeting }],
            );
            setOlder(saved.length === 100);
          }
        })
        .catch((e) => {
          if (version === epoch.current) setError(e.message);
        })
        .finally(() => {
          if (version === epoch.current) setLoading(false);
        });
      void api<Voice[]>("/voices")
        .then(setVoices)
        .catch(() => {});
      void refreshRecent();
    }
    return () => {
      versions.current++;
      abortRef.current?.abort();
      player.current?.stop();
      discardRecording();
    };
  }, [authReady, user, c.id, c.greeting, scene?.id, initialConversationId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);
  async function conversation() {
    if (conversationRef.current) return conversationRef.current;
    const result = await api<Conversation>(
      "/conversations",
      mutation({ character_id: c.id, scene_id: scene?.id ?? null }),
    );
    conversationRef.current = result.id;
    return result.id;
  }
  async function listen(message: ChatMessage) {
    if (!message.id) return;
    if (playing === message.id) {
      stopVoice();
      return;
    }
    const version = epoch.current;
    stopVoice();
    const voiceVersion = voiceEpoch.current;
    setPlaying(message.id);
    player.current ??= new DialoguePlayer();
    try {
      await player.current.play(message.id, voice || undefined);
    } catch (e) {
      if (voiceVersion === voiceEpoch.current) player.current.stop();
      if (
        version === epoch.current &&
        voiceVersion === voiceEpoch.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(e instanceof Error ? e.message : "Không thể phát giọng đọc.");
    } finally {
      if (version === epoch.current && voiceVersion === voiceEpoch.current)
        setPlaying(null);
    }
  }
  async function send(text: string, retryMessageId?: string) {
    if (!user || busy.current || loading) return;
    const version = epoch.current;
    busy.current = true;
    stopVoice();
    setError(null);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    answerRef.current = null;
    const base = retryMessageId
      ? messages.filter((m) => m.id !== retryMessageId || m.role === "user")
      : [...messages, { role: "user" as const, content: text }];
    setMessages([
      ...base,
      { role: "assistant", content: "", segments: [], status: "generating" },
    ]);
    let current: ChatMessage = {
      role: "assistant",
      content: "",
      segments: [],
      status: "generating",
    };
    let complete = false;
    lastRequest.current = { text, userId: retryMessageId };
    try {
      const id = await conversation();
      if (version !== epoch.current) return;
      await streamTurn(
        id,
        text,
        ({ event, data }) => {
          if (version !== epoch.current) return;
          if (event === "turn.started") {
            answerRef.current = data.id ?? null;
            current = { ...current, id: data.id };
            if (data.user_message) {
              if (!retryMessageId) base[base.length - 1] = data.user_message;
              lastRequest.current = { text, userId: data.user_message.id };
            }
          } else if (event === "segment.completed" && data.segment) {
            current = {
              ...current,
              segments: [...(current.segments ?? []), data.segment],
              content: [current.content, data.segment.text]
                .filter(Boolean)
                .join("\n\n"),
            };
          } else if (
            event === "turn.completed" &&
            typeof data.message === "object"
          ) {
            current = data.message;
            complete = true;
            setMode(data.mode ?? "live");
            if (
              autoPlay &&
              current.segments?.some((s) => s.type === "dialogue")
            )
              void listen(current);
          } else if (event === "turn.failed")
            throw new Error(
              typeof data.message === "string"
                ? data.message
                : "Không thể tạo phản hồi.",
            );
          setMessages([...base, current]);
        },
        ctrl.signal,
        requestId(),
        retryMessageId,
      );
      if (!complete && !ctrl.signal.aborted)
        throw new Error("Phản hồi đã bị gián đoạn. Hãy thử lại.");
      void refreshRecent();
    } catch (e) {
      if (version === epoch.current) {
        setMessages([
          ...base,
          ...(current.content
            ? [{ ...current, status: complete ? "complete" : "interrupted" }]
            : []),
        ]);
        if (!ctrl.signal.aborted)
          setError(e instanceof Error ? e.message : "Không thể tạo phản hồi.");
      }
    } finally {
      if (version === epoch.current) {
        setStreaming(false);
        busy.current = false;
        abortRef.current = null;
        answerRef.current = null;
      }
    }
  }
  function submit() {
    const text = input.trim();
    if (!text || busy.current || loading || !user || recording || transcribing)
      return;
    setInput("");
    void send(text);
  }
  function retry() {
    if (lastRequest.current)
      void send(lastRequest.current.text, lastRequest.current.userId);
  }
  async function reset() {
    stopTurn();
    discardRecording();
    epoch.current++;
    busy.current = false;
    conversationRef.current = null;
    lastRequest.current = null;
    setMessages([greeting]);
    setError(null);
    setStreaming(false);
    setRecording(false);
    setTranscribing(false);
    setOlder(false);
    if (user) {
      setLoading(true);
      try {
        await conversation();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không thể tạo hội thoại.");
      } finally {
        setLoading(false);
      }
    }
    inputRef.current?.focus();
  }
  async function loadOlder() {
    if (!conversationRef.current || !messages[0]?.created_at) return;
    try {
      const list = await api<ChatMessage[]>(
        `/conversations/${conversationRef.current}/messages?before=${messages[0].created_at}`,
      );
      setMessages((old) => [...list, ...old]);
      setOlder(list.length === 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải tin nhắn.");
    }
  }
  async function transcribe(blob: Blob, filename: string) {
    const version = epoch.current;
    const ctrl = new AbortController();
    transcriptionRef.current = ctrl;
    setTranscribing(true);
    setError(null);
    try {
      const result = await transcript(blob, filename, ctrl.signal);
      if (version === epoch.current) {
        setInput((old) => (old ? `${old} ${result.text}` : result.text));
        inputRef.current?.focus();
      }
    } catch (e) {
      if (version === epoch.current && !ctrl.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Không thể nhận dạng lời nói.",
        );
    } finally {
      if (version === epoch.current) setTranscribing(false);
    }
  }
  async function microphone() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    const version = epoch.current;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Trình duyệt chưa hỗ trợ ghi âm. Bạn có thể tải tệp âm thanh lên.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== epoch.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      tracks.current = stream;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onerror = () => {
        discardRecording();
        setRecording(false);
        setError("Ghi âm bị gián đoạn. Hãy thử lại.");
      };
      rec.onstop = () => {
        if (recordTimer.current) clearTimeout(recordTimer.current);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (version === epoch.current)
          void transcribe(
            new Blob(chunks, { type: rec.mimeType }),
            rec.mimeType.includes("mp4") ? "speech.m4a" : "speech.webm",
          );
      };
      rec.start();
      setRecording(true);
      setError(null);
      recordTimer.current = setTimeout(
        () => {
          if (rec.state !== "inactive") rec.stop();
        },
        user?.plan === "premium" ? 120000 : 60000,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể mở microphone.");
    }
  }
  const waitingFirstToken = streaming && messages.at(-1)?.content === "";
  const lumiMood = error
    ? "sad"
    : waitingFirstToken
      ? "think"
      : streaming
        ? "happy"
        : "idle";

  return (
    <div className="relative flex h-[calc(100dvh-57px)] flex-col overflow-hidden lg:h-dvh">
      {/* ambient character-coloured light */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div
          className="absolute -top-40 left-1/2 size-[60rem] -translate-x-1/2 animate-breathe rounded-full blur-[120px]"
          style={{
            background: `radial-gradient(circle, hsl(${c.hue} 90% 55% / 0.22), transparent 60%)`,
          }}
        />
        <div
          className="absolute -bottom-40 -right-20 size-[36rem] animate-aurora rounded-full blur-[110px]"
          style={{
            background: `radial-gradient(circle, hsl(${(c.hue + 60) % 360} 85% 60% / 0.14), transparent 60%)`,
          }}
        />
      </div>

      <header className="glass relative z-10 flex items-center gap-3 border-x-0 border-t-0 px-4 py-3 sm:px-6">
        <Link
          href={`/character/${c.id}`}
          aria-label="Quay lại hồ sơ"
          className="rounded-full p-1.5 text-fg-2 transition-colors hover:bg-white/10 hover:text-fg"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <div className="relative">
          <Portrait
            seed={c.seed ?? c.id}
            hue={c.hue}
            className="size-10 shrink-0 rounded-full"
          />
          <span
            className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-canvas bg-emerald-400"
            aria-hidden="true"
          />
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
              {streaming
                ? "đang trả lời…"
                : scene
                  ? `Cảnh: ${scene.title}`
                  : `Người thực hiện @${c.creator}`}
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
          <RotateCcw
            className="size-4 transition-transform duration-500 group-hover:-rotate-180"
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Cuộc trò chuyện mới</span>
          <span className="sr-only sm:hidden">Cuộc trò chuyện mới</span>
        </motion.button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div
          className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6"
          role="log"
          aria-live="polite"
          aria-label={`Cuộc trò chuyện với ${c.name}`}
        >
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
              <Portrait
                seed={c.seed ?? c.id}
                hue={c.hue}
                className="relative size-24 rounded-full ring-2 ring-white/15"
              />
            </div>
            <p className="mt-1 text-lg font-semibold">{c.name}</p>
            <p className="max-w-md text-sm text-fg-2">{c.tagline}</p>
            {mode === "demo" && (
              <p className="rounded-md bg-accent-bg px-2 py-1 text-xs text-accent">
                Chế độ demo (chưa cấu hình LLM)
              </p>
            )}
          </motion.div>

          {older && (
            <button
              type="button"
              onClick={loadOlder}
              className="text-sm text-accent"
            >
              Tải tin nhắn trước đó
            </button>
          )}
          {loading && (
            <p className="text-center text-sm text-fg-2">Đang tải hội thoại…</p>
          )}
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
                  <Portrait
                    seed={c.seed ?? c.id}
                    hue={c.hue}
                    className="size-8 shrink-0 rounded-full"
                  />
                  <div
                    className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-white/[0.06] px-4 py-3"
                    style={{
                      background: `linear-gradient(135deg, hsl(${c.hue} 35% 20% / 0.9), rgb(44 44 49 / 0.9))`,
                    }}
                    aria-label={`${c.name} đang nhập`}
                  >
                    {[0, 1, 2].map((d) => (
                      <motion.span
                        key={d}
                        className="size-2 rounded-full"
                        style={{ background: `hsl(${c.hue} 90% 75%)` }}
                        animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{
                          duration: 0.9,
                          repeat: Infinity,
                          delay: d * 0.15,
                          ease: "easeInOut",
                        }}
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
                <Portrait
                  seed={c.seed ?? c.id}
                  hue={c.hue}
                  className="size-8 shrink-0 rounded-full"
                />
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium text-fg-2">{c.name}</p>
                  <div
                    className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm border border-white/[0.06] px-4 py-2.5 text-[15px] leading-relaxed shadow-lg shadow-black/20"
                    style={{
                      background: `linear-gradient(135deg, hsl(${c.hue} 30% 19% / 0.92), rgb(40 40 46 / 0.92))`,
                    }}
                  >
                    {m.segments?.length ? (
                      m.segments.map((segment) => (
                        <p
                          key={segment.id}
                          className={
                            segment.type === "narration"
                              ? "my-2 italic text-fg-2"
                              : "my-2"
                          }
                        >
                          {segment.text}
                        </p>
                      ))
                    ) : (
                      <RichText text={m.content} />
                    )}
                    {streaming && isLast && (
                      <span
                        aria-hidden="true"
                        className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-fg-2"
                      />
                    )}
                  </div>
                  {m.id &&
                    m.status === "complete" &&
                    m.segments?.some((s) => s.type === "dialogue") && (
                      <button
                        type="button"
                        onClick={() => void listen(m)}
                        className="mt-2 flex items-center gap-1.5 text-xs text-accent"
                      >
                        <Volume2 className="size-4" />
                        {playing === m.id ? "Dừng giọng đọc" : "Nghe lời thoại"}
                      </button>
                    )}
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
        <div
          className="pointer-events-none absolute -top-14 right-6 hidden sm:block"
          aria-hidden="true"
        >
          <motion.div
            animate={{ y: streaming ? [0, -6, 0] : 0 }}
            transition={{
              duration: 1.2,
              repeat: streaming ? Infinity : 0,
              ease: "easeInOut",
            }}
          >
            <Mascot
              mood={lumiMood}
              className="size-14 drop-shadow-[0_0_18px_rgba(167,139,250,0.55)]"
            />
          </motion.div>
        </div>
        {user ? (
          <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-fg-2">
            <label>
              Giọng{" "}
              <select
                value={voice}
                onChange={(e) => {
                  stopVoice();
                  setVoice(e.target.value);
                }}
                className="ml-2 rounded-lg bg-surface p-1.5"
              >
                <option value="">Theo nhân vật</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoPlay}
                onChange={(e) => {
                  setAutoPlay(e.target.checked);
                  if (!e.target.checked) stopVoice();
                }}
              />
              Tự đọc lời thoại
            </label>
            {playing && (
              <button type="button" onClick={stopVoice} className="text-accent">
                Dừng phát
              </button>
            )}
            {transcribing && (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                Đang chuyển lời nói thành văn bản…
              </span>
            )}
          </div>
        ) : (
          authReady && (
            <p className="mb-3 text-center text-sm">
              <Link
                className="text-accent"
                href={`/login?next=${encodeURIComponent(`/chat/${c.id}`)}`}
              >
                Đăng nhập
              </Link>{" "}
              để trò chuyện và dùng giọng nói.
            </p>
          )
        )}
        <input
          type="file"
          ref={fileRef}
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void transcribe(file, file.name);
            e.target.value = "";
          }}
        />
        <div className="glass flex items-end gap-2 rounded-3xl p-2 pl-4 transition-shadow duration-300 focus-within:border-accent/60 focus-within:shadow-[0_0_0_4px_rgba(138,180,255,0.12),0_0_40px_-8px_rgba(138,180,255,0.5)]">
          <label htmlFor="msg" className="sr-only">
            Nhắn tin cho {c.name}
          </label>
          <textarea
            id="msg"
            ref={inputRef}
            rows={1}
            value={input}
            disabled={!user || loading || transcribing}
            maxLength={4000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`Nhắn tin cho ${c.name}…`}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] placeholder:text-fg-3 focus:outline-none focus-visible:outline-none [field-sizing:content]"
          />
          <button
            type="button"
            disabled={!user || loading || streaming || transcribing}
            onClick={() => void microphone()}
            aria-label={recording ? "Dừng ghi âm" : "Ghi âm"}
            className={`grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-30 ${recording ? "bg-danger text-black animate-pulse" : "hover:bg-white/10"}`}
          >
            <Mic className="size-5" />
          </button>
          <button
            type="button"
            disabled={
              !user || loading || streaming || transcribing || recording
            }
            onClick={() => fileRef.current?.click()}
            aria-label="Tải bản ghi âm"
            className="hidden size-10 shrink-0 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30 sm:grid"
          >
            <Upload className="size-4" />
          </button>
          <AnimatePresence mode="popLayout" initial={false}>
            {streaming ? (
              <motion.button
                key="stop"
                type="button"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                onClick={stopTurn}
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
                disabled={
                  !input.trim() || !user || loading || recording || transcribing
                }
                className="grid size-10 shrink-0 place-items-center rounded-full text-black transition-[background,box-shadow] disabled:bg-surface-2 disabled:text-fg-3"
                style={
                  input.trim()
                    ? {
                        background: `linear-gradient(135deg, hsl(${c.hue} 90% 80%), hsl(${(c.hue + 50) % 360} 85% 68%))`,
                        boxShadow: `0 0 20px -2px hsl(${c.hue} 90% 65% / 0.6)`,
                      }
                    : undefined
                }
              >
                <ArrowUp className="size-5" aria-hidden="true" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <p className="mt-2 text-center text-[11px] text-fg-3">
          Đây là nhân vật AI hư cấu, không phải người thật. Hãy coi mọi điều
          nhân vật nói là hư cấu.
        </p>
      </form>
    </div>
  );
}
