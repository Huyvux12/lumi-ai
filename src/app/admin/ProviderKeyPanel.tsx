"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, LockKeyhole, Plus } from "lucide-react";
import { api } from "@/lib/api";

type KeyInfo = {
  id: string;
  source: "admin" | "server" | "none";
  suffix: string | null;
  server_configured: boolean;
  updated_at: number | null;
  used_by: string[];
  active: boolean;
};
type KeyData = { version: number; keys: KeyInfo[] };
const panel = "rounded-2xl border border-white/10 bg-surface p-5 sm:p-6";
const field =
  "mt-2 w-full rounded-xl border border-white/10 bg-bg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const name = (id: string) =>
  id === "groq"
    ? "Groq"
    : id === "deepgram"
      ? "Deepgram"
      : `OpenAI-compatible · ${id.slice(4)}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Không thể quản lý khóa API.";

export function ProviderKeyPanel({
  onSaved,
  onReload,
}: {
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [data, setData] = useState<KeyData | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [removing, setRemoving] = useState<KeyInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<KeyData>("/admin/providers/keys", { signal: controller.signal })
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (removing) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [removing]);
  return (
    <section className={`${panel} space-y-5`} data-testid="provider-key-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <KeyRound className="size-4 text-violet" />
          Khóa API
        </h2>
        <button
          className={button}
          disabled={!data || busy}
          onClick={() => setTarget("new")}
        >
          <Plus className="size-4" />
          Thêm khóa OpenAI-compatible
        </button>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-fg-3">
        Chỉ owner được quản lý khóa. Khóa được mã hóa khi lưu, không thể xem lại
        toàn bộ và có hiệu lực cho yêu cầu mới ngay sau khi lưu. Khóa từ server
        vẫn được giữ làm nguồn dự phòng cấu hình.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}{" "}
          <button className="underline" onClick={() => void onReload()}>
            Làm mới khóa
          </button>
        </p>
      )}
      {!data && !error && (
        <p role="status" className="text-sm text-fg-3">
          Đang tải trạng thái khóa…
        </p>
      )}
      {data && (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.keys.map((item) => (
            <article
              key={item.id}
              className="min-w-0 rounded-xl border border-white/10 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="break-all text-sm font-medium">
                  {name(item.id)}
                </h3>
                {item.active && (
                  <span className="rounded-md bg-violet/10 px-2 py-1 text-xs text-violet">
                    Nguồn đang dùng
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-fg-2">
                {item.source === "admin"
                  ? `Khóa admin · ••••${item.suffix}`
                  : item.source === "server"
                    ? "Khóa server · Đã cấu hình"
                    : "Chưa có khóa"}
              </p>
              {item.source === "admin" && item.server_configured && (
                <p className="mt-1 text-xs text-fg-3">
                  Có khóa server thay thế khi xóa khóa admin.
                </p>
              )}
              {item.updated_at && (
                <p className="mt-2 text-xs text-fg-3">
                  Cập nhật: {new Date(item.updated_at).toLocaleString("vi-VN")}
                </p>
              )}
              <p className="mt-2 break-words text-xs leading-5 text-fg-3">
                {item.used_by.length
                  ? `Cấu hình sử dụng: ${item.used_by.join(", ")}`
                  : "Chưa gắn với cấu hình LLM."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={busy}
                  aria-label={`Nhập khóa ${name(item.id)}`}
                  onClick={() => setTarget(item.id)}
                >
                  {item.source === "admin" ? "Thay khóa" : "Nhập khóa"}
                </button>
                {item.source === "admin" && (
                  <button
                    className={button}
                    disabled={busy || (item.active && !item.server_configured)}
                    aria-label={`Xóa khóa ${name(item.id)}`}
                    onClick={() => setRemoving(item)}
                  >
                    Xóa khóa admin
                  </button>
                )}
              </div>
              {item.source === "admin" &&
                item.active &&
                !item.server_configured && (
                  <p className="mt-2 text-xs text-fg-3">
                    Cần đổi nguồn đang hoạt động trước khi xóa khóa cuối cùng.
                  </p>
                )}
            </article>
          ))}
        </div>
      )}
      {data && target && (
        <form
          key={target}
          className="space-y-4 rounded-xl border border-violet/20 bg-violet/5 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const form = event.currentTarget;
            const values = new FormData(form);
            const ident =
              target === "new"
                ? `llm:${String(values.get("key_ref"))}`
                : target;
            const body = JSON.stringify({
              version: data.version,
              api_key: values.get("api_key"),
            });
            // Clear immediately; never retain keys in component state or browser storage.
            form.reset();
            setError("");
            setBusy(true);
            try {
              await api(`/admin/providers/keys/${encodeURIComponent(ident)}`, {
                method: "PUT",
                body,
              });
              setTarget(null);
              await onSaved();
            } catch (error) {
              setError(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="flex items-center gap-2 font-medium">
            <LockKeyhole className="size-4" />
            {target === "new"
              ? "Thêm khóa OpenAI-compatible"
              : `Nhập khóa ${name(target)}`}
          </h3>
          {target === "new" && (
            <label className="block text-sm">
              Tên tham chiếu khóa
              <input
                className={field}
                name="key_ref"
                required
                pattern="(?!groq$)[a-zA-Z0-9_-]{1,40}"
                maxLength={40}
                placeholder="openai-production"
              />
              <span className="mt-1 block text-xs text-fg-3">
                Dùng tên này khi tạo cấu hình LLM. Không dùng tên groq.
              </span>
            </label>
          )}
          <label className="block text-sm">
            API key mới
            <input
              className={field}
              name="api_key"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              required
              minLength={8}
              maxLength={8192}
            />
          </label>
          <p className="text-xs leading-5 text-fg-3">
            Lưu xong, dùng mục thử LLM hoặc STT bên dưới để kiểm tra kết nối.
            Lưu khóa không tự đổi nguồn đang hoạt động. Nếu thay khóa của nguồn
            đang dùng, yêu cầu mới sẽ dùng khóa mới.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={`${button} bg-violet/15`} disabled={busy}>
              {busy ? "Đang lưu khóa…" : "Lưu API key"}
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              Hủy
            </button>
          </div>
        </form>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="delete-key-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-surface p-6 text-fg backdrop:bg-black/70"
      >
        {removing && (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !data) return;
              setBusy(true);
              setError("");
              try {
                await api(
                  `/admin/providers/keys/${encodeURIComponent(removing.id)}`,
                  {
                    method: "DELETE",
                    body: JSON.stringify({ version: data.version }),
                  },
                );
                setRemoving(null);
                await onSaved();
              } catch (error) {
                setError(errorText(error));
                setRemoving(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3 id="delete-key-title" className="text-lg font-semibold">
              Xóa khóa {name(removing.id)}?
            </h3>
            <p className="text-sm leading-6 text-fg-3">
              {removing.server_configured
                ? "Sau khi xóa khóa admin, yêu cầu mới sẽ quay về khóa đã cấu hình trên server."
                : "Sau khi xóa, các cấu hình dùng tên khóa này sẽ chưa có API key. Khóa đã xóa không thể khôi phục từ giao diện."}
            </p>
            <div className="flex gap-2">
              <button className={button} disabled={busy}>
                {busy ? "Đang xóa…" : "Xác nhận xóa khóa"}
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                Hủy
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}
