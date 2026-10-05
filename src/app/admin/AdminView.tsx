"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, mutation } from "@/lib/api";
import { useAuthReady, useUser } from "@/lib/auth";
import { SecurityPanel } from "@/components/SecurityPanel";
import type { UserCharacter } from "@/lib/userCharacters";
import type { Scene } from "@/lib/data";
type AdminUser = {
  id: string;
  email: string;
  username: string;
  role: string;
  active: boolean;
  email_verified: boolean;
  mfa_enabled: boolean;
};
type Plan = {
  id: string;
  code: string;
  price_vnd: number;
  active: boolean;
  quota: Record<string, number>;
};
type Prompt = {
  id: string;
  text: string;
  active_tags: string[];
  published: boolean;
  created_at: number;
};
type Voice = {
  id: string;
  name: string;
  voice: string;
  style: string;
  enabled: boolean;
};
type Order = {
  id: string;
  user_id: string;
  invoice: string;
  amount_vnd: number;
  status: string;
  environment: string;
};
type Payment = {
  key: string;
  order_id: string | null;
  status: string;
  reason: string;
  created_at: number;
};
type Report = {
  id: string;
  character_id: string;
  reason: string;
  status: string;
};
type Audit = {
  id: string;
  actor_id: string;
  action: string;
  target: string;
  details: unknown;
  created_at: number;
};
type Summary = {
  users: number;
  active_users_7d: number;
  premium_users: number;
  revenue_vnd: number;
  input_tokens_30d: number;
  output_tokens_30d: number;
  llm_estimated_usd_30d: number;
  tts_ms_30d: number;
  stt_ms_30d: number;
  requests_released_30d: number;
  providers: Record<string, boolean | string>;
  cost_note: string;
};
const allTabs = [
  ["summary", "Tổng quan"],
  ["users", "Người dùng & quota"],
  ["orders", "Thanh toán"],
  ["plans", "Gói & giới hạn"],
  ["prompts", "System prompt"],
  ["voices", "Giọng đọc"],
  ["characters", "Nhân vật"],
  ["scenes", "Bối cảnh"],
  ["reports", "Báo cáo"],
  ["audit", "Nhật ký"],
] as const;
type Tab = (typeof allTabs)[number][0];
const field = "field w-full";
const button =
  "rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40";
