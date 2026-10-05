"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Dice5,
  Feather,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Send,
  Sparkles,
  Tags,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { Mascot } from "@/components/Mascot";
import { Portrait } from "@/components/Portrait";
import { RichText } from "@/components/RichText";
import { TiltCard } from "@/components/TiltCard";
import { useAuthReady, useUser, type User } from "@/lib/auth";
import { streamReply, type ChatMessage } from "@/lib/chat/client";
import { fireworks } from "@/lib/confetti";
import { categories, type Character } from "@/lib/data";
import { readJSON, removeKey, writeJSON } from "@/lib/store";
import {
  LIMITS,
  getUserChar,
  useUserChars,
  useCharactersReady,
  markNew,
  newCharId,
  randomSeed,
  saveUserChar,
  type UserCharacter,
} from "@/lib/userCharacters";

const EASE = [0.22, 1, 0.36, 1] as const;

type Draft = {
  name: string;
  tagline: string;
  description: string;
  persona: string;
  greeting: string;
  tags: string[];
  hue: number;
  seed: string;
};
type TextKey = "name" | "tagline" | "description" | "persona" | "greeting";

const STEPS = [
  { label: "Danh tính", icon: UserRound },
  { label: "Tính cách", icon: Feather },
  { label: "Lời chào", icon: MessageCircle },
  { label: "Hoàn thiện", icon: Tags },
] as const;
const STEP_OF: Record<string, number> = {
  name: 0,
  tagline: 0,
  description: 1,
  persona: 1,
  greeting: 2,
  tags: 3,
};

const TRAITS: [string, string][] = [
  ["Ấm áp", "Luôn ấm áp, lắng nghe và an ủi người đối diện."],
  ["Hài hước", "Hay pha trò, thích chơi chữ và trêu nhẹ nhàng."],
  ["Bí ẩn", "Nói ít, hay úp mở, luôn giữ lại một bí mật."],
  ["Lạnh lùng", "Bề ngoài lạnh lùng, cộc lốc nhưng thật ra rất quan tâm."],
  [
    "Nhiệt huyết",
    "Tràn đầy năng lượng, hay dùng dấu chấm than và rủ rê phiêu lưu.",
  ],
  ["Thông thái", "Uyên bác, thích giải thích bằng ẩn dụ và câu chuyện cổ."],
  ["Tinh nghịch", "Tinh nghịch, tò mò, hay hỏi ngược lại người dùng."],
  ["Kiệm lời", "Trả lời ngắn gọn, mỗi câu đều có sức nặng."],
];

const LABEL: Record<TextKey | "tags", string> = {
  name: "Tên",
  tagline: "Câu giới thiệu",
  description: "Mô tả",
  persona: "Tính cách",
  greeting: "Lời chào",
  tags: "Thể loại",
};

function blank(): Draft {
  return {
    name: "",
    tagline: "",
    description: "",
    persona: "",
    greeting: "",
    tags: [],
    hue: [220, 265, 300, 340, 20, 160][Math.floor(Math.random() * 6)],
    seed: randomSeed(),
  };
}

function validate(d: Draft) {
  const e: Partial<Record<TextKey | "tags", string>> = {};
  (["name", "tagline", "description", "persona", "greeting"] as const).forEach(
    (k) => {
      const n = d[k].trim().length;
      const [min, max] = LIMITS[k];
      if (n < min) e[k] = `${LABEL[k]} cần ít nhất ${min} ký tự (hiện ${n}).`;
      else if (n > max) e[k] = `${LABEL[k]} tối đa ${max} ký tự.`;
    },
  );
  if (d.tags.length < LIMITS.tags[0]) e.tags = "Chọn ít nhất 1 thể loại.";
  if (d.tags.length > LIMITS.tags[1])
    e.tags = `Tối đa ${LIMITS.tags[1]} thể loại.`;
  return e;
}

function asCharacter(d: Draft, id: string, creator: string): Character {
  return {
    id,
    name: d.name.trim(),
    creator,
    tagline: d.tagline.trim(),
    description: d.description.trim(),
    persona: d.persona.trim(),
    greeting: d.greeting.trim(),
    tags: d.tags,
    chats: 0,
    hue: d.hue,
    seed: d.seed,
  };
}

