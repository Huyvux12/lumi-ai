"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import type { MascotMood } from "@/components/Mascot";
import { isEmail, signIn } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { burst } from "@/lib/confetti";

type Focus = "email" | "password" | null;

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [shake, setShake] = useState(0);
  const [needsMfa, setNeedsMfa] = useState(false);

  const mood: MascotMood = done
    ? "happy"
    : error
      ? "sad"
      : focus === "password"
        ? show
          ? "peek"
          : "cover"
        : "idle";
  const look =
    focus === "email"
      ? { x: 0.2 + Math.min(email.length, 28) / 28, y: 0.7 }
      : null;
  const says = done
    ? "Yay! Chào mừng trở lại ✨"
    : error
      ? error
      : focus === "password"
        ? show
          ? "Ơ… mình hé một chút thôi nha 👀"
          : "Mình che mắt rồi, không nhìn đâu! 🙈"
        : focus === "email"
          ? "Mình đang đọc email của bạn nè…"
          : "Chào bạn! Mình là Lumi — linh hồn kể chuyện.";

  const fail = (msg: string) => {
    setError(msg);
    setShake((s) => s + 1);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    if (!isEmail(email)) return fail("Email chưa đúng định dạng rồi.");
    if (!password) return fail("Bạn quên nhập mật khẩu kìa.");
    if (needsMfa && !/^\d{6}$/.test(totpCode))
      return fail("Nhập mã 6 số từ ứng dụng Authenticator.");
    setBusy(true);
    try {
      await signIn(email, password, needsMfa ? totpCode : undefined);
      setError(null);
      setDone(true);
      burst(0.72, 0.45);
      setTimeout(() => {
        router.push(next);
        router.refresh();
      }, 1300);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED")
        setNeedsMfa(true);
      fail(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame mood={mood} look={look} says={says} shake={shake}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Chào mừng <span className="text-gradient">trở lại</span>
      </h1>
      <p className="mt-1.5 text-sm text-fg-2">
        Đăng nhập để tiếp tục những câu chuyện dang dở.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg-2">Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            className="field"
            placeholder="ban@vidu.com"
            value={email}
            aria-invalid={!!error && !isEmail(email)}
            onFocus={() => setFocus("email")}
            onBlur={() => setFocus(null)}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg-2">Mật khẩu</span>
          <span className="relative">
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              className="field pr-12"
              placeholder="••••••••"
              value={password}
              onFocus={() => setFocus("password")}
              onBlur={() => setFocus(null)}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
            <button
              type="button"
              aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              aria-pressed={show}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShow((v) => !v);
                setFocus("password");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-fg-3 transition-colors hover:bg-white/5 hover:text-fg"
            >
              {show ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </span>
        </label>

        {needsMfa && (
          <label className="flex flex-col gap-1.5 text-sm text-fg-2">
            Mã 6 số
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              className="field"
            />
          </label>
        )}
        <Link href="/forgot-password" className="text-sm text-accent">
          Quên mật khẩu?
        </Link>
        <motion.button
          type="submit"
          disabled={busy || done}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="btn-glow mt-2 flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold disabled:opacity-80"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogIn className="size-4" aria-hidden="true" />
          )}
          {done ? "Đang vào…" : "Đăng nhập"}
        </motion.button>
      </form>

      <p className="mt-6 text-center text-sm text-fg-2">
        Chưa có tài khoản?{" "}
        <Link
          href={
            next === "/"
              ? "/signup"
              : `/signup?next=${encodeURIComponent(next)}`
          }
          className="font-semibold text-accent hover:underline"
        >
          Đăng ký miễn phí
        </Link>
      </p>
      <p className="mt-3 text-center text-[11px] text-fg-3">
        Bản demo: tài khoản chỉ được lưu trong trình duyệt này.
      </p>
    </AuthFrame>
  );
}
