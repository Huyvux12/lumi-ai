"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Compass, Eye, EyeOff, Loader2, Plus, Sparkles } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import type { MascotMood } from "@/components/Mascot";
import { UserAvatar } from "@/components/UserAvatar";
import { emailTaken, isEmail, isUsername, signUp, usernameTaken } from "@/lib/auth";
import { fireworks } from "@/lib/confetti";
import { categories } from "@/lib/data";

const HUES = [220, 265, 300, 340, 20, 160];
const STEPS = ["Tài khoản", "Hồ sơ", "Sở thích"] as const;
const EASE = [0.22, 1, 0.36, 1] as const;

type Field = "email" | "password" | "confirm" | "name" | "username" | null;

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const STRENGTH = ["Quá yếu", "Yếu", "Tạm được", "Mạnh", "Rất mạnh"];
const STRENGTH_COLOR = ["#f87171", "#fb923c", "#facc15", "#8ab4ff", "#a78bfa"];

const toUsername = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 20);

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [userEdited, setUserEdited] = useState(false);
  const [hue, setHue] = useState(HUES[0]);
  const [interests, setInterests] = useState<string[]>([]);
  const [focus, setFocus] = useState<Field>(null);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const pwScore = strength(password);
  const hasError = Object.values(errors).some(Boolean);
  const secret = focus === "password" || focus === "confirm";

  const mood: MascotMood = done
    ? "happy"
    : hasError
      ? "sad"
      : secret
        ? show
          ? "peek"
          : "cover"
        : step === 2 && interests.length > 0
          ? "happy"
          : focus
            ? "idle"
            : step === 1
              ? "think"
              : "wave";
  const look =
    focus === "email" || focus === "name" || focus === "username"
      ? {
          x: 0.2 + Math.min((focus === "email" ? email : focus === "name" ? name : username).length, 24) / 24,
          y: 0.7,
        }
      : null;
  const says = done
    ? `Chào mừng ${name.split(" ").pop()} đến vũ trụ nhân vật! 🎉`
    : hasError
      ? (Object.values(errors).find(Boolean) as string)
      : secret
        ? show
          ? "Mình chỉ hé chút xíu thôi 👀"
          : "Bí mật của bạn an toàn — mình che mắt rồi 🙈"
        : step === 0
          ? "Xin chào! Cùng tạo tài khoản nhé ✨"
          : step === 1
            ? "Mọi người sẽ gọi bạn là gì nhỉ?"
            : interests.length
              ? `Ồ, ${interests.slice(0, 2).join(" & ")}! Gu hay đó!`
              : "Bạn thích những câu chuyện kiểu nào?";

  const fail = (e: Partial<Record<string, string>>) => {
    setErrors(e);
    setShake((s) => s + 1);
    return false;
  };

  const validate = (s: number) => {
    if (s === 0) {
      if (!isEmail(email)) return fail({ email: "Email chưa đúng định dạng." });
      if (emailTaken(email)) return fail({ email: "Email này đã được đăng ký — thử đăng nhập nhé." });
      if (password.length < 8) return fail({ password: "Mật khẩu cần ít nhất 8 ký tự." });
      if (confirm !== password) return fail({ confirm: "Hai mật khẩu chưa khớp nhau." });
    }
    if (s === 1) {
      if (name.trim().length < 2) return fail({ name: "Tên hiển thị cần ít nhất 2 ký tự." });
      if (!isUsername(username)) return fail({ username: "Tên người dùng: 3–20 ký tự a-z, 0-9, _ hoặc ." });
      if (usernameTaken(username)) return fail({ username: "Tên người dùng này đã có người dùng." });
    }
    if (s === 2 && interests.length === 0) return fail({ interests: "Chọn ít nhất một thể loại nhé." });
    setErrors({});
    return true;
  };

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setFocus(null);
    setStep(to);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    if (!validate(step)) return;
    if (step < 2) return go(step + 1);
    setBusy(true);
    try {
      await signUp({ email, password, name, username, hue, interests });
      setDone(true);
      fireworks();
    } catch (err) {
      fail({ submit: err instanceof Error ? err.message : "Có lỗi xảy ra." });
    } finally {
      setBusy(false);
    }
  };

  const clear = (k: string) => errors[k] && setErrors({});

  if (done) {
    return (
      <AuthFrame mood="happy" says={says} shake={0}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="flex flex-col items-center text-center"
        >
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 14, delay: 0.1 }}
          >
            <UserAvatar name={name} hue={hue} glow className="size-24 text-3xl" />
          </motion.div>
          <h1 className="mt-5 text-2xl font-bold sm:text-3xl">
            Tài khoản đã <span className="text-gradient">ra đời</span>!
          </h1>
          <p className="mt-2 text-sm text-fg-2">
            @{username} ơi, hàng chục nhân vật đang chờ bạn bắt chuyện.
          </p>
          <div className="mt-7 flex w-full flex-col gap-3">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                router.push(next);
                router.refresh();
              }}
              className="btn-glow flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold"
            >
              <Compass className="size-4" aria-hidden="true" /> Khám phá ngay
            </motion.button>
            <Link
              href="/create"
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 px-5 py-3 font-medium transition-colors hover:bg-white/5"
            >
              <Plus className="size-4" aria-hidden="true" /> Tạo nhân vật đầu tiên
            </Link>
          </div>
        </motion.div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame mood={mood} look={look} says={says} shake={shake}>
      {/* progress */}
      <ol className="mb-6 flex items-center gap-2" aria-label="Các bước đăng ký">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent via-violet to-pink"
                initial={false}
                animate={{ width: i <= step ? "100%" : "0%" }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </span>
            <span
              aria-current={i === step ? "step" : undefined}
              className={`text-[11px] font-medium ${i <= step ? "text-fg" : "text-fg-3"}`}
            >
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      <form onSubmit={onSubmit} noValidate>
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 40, filter: "blur(6px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: dir * -40, filter: "blur(6px)" }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex flex-col gap-4 p-1"
            >
              {step === 0 && (
                <>
                  <h1 className="text-2xl font-bold tracking-tight">
                    Bắt đầu <span className="text-gradient">hành trình</span>
                  </h1>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg-2">Email</span>
                    <input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      className="field"
                      placeholder="ban@vidu.com"
                      value={email}
                      aria-invalid={!!errors.email}
                      onFocus={() => setFocus("email")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clear("email");
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg-2">Mật khẩu</span>
                    <span className="relative">
                      <input
                        type={show ? "text" : "password"}
                        autoComplete="new-password"
                        className="field pr-12"
                        placeholder="Ít nhất 8 ký tự"
                        value={password}
                        aria-invalid={!!errors.password}
                        onFocus={() => setFocus("password")}
                        onBlur={() => setFocus(null)}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          clear("password");
                        }}
                      />
                      <button
                        type="button"
                        aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                        aria-pressed={show}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShow((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-fg-3 hover:bg-white/5 hover:text-fg"
                      >
                        {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                      </button>
                    </span>
                    {password && (
                      <span className="flex items-center gap-2" aria-live="polite">
                        <span className="flex flex-1 gap-1">
                          {[0, 1, 2, 3].map((i) => (
                            <motion.span
                              key={i}
                              className="h-1 flex-1 rounded-full"
                              animate={{ backgroundColor: i < pwScore ? STRENGTH_COLOR[pwScore] : "rgb(255 255 255 / 0.1)" }}
                            />
                          ))}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: STRENGTH_COLOR[pwScore] }}>
                          {STRENGTH[pwScore]}
                        </span>
                      </span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg-2">Nhập lại mật khẩu</span>
                    <input
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      className="field"
                      placeholder="••••••••"
                      value={confirm}
                      aria-invalid={!!errors.confirm}
                      onFocus={() => setFocus("confirm")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        clear("confirm");
                      }}
                    />
                  </label>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="flex items-center gap-4">
                    <motion.div key={hue} initial={{ scale: 0.8, rotate: -10 }} animate={{ scale: 1, rotate: 0 }}>
                      <UserAvatar name={name || "?"} hue={hue} glow className="size-16 text-xl" />
                    </motion.div>
                    <div>
                      <h1 className="text-2xl font-bold tracking-tight">Hồ sơ của bạn</h1>
                      <p className="text-sm text-fg-2">Có thể đổi bất cứ lúc nào.</p>
                    </div>
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg-2">Tên hiển thị</span>
                    <input
                      autoComplete="nickname"
                      className="field"
                      placeholder="VD: Minh Anh"
                      maxLength={40}
                      value={name}
                      aria-invalid={!!errors.name}
                      onFocus={() => setFocus("name")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (!userEdited) setUsername(toUsername(e.target.value));
                        clear("name");
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg-2">Tên người dùng</span>
                    <span className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-3">@</span>
                      <input
                        autoComplete="username"
                        className="field pl-8"
                        placeholder="minh_anh"
                        maxLength={20}
                        value={username}
                        aria-invalid={!!errors.username}
                        onFocus={() => setFocus("username")}
                        onBlur={() => setFocus(null)}
                        onChange={(e) => {
                          setUsername(e.target.value.toLowerCase());
                          setUserEdited(true);
                          clear("username");
                        }}
                      />
                    </span>
                  </label>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1.5 text-sm font-medium text-fg-2">Màu hào quang</legend>
                    <div className="flex gap-2.5">
                      {HUES.map((h) => (
                        <motion.button
                          key={h}
                          type="button"
                          aria-label={`Màu ${h}`}
                          aria-pressed={hue === h}
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => setHue(h)}
                          className="relative size-9 rounded-full"
                          style={{ background: `linear-gradient(135deg, hsl(${h} 90% 78%), hsl(${(h + 50) % 360} 85% 60%))` }}
                        >
                          {hue === h && (
                            <motion.span
                              layoutId="hue-ring"
                              className="absolute -inset-1 rounded-full border-2 border-white"
                              transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                          )}
                        </motion.button>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}

              {step === 2 && (
                <>
                  <h1 className="text-2xl font-bold tracking-tight">
                    Gu <span className="text-gradient">câu chuyện</span> của bạn
                  </h1>
                  <p className="-mt-2 text-sm text-fg-2">Chọn vài thể loại để Lumi gợi ý nhân vật hợp ý.</p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => {
                      const on = interests.includes(c);
                      return (
                        <motion.button
                          key={c}
                          type="button"
                          aria-pressed={on}
                          whileHover={{ y: -2 }}
                          whileTap={{ scale: 0.92 }}
                          onClick={() => {
                            setInterests((l) => (on ? l.filter((x) => x !== c) : [...l, c]));
                            clear("interests");
                          }}
                          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                            on
                              ? "border-accent/60 bg-accent/20 text-fg shadow-[0_0_20px_-4px_rgb(138_180_255/0.6)]"
                              : "border-white/10 bg-white/[0.03] text-fg-2 hover:text-fg"
                          }`}
                        >
                          <AnimatePresence initial={false}>
                            {on && (
                              <motion.span
                                initial={{ width: 0, opacity: 0 }}
                                animate={{ width: "auto", opacity: 1 }}
                                exit={{ width: 0, opacity: 0 }}
                              >
                                <Check className="size-3.5" aria-hidden="true" />
                              </motion.span>
                            )}
                          </AnimatePresence>
                          {c}
                        </motion.button>
                      );
                    })}
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setErrors({});
                go(step - 1);
              }}
              className="flex items-center gap-1.5 rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium transition-colors hover:bg-white/5"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> Quay lại
            </motion.button>
          )}
          <motion.button
            type="submit"
            disabled={busy}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="btn-glow flex flex-1 items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {step < 2 ? (
              <>
                Tiếp tục <ArrowRight className="size-4" aria-hidden="true" />
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden="true" /> Tạo tài khoản
              </>
            )}
          </motion.button>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-fg-2">
        Đã có tài khoản?{" "}
        <Link
          href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
          className="font-semibold text-accent hover:underline"
        >
          Đăng nhập
        </Link>
      </p>
    </AuthFrame>
  );
}