export function CharacterEditor({ editId }: { editId?: string }) {
  const hydrated = useAuthReady();
  useUserChars();
  const charsReady = useCharactersReady();
  const user = useUser();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !user) {
      router.replace(
        `/login?next=${encodeURIComponent(editId ? `/create?edit=${editId}` : "/create")}`,
      );
    }
  }, [hydrated, user, router, editId]);

  if (!hydrated || !user || !charsReady) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <Loader2
          className="size-6 animate-spin text-accent"
          aria-label="Đang tải"
        />
      </div>
    );
  }

  const existing = editId ? getUserChar(editId) : undefined;
  if (editId && (!existing || existing.owner !== user.id)) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
        <Mascot mood="sad" className="size-40" />
        <h1 className="text-xl font-bold">Không tìm thấy nhân vật để sửa</h1>
        <p className="text-sm text-fg-2">
          Nhân vật này không tồn tại hoặc không thuộc về bạn.
        </p>
        <Link
          href="/create"
          className="btn-glow rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          Tạo nhân vật mới
        </Link>
      </div>
    );
  }
  return (
    <Editor
      key={`${user.id}:${existing?.id ?? "new"}`}
      user={user}
      existing={existing}
    />
  );
}

function Editor({ user, existing }: { user: User; existing?: UserCharacter }) {
  const DRAFT = `lumi:draft:${user.id}`;
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? {
          name: existing.name,
          tagline: existing.tagline,
          description: existing.description,
          persona: existing.persona,
          greeting: existing.greeting,
          tags: existing.tags,
          hue: existing.hue,
          seed: existing.seed ?? existing.id,
        }
      : { ...blank(), ...readJSON<Partial<Draft>>(DRAFT, {}) },
  );
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [errors, setErrors] = useState<
    Partial<Record<TextKey | "tags", string>>
  >({});
  const [shake, setShake] = useState(0);
  const [born, setBorn] = useState<Character | null>(null);
  const [tryOpen, setTryOpen] = useState(false);
  const [customTag, setCustomTag] = useState("");
  const [saveError, setSaveError] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">(
    existing?.visibility ?? "private",
  );
  const [voiceId, setVoiceId] = useState(existing?.voice_id ?? "kore-warm");

  const previewId = existing?.id ?? "u-preview";
  const preview = asCharacter(draft, previewId, user.username);

  // Autosave new drafts so a refresh never loses work.
  useEffect(() => {
    if (!existing) writeJSON(DRAFT, draft);
  }, [draft, existing, DRAFT]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k as TextKey]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setStep(to);
  };

  const next = () => {
    const e = validate(draft);
    const here = Object.fromEntries(
      Object.entries(e).filter(([k]) => STEP_OF[k] === step),
    );
    if (Object.keys(here).length) {
      setErrors(here);
      setShake((s) => s + 1);
      return;
    }
    setErrors({});
    go(step + 1);
  };

  const save = async () => {
    const e = validate(draft);
    if (Object.keys(e).length) {
      setErrors(e);
      setShake((s) => s + 1);
      go(Math.min(...Object.keys(e).map((k) => STEP_OF[k])));
      return;
    }
    const now = Date.now();
    const id = existing?.id ?? newCharId();
    const c: UserCharacter = {
      ...asCharacter(draft, id, user.username),
      chats: existing?.chats ?? 0,
      owner: user.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    let saved: UserCharacter;
    try {
      saved = await saveUserChar({ ...c, visibility, voice_id: voiceId });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể lưu.");
      return;
    }
    if (!existing) {
      removeKey(DRAFT);
      markNew(saved.id);
    }
    setBorn(saved);
    fireworks(2200);
    setTimeout(() => router.push(`/character/${saved.id}`), 2600);
  };

  const errorFor = (k: TextKey | "tags") => errors[k];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10">
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mb-6 flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-accent">
            <WandSparkles className="size-4" aria-hidden="true" /> Xưởng nhân
            vật
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            {existing ? "Chỉnh sửa " : "Thổi hồn cho "}
            <span className="text-gradient">
              {existing ? existing.name : "nhân vật mới"}
            </span>
          </h1>
        </div>
        {!existing && (
          <button
            type="button"
            onClick={() => {
              setDraft(blank());
              setErrors({});
              go(0);
            }}
            className="rounded-full px-3 py-1.5 text-sm text-fg-3 transition-colors hover:bg-white/5 hover:text-fg"
          >
            Làm lại từ đầu
          </button>
        )}
      </motion.header>

      <div className="glass mb-6 flex flex-wrap gap-5 rounded-2xl p-4">
        <label className="text-sm">
          Hiển thị{" "}
          <select
            className="ml-2 rounded-lg bg-surface p-2"
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as "private" | "public")
            }
          >
            <option value="private">Riêng tư</option>
            <option value="public">Công khai (chờ duyệt)</option>
          </select>
        </label>
        <label className="text-sm">
          Giọng đọc{" "}
          <select
            className="ml-2 rounded-lg bg-surface p-2"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
          >
            <option value="kore-warm">Kore · ấm áp</option>
            <option value="puck-playful">Puck · vui tươi</option>
            <option value="kore-moe">Kore · mềm mại</option>
          </select>
        </label>
        {saveError && (
          <p role="alert" className="w-full text-danger">
            {saveError}
          </p>
        )}
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* ------- form ------- */}
        <div className="min-w-0">
          <ol className="mb-5 grid grid-cols-4 gap-2" aria-label="Các bước">
            {STEPS.map(({ label, icon: Icon }, i) => {
              const bad = Object.keys(errors).some(
                (k) => STEP_OF[k] === i && errors[k as TextKey],
              );
              return (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === step ? "step" : undefined}
                    className={`relative flex w-full flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-xs font-medium transition-colors sm:flex-row sm:justify-center sm:text-sm ${
                      i === step ? "text-fg" : "text-fg-3 hover:text-fg-2"
                    }`}
                  >
                    {i === step && (
                      <motion.span
                        layoutId="step-bg"
                        className="glass absolute inset-0 rounded-2xl"
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 32,
                        }}
                      />
                    )}
                    <span
                      className={`relative grid size-7 place-items-center rounded-full ${
                        bad
                          ? "bg-danger/20 text-danger"
                          : i < step
                            ? "bg-accent/20 text-accent"
                            : i === step
                              ? "bg-gradient-to-br from-accent to-violet text-black"
                              : "bg-white/5"
                      }`}
                    >
                      {i < step && !bad ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Icon className="size-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="relative">{label}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <motion.div
            key={shake}
            animate={shake ? { x: [0, -10, 9, -6, 4, 0] } : undefined}
            transition={{ duration: 0.4 }}
            className="glass relative overflow-hidden rounded-3xl p-5 sm:p-7"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: dir * 36, filter: "blur(6px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: dir * -36, filter: "blur(6px)" }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex flex-col gap-5"
              >
                {step === 0 && (
                  <>
                    <Field
                      k="name"
                      value={draft.name}
                      error={errorFor("name")}
                      onChange={(v) => set("name", v)}
                      placeholder="VD: Hạ Vy"
                    />
                    <Field
                      k="tagline"
                      value={draft.tagline}
                      error={errorFor("tagline")}
                      onChange={(v) => set("tagline", v)}
                      placeholder="VD: Người giữ đèn hải đăng cuối cùng"
                    />
                    <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
                      <div className="relative mx-auto size-28 overflow-hidden rounded-2xl ring-1 ring-white/10 sm:mx-0">
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.div
                            key={draft.seed + draft.hue}
                            initial={{ rotateY: 90, opacity: 0 }}
                            animate={{ rotateY: 0, opacity: 1 }}
                            exit={{ rotateY: -90, opacity: 0 }}
                            transition={{ duration: 0.35, ease: EASE }}
                            className="size-full"
                          >
                            <Portrait
                              seed={draft.seed}
                              hue={draft.hue}
                              className="size-full"
                            />
                          </motion.div>
                        </AnimatePresence>
                      </div>
                      <div className="flex flex-col gap-3">
                        <label className="flex flex-col gap-2">
                          <span className="text-sm font-medium text-fg-2">
                            Sắc màu linh hồn
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={359}
                            value={draft.hue}
                            onChange={(e) => set("hue", Number(e.target.value))}
                            className="h-2 w-full cursor-pointer appearance-none rounded-full accent-white"
                            style={{
                              background:
                                "linear-gradient(90deg, hsl(0 80% 60%), hsl(60 80% 60%), hsl(120 80% 55%), hsl(180 80% 55%), hsl(240 80% 65%), hsl(300 80% 65%), hsl(359 80% 60%))",
                            }}
                          />
                        </label>
                        <motion.button
                          type="button"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.95, rotate: -8 }}
                          onClick={() => set("seed", randomSeed())}
                          className="flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10"
                        >
                          <Dice5
                            className="size-4 text-accent"
                            aria-hidden="true"
                          />{" "}
                          Đổi gương mặt
                        </motion.button>
                      </div>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <Field
                      k="description"
                      multiline
                      rows={4}
                      value={draft.description}
                      error={errorFor("description")}
                      onChange={(v) => set("description", v)}
                      placeholder="Nhân vật là ai, sống ở đâu, đang theo đuổi điều gì?"
                    />
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-fg-2">
                        Thêm nét tính cách nhanh
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {TRAITS.map(([t, phrase]) => {
                          const on = draft.persona.includes(phrase);
                          return (
                            <motion.button
                              key={t}
                              type="button"
                              aria-pressed={on}
                              whileHover={{ y: -2 }}
                              whileTap={{ scale: 0.92 }}
                              onClick={() =>
                                set(
                                  "persona",
                                  on
                                    ? draft.persona
                                        .replace(phrase, "")
                                        .replace(/\s{2,}/g, " ")
                                        .trim()
                                    : `${draft.persona.trim()} ${phrase}`
                                        .trim()
                                        .slice(0, LIMITS.persona[1]),
                                )
                              }
                              className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                                on
                                  ? "border-violet/60 bg-violet/20 text-fg"
                                  : "border-white/10 bg-white/[0.03] text-fg-2 hover:text-fg"
                              }`}
                            >
                              {on ? "✓ " : "+ "}
                              {t}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                    <Field
                      k="persona"
                      multiline
                      rows={6}
                      value={draft.persona}
                      error={errorFor("persona")}
                      onChange={(v) => set("persona", v)}
                      placeholder="Cách nói chuyện, điều nhân vật yêu/ghét, giới hạn… (AI sẽ nhập vai theo đoạn này)"
                    />
                  </>
                )}

                {step === 2 && (
                  <>
                    <Field
                      k="greeting"
                      multiline
                      rows={6}
                      value={draft.greeting}
                      error={errorFor("greeting")}
                      onChange={(v) => set("greeting", v)}
                      placeholder="*ngẩng lên từ cuốn sổ* Ồ, có khách à? …"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        "*mỉm cười*",
                        "*nghiêng đầu*",
                        "*khẽ thở dài*",
                        "*ánh mắt lấp lánh*",
                      ].map((a) => (
                        <motion.button
                          key={a}
                          type="button"
                          whileTap={{ scale: 0.92 }}
                          onClick={() =>
                            set(
                              "greeting",
                              `${draft.greeting}${draft.greeting && !draft.greeting.endsWith(" ") ? " " : ""}${a} `.slice(
                                0,
                                LIMITS.greeting[1],
                              ),
                            )
                          }
                          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[13px] italic text-fg-2 transition-colors hover:text-fg"
                        >
                          {a}
                        </motion.button>
                      ))}
                    </div>
                    <div className="flex items-start gap-3 rounded-2xl bg-accent/[0.07] p-3">
                      <Mascot mood="idle" className="size-12 shrink-0" />
                      <p className="text-[13px] leading-relaxed text-fg-2">
                        Mẹo của PersonaX: đặt hành động trong{" "}
                        <em className="text-fg">*dấu sao*</em> và kết thúc bằng
                        một câu hỏi — người chat sẽ biết ngay nên trả lời gì!
                      </p>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div className="flex flex-col gap-2">
                      <span className="flex items-center justify-between text-sm font-medium text-fg-2">
                        <span>Thể loại (1–4)</span>
                        <span className="text-xs text-fg-3">
                          {draft.tags.length}/4
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {Array.from(
                          new Set([...categories, ...draft.tags]),
                        ).map((t) => {
                          const on = draft.tags.includes(t);
                          return (
                            <motion.button
                              key={t}
                              type="button"
                              aria-pressed={on}
                              whileHover={{ y: -2 }}
                              whileTap={{ scale: 0.92 }}
                              disabled={!on && draft.tags.length >= 4}
                              onClick={() =>
                                set(
                                  "tags",
                                  on
                                    ? draft.tags.filter((x) => x !== t)
                                    : [...draft.tags, t],
                                )
                              }
                              className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                                on
                                  ? "border-accent/60 bg-accent/20 text-fg"
                                  : "border-white/10 bg-white/[0.03] text-fg-2 hover:text-fg"
                              }`}
                            >
                              {t}
                            </motion.button>
                          );
                        })}
                      </div>
                      <form
                        className="mt-1 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const t = customTag.trim().slice(0, 24);
                          if (
                            !t ||
                            draft.tags.includes(t) ||
                            draft.tags.length >= 4
                          )
                            return;
                          set("tags", [...draft.tags, t]);
                          setCustomTag("");
                        }}
                      >
                        <input
                          className="field py-2 text-sm"
                          placeholder="Thêm thể loại riêng…"
                          maxLength={24}
                          value={customTag}
                          onChange={(e) => setCustomTag(e.target.value)}
                          aria-label="Thể loại riêng"
                        />
                        <button
                          type="submit"
                          className="rounded-xl border border-white/10 px-4 text-sm font-medium hover:bg-white/5"
                        >
                          Thêm
                        </button>
                      </form>
                      {errorFor("tags") && (
                        <p className="text-sm text-danger">
                          {errorFor("tags")}
                        </p>
                      )}
                    </div>
                    <Checklist draft={draft} onJump={go} />
                  </>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-7 flex gap-3">
              {step > 0 && (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => go(step - 1)}
                  className="flex items-center gap-1.5 rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium transition-colors hover:bg-white/5"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" /> Quay lại
                </motion.button>
              )}
              {step < 3 ? (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={next}
                  className="ml-auto flex items-center gap-2 rounded-2xl bg-white/90 px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white"
                >
                  Tiếp theo <ArrowRight className="size-4" aria-hidden="true" />
                </motion.button>
              ) : (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={save}
                  className="btn-glow ml-auto flex items-center gap-2 rounded-2xl px-6 py-3 font-semibold"
                >
                  <Sparkles className="size-4" aria-hidden="true" />{" "}
                  {existing ? "Lưu thay đổi" : "Cho nhân vật ra đời"}
                </motion.button>
              )}
            </div>
          </motion.div>
        </div>

        {/* ------- live preview ------- */}
        <aside
          className="lg:sticky lg:top-6 lg:self-start"
          aria-label="Xem trước"
        >
          <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-3">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />{" "}
            Xem trước trực tiếp
          </p>
          <PreviewCard c={preview} />
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setTryOpen((v) => !v)}
            aria-expanded={tryOpen}
            className="glass mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
          >
            <MessagesSquare className="size-4 text-accent" aria-hidden="true" />
            {tryOpen ? "Đóng thử trò chuyện" : "Thử trò chuyện ngay"}
          </motion.button>
          <AnimatePresence>
            {tryOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="overflow-hidden"
              >
                <TryChat c={preview} />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>

      <AnimatePresence>
        {born && <BirthOverlay c={born} edited={!!existing} />}
      </AnimatePresence>
    </div>
  );
}

