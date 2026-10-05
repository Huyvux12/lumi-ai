"use client";
import Link from "next/link";
import { useState } from "react";
import { api, mutation } from "@/lib/api";
import { refreshUser } from "@/lib/auth";
export function AccountRecovery({
  mode,
  token = "",
}: {
  mode: "forgot" | "reset" | "verify";
  token?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const path =
        mode === "forgot"
          ? "forgot-password"
          : mode === "reset"
            ? "reset-password"
            : "verify-email";
      await api(
        "/auth/" + path,
        mutation(
          mode === "forgot"
            ? { email }
            : mode === "reset"
              ? { token, password }
              : { token },
        ),
      );
      setDone(true);
      setMessage(
        mode === "forgot"
          ? "Nếu tài khoản tồn tại, email hướng dẫn đã được gửi."
          : mode === "reset"
            ? "Mật khẩu đã được đổi. Hãy đăng nhập lại."
            : "Email đã được xác minh.",
      );
      await refreshUser();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Không thể xử lý.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">
        {mode === "forgot"
          ? "Quên mật khẩu"
          : mode === "reset"
            ? "Đặt lại mật khẩu"
            : "Xác minh email"}
      </h1>
      <form className="glass space-y-4 rounded-3xl p-6" onSubmit={submit}>
        {mode === "forgot" && (
          <label className="block text-sm">
            Email
            <input
              required
              type="email"
              autoComplete="email"
              className="field mt-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        {mode === "reset" && (
          <label className="block text-sm">
            Mật khẩu mới
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              className="field mt-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {mode === "verify" && (
          <p className="text-sm text-fg-2">
            Bấm xác nhận để hoàn tất xác minh email.
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-accent">
            {message}
          </p>
        )}
        <button
          disabled={busy || done || (mode !== "forgot" && !token)}
          className="btn-glow w-full rounded-full p-3"
        >
          {busy
            ? "Đang xử lý…"
            : mode === "forgot"
              ? "Gửi liên kết"
              : "Xác nhận"}
        </button>
        <Link href="/login" className="block text-center text-sm text-fg-2">
          Về đăng nhập
        </Link>
      </form>
    </div>
  );
}
