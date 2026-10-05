"use client";
import { useState } from "react";
import { api, mutation } from "@/lib/api";
import { refreshUser, useUser } from "@/lib/auth";
export function SecurityPanel({ compact = false }: { compact?: boolean }) {
  const user = useUser();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Không thể cập nhật.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="glass rounded-2xl p-5"
      open={compact && !user.mfa_enabled}
    >
      <summary className="cursor-pointer font-semibold">
        Bảo mật tài khoản {user.mfa_enabled ? "· MFA đã bật" : ""}
      </summary>
      <div className="mt-4 space-y-4 text-sm">
        {!user.email_verified && (
          <div>
            <p className="mb-2 text-fg-2">
              Xác minh email để sử dụng AI khi hệ thống được đưa lên chính thức.
            </p>
            <button
              disabled={busy}
              className="rounded-lg bg-white/10 px-3 py-2"
              onClick={() =>
                void run(async () => {
                  await api("/auth/resend-verification", mutation());
                  setMessage("Đã gửi liên kết xác minh. Kiểm tra email.");
                })
              }
            >
              Gửi lại email xác minh
            </button>
          </div>
        )}
        {!user.mfa_enabled && !secret && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api<{ secret: string }>(
                  "/auth/mfa/setup",
                  mutation({ password }),
                );
                setSecret(result.secret);
                setPassword("");
              });
            }}
          >
            <p className="mb-2 text-fg-2">
              Thêm xác thực 2 bước bằng ứng dụng Authenticator. MFA bắt buộc cho
              quản trị ở môi trường chính thức.
            </p>
            <label>
              Mật khẩu hiện tại
              <input
                required
                type="password"
                autoComplete="current-password"
                className="field my-2"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              className="rounded-lg bg-white/10 px-3 py-2"
            >
              Thiết lập MFA
            </button>
          </form>
        )}
        {secret && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/auth/mfa/confirm", mutation({ code }));
                setSecret("");
                setCode("");
                await refreshUser();
                setMessage("Đã bật MFA. Các phiên khác đã được đăng xuất.");
              });
            }}
          >
            <p className="text-fg-2">
              Trong Authenticator, thêm tài khoản Lumi bằng khóa thiết lập này.
              Lưu khóa an toàn để khôi phục quyền truy cập.
            </p>
            <code className="my-3 block break-all select-all rounded-lg bg-black/30 p-3">
              {secret}
            </code>
            <label>
              Mã 6 số
              <input
                required
                pattern="[0-9]{6}"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="field my-2"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              className="rounded-lg bg-white/10 px-3 py-2"
            >
              Xác nhận
            </button>
          </form>
        )}
        <button
          disabled={busy}
          className="rounded-lg bg-white/10 px-3 py-2"
          onClick={() =>
            void run(async () => {
              await api("/auth/revoke-sessions", mutation());
              setMessage("Đã đăng xuất các phiên khác.");
            })
          }
        >
          Đăng xuất các thiết bị khác
        </button>
        {message && (
          <p role="status" className="text-accent">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