function Field({
  k,
  value,
  onChange,
  error,
  placeholder,
  multiline,
  rows,
}: {
  k: TextKey;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const [min, max] = LIMITS[k];
  const n = value.trim().length;
  const id = `f-${k}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center justify-between text-sm font-medium text-fg-2"
      >
        <span>{LABEL[k]}</span>
        <span
          className={`text-xs tabular-nums ${n < min ? "text-fg-3" : n > max * 0.9 ? "text-amber-300" : "text-accent"}`}
        >
          {n}/{max}
        </span>
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={rows}
          maxLength={max}
          value={value}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="field resize-y leading-relaxed"
        />
      ) : (
        <input
          id={id}
          maxLength={max}
          value={value}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="field"
        />
      )}
      <AnimatePresence>
        {error && (
          <motion.p
            id={`${id}-err`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-sm text-danger"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Checklist({
  draft,
  onJump,
}: {
  draft: Draft;
  onJump: (s: number) => void;
}) {
  const e = validate(draft);
  const items: [string, number, boolean][] = [
    ["Tên & câu giới thiệu", 0, !e.name && !e.tagline],
    ["Mô tả & tính cách", 1, !e.description && !e.persona],
    ["Lời chào mở đầu", 2, !e.greeting],
    ["Thể loại", 3, !e.tags],
  ];
  return (
    <ul className="flex flex-col gap-2 rounded-2xl bg-black/20 p-4">
      {items.map(([label, s, ok]) => (
        <li key={label}>
          <button
            type="button"
            onClick={() => onJump(s)}
            className="flex w-full items-center gap-3 text-left text-sm"
          >
            <motion.span
              animate={{ scale: ok ? [1, 1.3, 1] : 1 }}
              className={`grid size-5 place-items-center rounded-full ${ok ? "bg-emerald-400/20 text-emerald-300" : "bg-white/5 text-fg-3"}`}
            >
              {ok ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <X className="size-3" aria-hidden="true" />
              )}
            </motion.span>
            <span className={ok ? "text-fg" : "text-fg-3"}>{label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PreviewCard({ c }: { c: Character }) {
  return (
    <TiltCard hue={c.hue} max={8}>
      <div
        className="relative overflow-hidden rounded-3xl border border-white/10 p-5"
        style={{
          background: `linear-gradient(160deg, hsl(${c.hue} 45% 18%), #121218 70%)`,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute -right-16 -top-16 size-56 rounded-full blur-3xl"
          style={{ background: `hsl(${c.hue} 90% 60% / 0.35)` }}
        />
        <div className="relative flex gap-4">
          <motion.div
            layout
            className="size-24 shrink-0 overflow-hidden rounded-2xl ring-2 ring-white/10"
            style={{
              boxShadow: `0 12px 40px -8px hsl(${c.hue} 90% 55% / 0.6)`,
            }}
          >
            <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-full" />
          </motion.div>
          <div className="min-w-0 flex-1">
            <h2
              className={`truncate text-xl font-bold ${c.name ? "" : "text-fg-3"}`}
            >
              {c.name || "Tên nhân vật"}
            </h2>
            <p className="text-xs text-fg-2">bởi @{c.creator}</p>
            <p
              className={`mt-2 line-clamp-2 text-sm ${c.tagline ? "" : "text-fg-3"}`}
            >
              {c.tagline || "Một câu giới thiệu thật cuốn…"}
            </p>
          </div>
        </div>
        <div className="relative mt-4 flex min-h-6 flex-wrap gap-1.5">
          <AnimatePresence>
            {c.tags.map((t) => (
              <motion.span
                key={t}
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium"
              >
                {t}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        <div className="relative mt-4 max-h-40 overflow-y-auto rounded-2xl rounded-tl-sm bg-black/30 p-3.5 text-sm leading-relaxed">
          {c.greeting ? (
            <RichText text={c.greeting} />
          ) : (
            <span className="text-fg-3">Lời chào sẽ hiện ở đây…</span>
          )}
        </div>
      </div>
    </TiltCard>
  );
}

function TryChat({ c }: { c: Character }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const ready =
    c.name.length > 0 && c.persona.length > 0 && c.greeting.length > 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !ready) return;
    const history: ChatMessage[] = [
      { role: "assistant", content: c.greeting },
      ...messages,
      { role: "user", content: text },
    ];
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);
    setErr(null);
    try {
      await streamReply(
        { characterId: c.id, character: c, messages: history },
        (chunk) =>
          setMessages((m) => {
            const copy = m.slice();
            copy[copy.length - 1] = {
              role: "assistant",
              content: copy[copy.length - 1].content + chunk,
            };
            return copy;
          }),
      );
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Không gửi được.");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass mt-3 flex flex-col rounded-2xl p-3">
      {!ready ? (
        <div className="flex items-center gap-3 p-2 text-sm text-fg-2">
          <Mascot mood="think" className="size-12 shrink-0" />
          Điền tên, tính cách và lời chào để thử trò chuyện nhé.
        </div>
      ) : (
        <>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto p-1 text-sm">
            <Bubble role="assistant" text={c.greeting} hue={c.hue} />
            {messages.map((m, i) =>
              m.role === "assistant" && !m.content ? (
                <div key={i} className="flex items-center gap-2 text-fg-3">
                  <Mascot mood="think" className="size-8" /> đang nghĩ…
                </div>
              ) : (
                <Bubble key={i} role={m.role} text={m.content} hue={c.hue} />
              ),
            )}
            <div ref={endRef} />
          </div>
          {err && <p className="px-1 text-xs text-danger">{err}</p>}
          <form onSubmit={send} className="mt-2 flex gap-2">
            <input
              className="field py-2 text-sm"
              placeholder={`Nhắn cho ${c.name}…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Tin nhắn thử"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.9 }}
              disabled={busy || !input.trim()}
              aria-label="Gửi"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-black disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </motion.button>
          </form>
        </>
      )}
    </div>
  );
}

function Bubble({
  role,
  text,
  hue,
}: {
  role: ChatMessage["role"];
  text: string;
  hue: number;
}) {
  const mine = role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 leading-relaxed ${
        mine
          ? "self-end rounded-tr-sm bg-user-bubble"
          : "self-start rounded-tl-sm"
      }`}
      style={mine ? undefined : { background: `hsl(${hue} 40% 20% / 0.8)` }}
    >
      <RichText text={text} />
    </motion.div>
  );
}

function BirthOverlay({ c, edited }: { c: Character; edited: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-md"
      role="status"
      aria-live="assertive"
    >
      <motion.div
        aria-hidden="true"
        className="absolute size-[60vmax] rounded-full"
        style={{
          background: `radial-gradient(circle, hsl(${c.hue} 95% 70% / 0.5), transparent 60%)`,
        }}
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.4, 1] }}
        transition={{ duration: 1.4, ease: EASE }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute size-40 rounded-full border-2 border-white/60"
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: 8, opacity: 0 }}
        transition={{ duration: 1.2, ease: "easeOut", delay: 0.2 }}
      />
      <div className="relative flex flex-col items-center gap-6 px-6 text-center">
        <motion.div
          initial={{ scale: 0.2, rotateY: 180, opacity: 0 }}
          animate={{ scale: 1, rotateY: 0, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 120,
            damping: 14,
            delay: 0.25,
          }}
          style={{ perspective: 800 }}
          className="w-72"
        >
          <div
            className="overflow-hidden rounded-3xl border border-white/20 p-4"
            style={{
              background: `linear-gradient(160deg, hsl(${c.hue} 50% 22%), #111117)`,
              boxShadow: `0 0 80px 10px hsl(${c.hue} 95% 60% / 0.5)`,
            }}
          >
            <Portrait
              seed={c.seed ?? c.id}
              hue={c.hue}
              className="aspect-square w-full rounded-2xl"
            />
            <p className="mt-3 text-lg font-bold">{c.name}</p>
            <p className="line-clamp-2 text-sm text-fg-2">{c.tagline}</p>
          </div>
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.8, duration: 0.6, ease: EASE }}
          className="text-3xl font-bold sm:text-4xl"
        >
          {edited ? (
            <>
              Đã cập nhật <span className="text-gradient">linh hồn</span> ✨
            </>
          ) : (
            <>
              Nhân vật đã <span className="text-gradient">ra đời</span> ✨
            </>
          )}
        </motion.p>
      </div>
    </motion.div>
  );
}
