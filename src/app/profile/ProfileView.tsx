"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import {
  CalendarDays,
  Loader2,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Mascot } from "@/components/Mascot";
import { Portrait } from "@/components/Portrait";
import { TiltCard } from "@/components/TiltCard";
import { UserAvatar } from "@/components/UserAvatar";
import { Aurora } from "@/components/fx/Aurora";
import {
  isUsername,
  signOut,
  updateUser,
  useAuthReady,
  useUser,
  type User,
} from "@/lib/auth";
import { type Conversation } from "@/lib/chat/client";
import { api } from "@/lib/api";
import { SecurityPanel } from "@/components/SecurityPanel";
import { categories } from "@/lib/data";
import {
  deleteUserChar,
  resolveCharacter,
  useUserChars,
  type UserCharacter,
} from "@/lib/userCharacters";

const EASE = [0.22, 1, 0.36, 1] as const;
const HUES = [220, 265, 300, 340, 20, 160];

export function ProfileView() {
  const hydrated = useAuthReady();
  const user = useUser();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !user) {
      router.replace("/login?next=/profile");
    }
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <Loader2
          className="size-6 animate-spin text-accent"
          aria-label="Đang tải"
        />
      </div>
    );
  }
  return <Profile key={user.id} user={user} />;
}

function CountUp({ to }: { to: number }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (n) => Math.round(n).toLocaleString("vi-VN"));
  useEffect(() => {
    const c = animate(v, to, { duration: 1.4, ease: EASE });
    return () => c.stop();
  }, [to, v]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

function Profile({ user }: { user: User }) {
  const router = useRouter();
  const mine = useUserChars(user.id);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState({ conversations: 0, sent: 0 });
  const [failure, setFailure] = useState("");
  useEffect(() => {
    let live = true;
    api<Conversation[]>("/conversations")
      .then((list) => {
        if (live) setConversations(list);
      })
      .catch((e) => {
        if (live) setFailure(e.message);
      });
    api<{ conversations: number; sent: number }>("/me/stats")
      .then((value) => {
        if (live) setStats(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user.id]);
  const recent = conversations
    .map((item) => {
      const c = resolveCharacter(item.character_id);
      return c
        ? {
            c,
            last: "Tiếp tục cuộc trò chuyện đã lưu",
            conversationId: item.id,
          }
        : null;
    })
    .filter((x) => x !== null);
  const [tab, setTab] = useState<"chars" | "chats">("chars");
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState<UserCharacter | null>(null);
  const joined = new Date(user.createdAt).toLocaleDateString("vi-VN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="pb-16">
      <div className="mx-auto max-w-5xl p-4">
        <SecurityPanel />
        {failure && (
          <p role="alert" className="mt-3 text-danger">
            {failure}
          </p>
        )}
      </div>
      {/* banner */}
      <section className="relative h-56 overflow-hidden sm:h-64">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, hsl(${user.hue} 60% 22%), #0b0b12 60%, hsl(${(user.hue + 60) % 360} 50% 18%))`,
          }}
        />
        <Aurora hue={user.hue} />
        <div className="grain absolute inset-0" />
        <motion.div
          aria-hidden="true"
          className="absolute right-6 top-8 hidden sm:block lg:right-14"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8, ease: EASE }}
        >
          <Mascot mood="wave" className="size-44 animate-float" />
        </motion.div>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-canvas to-transparent" />
      </section>

      <div className="relative mx-auto -mt-20 max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col gap-5 sm:flex-row sm:items-end"
        >
          <motion.div
            initial={{ scale: 0.6, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 14 }}
          >
            <UserAvatar
              name={user.name}
              hue={user.hue}
              glow
              className="size-32 text-4xl"
            />
          </motion.div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-bold tracking-tight sm:text-4xl">
              {user.name}
            </h1>
            <p className="text-fg-2">@{user.username}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-3">
              <CalendarDays className="size-3.5" aria-hidden="true" /> Tham gia{" "}
              {joined}
            </p>
          </div>
          <div className="flex gap-2">
            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setEditing(true)}
              className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium hover:bg-white/10"
            >
              <Pencil className="size-4" aria-hidden="true" /> Chỉnh sửa
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                void signOut()
                  .then(() => {
                    router.push("/welcome");
                    router.refresh();
                  })
                  .catch((e) => setFailure(e.message));
              }}
              className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-fg-2 hover:bg-white/5 hover:text-fg"
            >
              <LogOut className="size-4" aria-hidden="true" /> Đăng xuất
            </motion.button>
          </div>
        </motion.div>

        {user.bio && (
          <p className="mt-5 max-w-2xl leading-relaxed text-fg-2">{user.bio}</p>
        )}
        {user.interests.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {user.interests.map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-fg-2"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* stats */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          {[
            ["Nhân vật đã tạo", mine.length],
            ["Cuộc trò chuyện", stats.conversations],
            ["Tin nhắn đã gửi", stats.sent],
          ].map(([label, n], i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.5, ease: EASE }}
              className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5"
            >
              <div
                aria-hidden="true"
                className="absolute -right-6 -top-6 size-20 rounded-full blur-2xl"
                style={{
                  background: `hsl(${(user.hue + i * 50) % 360} 90% 60% / 0.35)`,
                }}
              />
              <p className="relative text-2xl font-bold sm:text-4xl">
                <CountUp to={n as number} />
              </p>
              <p className="relative mt-1 text-xs text-fg-2 sm:text-sm">
                {label}
              </p>
            </motion.div>
          ))}
        </div>

        {/* tabs */}
        <div
          role="tablist"
          className="mt-10 flex gap-1 border-b border-white/10"
        >
          {(
            [
              ["chars", `Nhân vật của tôi (${mine.length})`],
              ["chats", `Lịch sử trò chuyện (${recent.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              type="button"
              onClick={() => setTab(k)}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${tab === k ? "text-fg" : "text-fg-3 hover:text-fg-2"}`}
            >
              {label}
              {tab === k && (
                <motion.span
                  layoutId="profile-tab"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-accent via-violet to-pink"
                />
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            role="tabpanel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="pt-6"
          >
            {tab === "chars" ? (
              mine.length === 0 ? (
                <Empty
                  text="Bạn chưa tạo nhân vật nào. PersonaX đang chờ được gặp người bạn đầu tiên của bạn!"
                  cta={{ href: "/create", label: "Tạo nhân vật đầu tiên" }}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Link
                    href="/create"
                    className="group grid min-h-48 place-items-center rounded-3xl border-2 border-dashed border-white/10 text-fg-2 transition-colors hover:border-accent/50 hover:text-fg"
                  >
                    <span className="flex flex-col items-center gap-2">
                      <motion.span
                        whileHover={{ rotate: 90 }}
                        className="grid size-12 place-items-center rounded-full bg-white/5 group-hover:bg-accent/20"
                      >
                        <Plus className="size-6" aria-hidden="true" />
                      </motion.span>
                      Tạo nhân vật mới
                    </span>
                  </Link>
                  <AnimatePresence>
                    {mine.map((c, i) => (
                      <motion.div
                        key={c.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8, filter: "blur(8px)" }}
                        transition={{
                          delay: Math.min(i * 0.05, 0.3),
                          duration: 0.4,
                          ease: EASE,
                        }}
                      >
                        <MyCharCard c={c} onDelete={() => setConfirmDel(c)} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )
            ) : recent.length === 0 ? (
              <Empty
                text="Chưa có cuộc trò chuyện nào. Chọn một nhân vật và nói lời chào nhé!"
                cta={{ href: "/", label: "Khám phá nhân vật" }}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {recent.map(({ c, last, conversationId }, i) => (
                  <motion.li
                    key={conversationId}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: Math.min(i * 0.05, 0.35),
                      duration: 0.4,
                      ease: EASE,
                    }}
                  >
                    <Link
                      href={`/chat/${c.id}?conversation=${conversationId}`}
                      className="group flex items-center gap-4 rounded-2xl p-3 transition-colors hover:bg-white/[0.05]"
                    >
                      <div
                        className="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-white/10 transition-transform group-hover:scale-105"
                        style={{
                          boxShadow: `0 0 24px -4px hsl(${c.hue} 90% 60% / 0.6)`,
                        }}
                      >
                        <Portrait
                          seed={c.seed ?? c.id}
                          hue={c.hue}
                          className="size-full"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{c.name}</p>
                        <p className="truncate text-sm text-fg-2">
                          {last.replace(/\*/g, "")}
                        </p>
                      </div>
                    </Link>
                  </motion.li>
                ))}
              </ul>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {editing && <EditModal user={user} onClose={() => setEditing(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {confirmDel && (
          <Modal onClose={() => setConfirmDel(null)} title="Xoá nhân vật?">
            <div className="flex flex-col items-center gap-3 text-center">
              <Mascot mood="sad" className="size-28" />
              <p className="text-fg-2">
                <strong className="text-fg">{confirmDel.name}</strong> và toàn
                bộ lịch sử trò chuyện sẽ biến mất khỏi trình duyệt này. Không
                thể hoàn tác.
              </p>
              <div className="mt-2 flex w-full gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDel(null)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm font-medium hover:bg-white/5"
                >
                  Giữ lại
                </button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={async () => {
                    try {
                      await deleteUserChar(confirmDel.id);
                      setConfirmDel(null);
                    } catch (e) {
                      setFailure(
                        e instanceof Error
                          ? e.message
                          : "Không thể xóa nhân vật.",
                      );
                    }
                  }}
                  className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-black"
                >
                  Xoá vĩnh viễn
                </motion.button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function MyCharCard({
  c,
  onDelete,
}: {
  c: UserCharacter;
  onDelete: () => void;
}) {
  return (
    <TiltCard hue={c.hue} max={8}>
      <div
        className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 p-4"
        style={{
          background: `linear-gradient(160deg, hsl(${c.hue} 40% 17%), #121218 75%)`,
        }}
      >
        <Link href={`/character/${c.id}`} className="flex gap-3">
          <div
            className="size-16 shrink-0 overflow-hidden rounded-2xl"
            style={{ boxShadow: `0 8px 24px -6px hsl(${c.hue} 90% 55% / 0.6)` }}
          >
            <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-full" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{c.name}</h3>
            <p className="line-clamp-2 text-[13px] text-fg-2">{c.tagline}</p>
          </div>
        </Link>
        <div className="mt-3 flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="mt-4 flex gap-2 pt-1">
          <Link
            href={`/chat/${c.id}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/90 py-2 text-sm font-semibold text-black transition-colors hover:bg-white"
          >
            <MessageCircle className="size-4" aria-hidden="true" /> Trò chuyện
          </Link>
          <Link
            href={`/create?edit=${c.id}`}
            aria-label={`Sửa ${c.name}`}
            className="grid size-9 place-items-center rounded-xl border border-white/10 hover:bg-white/10"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Xoá ${c.name}`}
            className="grid size-9 place-items-center rounded-xl border border-white/10 text-fg-2 hover:border-danger/50 hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </TiltCard>
  );
}

function Empty({
  text,
  cta,
}: {
  text: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <Mascot mood="peek" className="size-36 animate-float" />
      <p className="max-w-sm text-fg-2">{text}</p>
      <Link
        href={cta.href}
        className="btn-glow flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
      >
        <Sparkles className="size-4" aria-hidden="true" /> {cta.label}
      </Link>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="glass ring-conic relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="grid size-8 place-items-center rounded-full hover:bg-white/10"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function EditModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio);
  const [hue, setHue] = useState(user.hue);
  const [interests, setInterests] = useState(user.interests);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setErr("Tên cần ít nhất 2 ký tự.");
    if (!isUsername(username))
      return setErr("Tên người dùng: 3–20 ký tự a-z, 0-9, _ hoặc .");
    try {
      await updateUser({
        name: name.trim(),
        username,
        bio: bio.trim().slice(0, 200),
        hue,
        interests,
      });
      setSaved(true);
      setTimeout(onClose, 700);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Không lưu được.");
    }
  };

  return (
    <Modal title="Chỉnh sửa hồ sơ" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex justify-center">
          <motion.div
            key={hue + name}
            initial={{ scale: 0.85 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
          >
            <UserAvatar
              name={name || "?"}
              hue={hue}
              glow
              className="size-20 text-2xl"
            />
          </motion.div>
        </div>
        <div
          className="flex justify-center gap-2"
          role="radiogroup"
          aria-label="Màu hồ sơ"
        >
          {HUES.map((h) => (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={hue === h}
              aria-label={`Màu ${h}`}
              onClick={() => setHue(h)}
              className="relative size-8 rounded-full"
              style={{
                background: `linear-gradient(135deg, hsl(${h} 90% 78%), hsl(${(h + 50) % 360} 85% 62%))`,
              }}
            >
              {hue === h && (
                <motion.span
                  layoutId="edit-hue"
                  className="absolute -inset-1 rounded-full ring-2 ring-white"
                />
              )}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg-2">
          Tên hiển thị
          <input
            className="field"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg-2">
          Tên người dùng
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-fg-3">
              @
            </span>
            <input
              className="field pl-8"
              value={username}
              maxLength={20}
              onChange={(e) =>
                setUsername(
                  e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""),
                )
              }
            />
          </div>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg-2">
          <span className="flex justify-between">
            Giới thiệu{" "}
            <span className="text-xs text-fg-3">{bio.length}/200</span>
          </span>
          <textarea
            className="field resize-none"
            rows={3}
            maxLength={200}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Vài dòng về bạn…"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((t) => {
            const on = interests.includes(t);
            return (
              <motion.button
                key={t}
                type="button"
                aria-pressed={on}
                whileTap={{ scale: 0.92 }}
                onClick={() =>
                  setInterests(
                    on ? interests.filter((x) => x !== t) : [...interests, t],
                  )
                }
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-accent/60 bg-accent/20" : "border-white/10 text-fg-2"}`}
              >
                {t}
              </motion.button>
            );
          })}
        </div>
        {err && <p className="text-sm text-danger">{err}</p>}
        <motion.button
          type="submit"
          whileTap={{ scale: 0.97 }}
          className="btn-glow flex items-center justify-center gap-2 rounded-xl py-3 font-semibold"
        >
          {saved ? "Đã lưu ✨" : "Lưu thay đổi"}
        </motion.button>
      </form>
    </Modal>
  );
}
