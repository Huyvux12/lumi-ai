"use client";

import { useEffect, useState } from "react";
import { Download, Gift } from "lucide-react";
import { api } from "@/lib/api";

type Promotion = { code: string; enabled: boolean; updated_at: number };

const LABELS: Record<string, { title: string; help: string }> = {
  invite_banner: {
    title: "Popup mời bạn bè",
    help: "Popup nhỏ ở trang Khám phá, mời user chia sẻ link mời. Tắt popup không dừng chương trình: mã mời và phần thưởng vẫn hoạt động.",
  },
};

/** Admin switches for in-app promotions, plus the shareable banner image for Facebook. */
export function PromotionPanel() {
  const [rows, setRows] = useState<Promotion[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<Promotion[]>("/admin/promotions").then(setRows).catch((e) => setError(e.message));
  }, []);

  async function toggle(row: Promotion) {
    setBusy(row.code);
    setError("");
    try {
      const saved = await api<{ code: string; enabled: boolean }>(`/admin/promotions/${row.code}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      setRows((old) => old.map((r) => (r.code === saved.code ? { ...r, enabled: saved.enabled } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lưu.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="glass mb-5 rounded-2xl p-5" aria-labelledby="promotions-title">
      <h2 id="promotions-title" className="flex items-center gap-2 text-xl font-semibold">
        <Gift className="size-5 text-accent" aria-hidden="true" /> Chương trình mời bạn
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.code} className="flex items-start justify-between gap-4 rounded-xl border border-white/10 p-4">
              <div>
                <p className="font-medium">{LABELS[row.code]?.title ?? row.code}</p>
                <p className="mt-1 text-sm text-fg-3">{LABELS[row.code]?.help}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={row.enabled}
                aria-label={`${row.enabled ? "Tắt" : "Bật"} ${LABELS[row.code]?.title ?? row.code}`}
                disabled={busy === row.code}
                onClick={() => void toggle(row)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${row.enabled ? "bg-accent" : "bg-white/15"}`}
              >
                <span
                  className={`absolute top-1 size-5 rounded-full bg-white transition-all ${row.enabled ? "left-6" : "left-1"}`}
                />
              </button>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <figure className="md:w-[320px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated share image */}
          <img
            src="/signup/opengraph-image"
            alt="Banner mời bạn bè dùng để đăng Facebook"
            width={1200}
            height={630}
            className="w-full rounded-xl border border-white/10"
          />
          <figcaption className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-3">
            <span>Ảnh 1200×630 · hiện khi chia sẻ link mời</span>
            <a
              href="/signup/opengraph-image"
              download="personax-moi-ban-be.png"
              className="flex items-center gap-1 whitespace-nowrap text-accent hover:underline"
            >
              <Download className="size-3.5" aria-hidden="true" /> Tải ảnh
            </a>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