const quotaLabels: Record<string, string> = {
  chat_day: "Lượt chat / ngày",
  chat_period: "Lượt chat / kỳ",
  characters: "Nhân vật",
  tts_chars: "Ký tự TTS / kỳ",
  tts_ms: "TTS / kỳ (ms)",
  stt_ms: "STT / kỳ (ms)",
  recording_seconds: "Bản ghi tối đa (giây)",
  input_chars: "Ký tự tin nhắn",
  input_tokens: "Token đầu vào",
  output_tokens: "Token đầu ra",
};
export function AdminView() {
  const user = useUser();
  return (
    <AdminAccount key={`${user?.id ?? "guest"}:${user?.role ?? "guest"}`} />
  );
}
function AdminAccount() {
  const user = useUser();
  const ready = useAuthReady();
  const [tab, setTab] = useState<Tab>(
    user?.role === "moderator" ? "characters" : "summary",
  );
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [usage, setUsage] = useState<unknown>(null);
  const [editor, setEditor] = useState<{
    path: string;
    method: string;
    body: Record<string, unknown>;
    title: string;
  } | null>(null);
  const [testPrompt, setTestPrompt] = useState("");
  const [testCharacter, setTestCharacter] = useState("kaito-kid");
  const [testText, setTestText] = useState("Xin chào");
  const [testOutput, setTestOutput] = useState("");
  const [draft, setDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const moderator = user?.role === "moderator";
  const tabs = moderator
    ? allTabs.filter(([id]) => ["characters", "scenes", "reports"].includes(id))
    : allTabs;
  const fetchEpoch = useRef(0);
  const load = useCallback(async () => {
    const version = ++fetchEpoch.current;
    try {
      const payload = await api(`/admin/${tab}`);
      if (version !== fetchEpoch.current) return;
      setData(payload);
      if (tab === "orders") {
        const rows = await api<Payment[]>("/admin/payments");
        if (version === fetchEpoch.current) setPayments(rows);
      }
    } catch (e) {
      if (version === fetchEpoch.current) {
        setError(e instanceof Error ? e.message : "Không thể tải quản trị.");
        setData(null);
      }
    } finally {
      if (version === fetchEpoch.current) setBusy(false);
    }
  }, [tab]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load updates state after the protected network response
    if (ready && user && user.role !== "user") void load();
  }, [ready, user, load]);
  async function act(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setMessage("Đã lưu.");
      setEditor(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lưu.");
    } finally {
      setBusy(false);
    }
  }
  function edit(
    title: string,
    path: string,
    method: string,
    body: Record<string, unknown>,
  ) {
    setEditor({ title, path, method, body: { ...body, reason: "" } });
  }
  if (!ready) return <p className="p-10">Đang kiểm tra phiên…</p>;
  if (!user)
    return (
      <div className="p-10">
        <Link href="/login?next=/admin" className="text-accent">
          Đăng nhập để vào quản trị
        </Link>
      </div>
    );
  if (user.role === "user")
    return <p className="p-10">Tài khoản này không có quyền quản trị.</p>;
  const summary = data as Summary | null;
  const promptData = data as {
    tag_catalog: string[];
    versions: Prompt[];
  } | null;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Quản trị Lumi</h1>
        <span className="rounded-full bg-accent/15 px-4 py-2 text-sm text-accent">
          {user.role} · @{user.username}
        </span>
      </div>
      <SecurityPanel compact />
      <nav aria-label="Trang quản trị" className="my-6 flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              setData(null);
              setBusy(true);
              setError("");
              setUsage(null);
              setMessage("");
            }}
            disabled={busy}
            aria-pressed={tab === id}
            className={`${button} ${tab === id ? "bg-accent/20 text-accent" : ""}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="mb-5 flex gap-3">
        <button
          className={button}
          onClick={() => {
            setBusy(true);
            setError("");
            void load();
          }}
          disabled={busy}
        >
          {busy ? "Đang xử lý…" : "Làm mới"}
        </button>
        {message && (
          <p role="status" className="self-center text-accent">
            {message}
          </p>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-2xl bg-danger/15 p-4 text-danger"
        >
          {error}
        </p>
      )}
      {data !== null && tab === "summary" && summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Người dùng", summary.users],
              ["Hoạt động 7 ngày", summary.active_users_7d],
              ["Premium đang dùng", summary.premium_users],
              ["Doanh thu (VND)", summary.revenue_vnd],
              ["Token vào / 30 ngày", summary.input_tokens_30d],
              ["Token ra / 30 ngày", summary.output_tokens_30d],
              ["Ước tính LLM (USD)", summary.llm_estimated_usd_30d],
              ["Yêu cầu đã nhả reservation", summary.requests_released_30d],
            ].map(([label, value]) => (
              <section key={String(label)} className="glass rounded-2xl p-5">
                <p className="text-sm text-fg-2">{label}</p>
                <p className="mt-3 text-2xl font-bold">
                  {Number(value).toLocaleString("vi-VN")}
                </p>
              </section>
            ))}
          </div>
          <p className="my-4 text-sm text-fg-2">{summary.cost_note}</p>
          <div className="glass rounded-2xl p-5">
            <h2 className="mb-3 font-semibold">Kết nối dịch vụ</h2>
            <ul className="space-y-2 text-sm">
              {Object.entries(summary.providers).map(([name, value]) => (
                <li key={name}>
                  {name}:{" "}
                  <span className="text-accent">
                    {typeof value === "boolean"
                      ? value
                        ? "Đã cấu hình"
                        : "Chưa cấu hình"
                      : value}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-fg-2">
              TTS: {(summary.tts_ms_30d / 60000).toFixed(1)} phút · STT:{" "}
              {(summary.stt_ms_30d / 60000).toFixed(1)} phút / 30 ngày
            </p>
          </div>
        </>
      )}
      {data !== null && tab === "users" && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-3">Tài khoản</th>
                  <th>Quyền</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {(data as AdminUser[]).map((u) => (
                  <tr key={u.id} className="border-t border-white/10">
                    <td className="p-3">
                      {u.email}
                      <br />
                      <span className="text-fg-3">@{u.username}</span>
                    </td>
                    <td>{u.role}</td>
                    <td>
                      {u.active ? "Đang hoạt động" : "Đã khóa"}
                      <br />
                      <span className="text-fg-3">
                        Email {u.email_verified ? "✓" : "chưa xác minh"} · MFA{" "}
                        {u.mfa_enabled ? "✓" : "chưa bật"}
                      </span>
                    </td>
                    <td className="space-x-2">
                      <button
                        className={button}
                        onClick={() => {
                          void api(`/admin/users/${u.id}/usage`)
                            .then(setUsage)
                            .catch((e) => setError(e.message));
                        }}
                      >
                        Xem quota
                      </button>
                      <button
                        className={button}
                        onClick={() =>
                          edit(
                            "Tài khoản " + u.email,
                            `/admin/users/${u.id}`,
                            "PATCH",
                            {
                              active: u.active,
                              ...(user.role === "owner"
                                ? { role: u.role }
                                : {}),
                            },
                          )
                        }
                      >
                        Chỉnh sửa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {usage !== null && (
            <section className="glass mt-6 rounded-2xl p-5">
              <h2 className="mb-3 font-semibold">
                Quota nội bộ của người dùng đã chọn
              </h2>
              <pre className="overflow-auto whitespace-pre-wrap text-sm">
                {JSON.stringify(usage, null, 2)}
              </pre>
            </section>
          )}
        </>
      )}
      {data !== null && tab === "orders" && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-3">Mã đơn</th>
                  <th>Số tiền</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {(data as Order[]).map((o) => (
                  <tr key={o.id} className="border-t border-white/10">
                    <td className="p-3">
                      {o.invoice}
                      <br />
                      <span className="text-fg-3">
                        {o.environment} · {o.user_id}
                      </span>
                    </td>
                    <td>{o.amount_vnd.toLocaleString("vi-VN")} ₫</td>
                    <td>{o.status}</td>
                    <td className="space-x-2">
                      <button
                        className={button}
                        onClick={() =>
                          edit(
                            "Đối soát từ SePay",
                            `/admin/orders/${o.id}/reconcile`,
                            "POST",
                            {},
                          )
                        }
                      >
                        Đối soát
                      </button>
                      {o.status === "paid" && user.role === "owner" && (
                        <button
                          className={button}
                          onClick={() =>
                            edit(
                              "Ghi nhận khoản tiền đã hoàn bên ngoài; thu hồi kỳ Premium",
                              `/admin/orders/${o.id}/record-refund`,
                              "POST",
                              {},
                            )
                          }
                        >
                          Ghi nhận hoàn tiền
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="my-5 text-xl font-semibold">Sự kiện thanh toán</h2>
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.key} className="glass rounded-xl p-3 text-sm">
                <span className="break-all">{p.key}</span> · {p.status}{" "}
                {p.reason && `· ${p.reason}`}
              </div>
            ))}
          </div>
        </>
      )}
      {data !== null && tab === "plans" && (
        <div className="grid gap-5 md:grid-cols-2">
          {(data as Plan[])
            .filter((p) => p.active)
            .map((p) => (
              <section key={p.id} className="glass rounded-2xl p-5">
                <h2 className="text-xl font-semibold">
                  {p.code} · {p.price_vnd.toLocaleString("vi-VN")} ₫
                </h2>
                <dl className="my-4 grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(p.quota).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-fg-3">{quotaLabels[key] ?? key}</dt>
                      <dd>{value.toLocaleString("vi-VN")}</dd>
                    </div>
                  ))}
                </dl>
                {user.role === "owner" && (
                  <button
                    className={button}
                    onClick={() =>
                      edit(
                        "Tạo phiên bản gói mới",
                        `/admin/plans/${p.code}`,
                        "POST",
                        { price_vnd: p.price_vnd, quota: p.quota },
                      )
                    }
                  >
                    Điều chỉnh
                  </button>
                )}
                <p className="mt-3 text-xs text-fg-3">
                  Kỳ Premium đã mua giữ phiên bản giới hạn khi tạo đơn.
                </p>
              </section>
            ))}
        </div>
      )}
      {data !== null && tab === "prompts" && promptData && (
        <>
          <form
            className="glass mb-5 space-y-3 rounded-2xl p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const result = await api(
                  `/admin/prompts/${testPrompt}/test`,
                  mutation({ character_id: testCharacter, text: testText }),
                );
                setTestOutput(JSON.stringify(result, null, 2));
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Không thể thử prompt.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2 className="font-semibold">Thử phiên bản prompt</h2>
            <label className="block text-sm">
              Phiên bản
              <select
                required
                className={field + " mt-1"}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
              >
                <option value="">Chọn phiên bản</option>
                {promptData.versions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.published ? "Đang phát hành" : "Bản nháp/cũ"} ·{" "}
                    {p.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              ID nhân vật
              <input
                required
                className={field + " mt-1"}
                value={testCharacter}
                onChange={(e) => setTestCharacter(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Tin nhắn thử
              <textarea
                required
                maxLength={4000}
                className={field + " mt-1"}
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
              />
            </label>
            <button className={button} disabled={busy}>
              Chạy thử
            </button>
            {testOutput && (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">
                {testOutput}
              </pre>
            )}
          </form>
          <form
            className="glass space-y-4 rounded-2xl p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void act("/admin/prompts", {
                text: draft,
                active_tags: tags,
                reason,
              });
            }}
          >
            <h2 className="text-xl font-semibold">Bản nháp mới</h2>
            <label className="block text-sm">
              System prompt
              <textarea
                required
                minLength={20}
                maxLength={12000}
                rows={10}
                className={field + " mt-2"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <fieldset>
              <legend className="mb-2 text-sm">Vocal tags cho LLM</legend>
              <div className="flex flex-wrap gap-3">
                {promptData.tag_catalog.map((tag) => (
                  <label key={tag} className="flex gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={tags.includes(tag)}
                      onChange={(e) =>
                        setTags((old) =>
                          e.target.checked
                            ? [...old, tag]
                            : old.filter((t) => t !== tag),
                        )
                      }
                    />
                    &lt;{tag}&gt;
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">
              Lý do
              <textarea
                required
                minLength={3}
                maxLength={500}
                className={field + " mt-2"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className={button} disabled={busy}>
              Lưu bản nháp
            </button>
          </form>
          <div className="mt-5 space-y-4">
            {promptData.versions.map((p) => (
              <section key={p.id} className="glass rounded-2xl p-5">
                <p className="mb-3 text-sm text-accent">
                  {p.published ? "Đang phát hành" : "Bản nháp / phiên bản cũ"} ·{" "}
                  {new Date(p.created_at).toLocaleString("vi-VN")}
                </p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">
                  {p.text}
                </pre>
                <p className="my-3 text-xs text-fg-3">
                  {p.active_tags.join(", ")}
                </p>
                <div className="flex gap-3">
                  <button
                    className={button}
                    onClick={() => {
                      setDraft(p.text);
                      setTags(p.active_tags);
                    }}
                  >
                    Dùng làm bản nháp
                  </button>
                  {!p.published && (
                    <button
                      className={button}
                      onClick={() =>
                        edit(
                          "Phát hành / khôi phục phiên bản prompt",
                          `/admin/prompts/${p.id}/publish`,
                          "POST",
                          {},
                        )
                      }
                    >
                      Phát hành
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      {data !== null && tab === "voices" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(data as Voice[]).map((v) => (
            <section key={v.id} className="glass rounded-2xl p-5">
              <h2 className="font-semibold">{v.name}</h2>
              <p className="my-3 text-sm text-fg-2">
                {v.voice} · {v.enabled ? "Bật" : "Tắt"}
                <br />
                {v.style}
              </p>
              <button
                className={button}
                onClick={() =>
                  edit("Preset giọng đọc", `/admin/voices/${v.id}`, "PATCH", {
                    name: v.name,
                    voice: v.voice,
                    style: v.style,
                    enabled: v.enabled,
                  })
                }
              >
                Chỉnh sửa
              </button>
            </section>
          ))}
        </div>
      )}
      {data !== null && tab === "characters" && (
        <div className="space-y-3">
          {(data as UserCharacter[]).map((c) => (
            <section
              key={c.id}
              className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4"
            >
              <div>
                <Link href={`/character/${c.id}`} className="font-semibold">
                  {c.name}
                </Link>
                <p className="mt-1 text-sm text-fg-2">
                  {c.owner ? "Cộng đồng" : "Chính thức"} · {c.status} ·{" "}
                  {c.tagline}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className={button}
                  onClick={() =>
                    edit(
                      "Duyệt / ẩn nhân vật",
                      `/admin/characters/${c.id}`,
                      "PATCH",
                      { status: c.status },
                    )
                  }
                >
                  Kiểm duyệt
                </button>
                {!c.owner && !moderator && (
                  <button
                    className={button}
                    onClick={() => {
                      const {
                        name,
                        tagline,
                        description,
                        persona,
                        greeting,
                        tags,
                        hue,
                        seed,
                        voice_id,
                      } = c;
                      edit(
                        "Hồ sơ nhân vật chính thức",
                        `/admin/catalog/${c.id}`,
                        "PATCH",
                        {
                          name,
                          tagline,
                          description,
                          persona,
                          greeting,
                          tags,
                          hue,
                          seed: seed ?? c.id,
                          voice_id: voice_id ?? "kore-warm",
                        },
                      );
                    }}
                  >
                    Sửa hồ sơ
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {data !== null && tab === "scenes" && (
        <>
          <button
            className={button}
            disabled={moderator}
            onClick={() =>
              edit("Bối cảnh mới", "/admin/scenes", "POST", {
                title: "",
                premise: "",
                hue: 265,
                characterIds: [],
              })
            }
          >
            Thêm bối cảnh
          </button>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(data as Scene[]).map((s) => (
              <section key={s.id} className="glass rounded-2xl p-5">
                <h2 className="font-semibold">{s.title}</h2>
                <p className="my-3 text-sm text-fg-2">{s.premise}</p>
                <p className="mb-3 text-xs text-fg-3">
                  {s.characterIds.join(", ")}
                </p>
                {!moderator && (
                  <button
                    className={button}
                    onClick={() =>
                      edit("Sửa bối cảnh", `/admin/scenes/${s.id}`, "PATCH", {
                        title: s.title,
                        premise: s.premise,
                        hue: s.hue,
                        characterIds: s.characterIds,
                      })
                    }
                  >
                    Chỉnh sửa
                  </button>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {data !== null && tab === "reports" && (
        <div className="space-y-3">
          {(data as Report[]).map((r) => (
            <section key={r.id} className="glass rounded-2xl p-4">
              <p>{r.reason}</p>
              <p className="my-3 text-sm text-fg-3">
                {r.character_id} · {r.status}
              </p>
              {r.status === "open" && (
                <button
                  className={button}
                  onClick={() =>
                    edit(
                      "Đóng báo cáo",
                      `/admin/reports/${r.id}/close`,
                      "POST",
                      {},
                    )
                  }
                >
                  Xử lý xong
                </button>
              )}
            </section>
          ))}
        </div>
      )}
      {data !== null && tab === "audit" && (
        <div className="space-y-3">
          {(data as Audit[]).map((a) => (
            <details key={a.id} className="glass rounded-xl p-4 text-sm">
              <summary>
                {new Date(a.created_at).toLocaleString("vi-VN")} · {a.action} ·{" "}
                {a.target}
              </summary>
              <p className="my-2 text-fg-3">Người thực hiện: {a.actor_id}</p>
              <pre className="overflow-auto whitespace-pre-wrap">
                {JSON.stringify(a.details, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}
      {editor && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={editor.title}
        >
          <form
            className="glass mx-auto my-8 max-w-2xl space-y-4 rounded-3xl bg-sidebar p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void act(editor.path, editor.body, editor.method);
            }}
          >
            <h2 className="text-xl font-semibold">{editor.title}</h2>
            {Object.entries(editor.body).map(([key, value]) => {
              if (key === "quota")
                return (
                  <fieldset key={key} className="grid grid-cols-2 gap-3">
                    <legend className="mb-3 font-semibold">
                      Giới hạn nội bộ
                    </legend>
                    {Object.entries(value as Record<string, number>).map(
                      ([q, n]) => (
                        <label key={q} className="text-sm">
                          {quotaLabels[q] ?? q}
                          <input
                            type="number"
                            required
                            min={0}
                            value={n}
                            className={field + " mt-1"}
                            onChange={(e) =>
                              setEditor({
                                ...editor,
                                body: {
                                  ...editor.body,
                                  quota: {
                                    ...(value as object),
                                    [q]: Number(e.target.value),
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      ),
                    )}
                  </fieldset>
                );
              const options: keyof typeof editor.body = key;
              if (typeof value === "boolean")
                return (
                  <label key={key} className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          body: { ...editor.body, [key]: e.target.checked },
                        })
                      }
                    />
                    {key}
                  </label>
                );
              const choices: Record<string, string[]> = {
                role: ["user", "moderator", "admin", "owner"],
                status: ["approved", "pending", "hidden"],
                voice: ["Kore", "Puck"],
              };
              if (choices[key])
                return (
                  <label key={key} className="block text-sm">
                    {key}
                    <select
                      className={field + " mt-1"}
                      value={String(value)}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          body: { ...editor.body, [key]: e.target.value },
                        })
                      }
                    >
                      {choices[key].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                );
              return (
                <label key={String(options)} className="block text-sm">
                  {key === "reason" ? "Lý do (bắt buộc)" : key}
                  {Array.isArray(value) ? (
                    <input
                      className={field + " mt-1"}
                      value={value.join(", ")}
                      placeholder="Các giá trị cách nhau bởi dấu phẩy"
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          body: {
                            ...editor.body,
                            [key]: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                    />
                  ) : typeof value === "number" ? (
                    <input
                      type="number"
                      required
                      className={field + " mt-1"}
                      value={value}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          body: {
                            ...editor.body,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  ) : (
                    <textarea
                      required
                      rows={
                        ["persona", "description", "premise"].includes(key)
                          ? 5
                          : 2
                      }
                      className={field + " mt-1"}
                      value={String(value ?? "")}
                      minLength={key === "reason" ? 3 : undefined}
                      maxLength={key === "reason" ? 500 : undefined}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          body: { ...editor.body, [key]: e.target.value },
                        })
                      }
                    />
                  )}
                </label>
              );
            })}
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                className="btn-glow rounded-xl px-5 py-2.5"
                disabled={busy}
              >
                Lưu thay đổi
              </button>
              <button
                type="button"
                className={button}
                onClick={() => setEditor(null)}
              >
                Đóng
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
