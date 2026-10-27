"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ProviderPanel, type ProviderData } from "./ProviderPanel";
import { AdminShell, adminLabels } from "./AdminShell";
import { AdminDashboard, DashboardSkeleton } from "./AdminDashboard";
import { PromotionPanel } from "./PromotionPanel";
import type { AdminTab, DashboardData, DashboardQueue } from "./dashboard-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, mutation } from "@/lib/api";
import { useAuthReady, useUser } from "@/lib/auth";
import { SecurityPanel } from "@/components/SecurityPanel";
import { FeedbackWorkspace } from "@/components/FeedbackWorkspace";
import { Portrait } from "@/components/Portrait";
import type { UserCharacter } from "@/lib/userCharacters";
import type { Scene } from "@/lib/data";
const editorLabels: Record<string, string> = {
  description_vi: "Mô tả giọng (tiếng Việt)",
  description_en: "Voice description (English)",
  reason: "Lý do (bắt buộc)",
};
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
  label: string;
  paid: boolean;
  price_vnd: number;
  active: boolean;
  quota: Record<string, number>;
  enabled: boolean;
  discount_percent: number;
  promo_codes: string[];
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
  description_vi: string;
  description_en: string;
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
type Tab = AdminTab;
const field = "field w-full";
function ModerationPreview({ id }: { id: string }) {
  const [character, setCharacter] = useState<UserCharacter | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try { setCharacter(await api<UserCharacter>(`/admin/characters/${id}/preview`)); }
    catch (error) { setError(error instanceof Error ? error.message : "Không thể xem nhân vật."); }
    finally { setBusy(false); }
  }
  return <div className="w-full">
    <button className="text-accent" disabled={busy} onClick={() => void load()}>{busy ? "Đang tải…" : "Xem hồ sơ & ảnh"}</button>
    {error && <p role="alert">{error}</p>}
    {character && <div className="mt-3 space-y-3">
      <Portrait seed={character.seed ?? character.id} hue={character.hue} image={character.image} className="size-32 rounded-xl" />
      {[["Mô tả", character.description], ["Tính cách", character.persona], ["Scenario", character.scenario], ["Lời chào", character.greeting]].map(([label, value]) => <p className="whitespace-pre-wrap" key={label}><strong>{label}: </strong>{value || "—"}</p>)}
    </div>}
  </div>;
}
function PlanAvailabilityForm({
  plan,
  busy,
  save,
}: {
  plan: Plan;
  busy: boolean;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(plan.enabled);
  const [discount, setDiscount] = useState(String(plan.discount_percent));
  const [codes, setCodes] = useState(plan.promo_codes.join(", "));
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-4 space-y-3 border-b border-white/10 pb-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          enabled,
          discount_percent: plan.paid ? Number(discount) : 0,
          promo_codes:
            plan.paid
              ? codes
                  .split(/[,\n]+/)
                  .map((code) => code.trim())
                  .filter(Boolean)
              : [],
          reason,
        });
      }}
    >
      <label className="flex items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          disabled={busy}
        />
        Mở đăng ký gói {plan.label}
      </label>
      <p className="text-xs text-fg-3">
        {plan.paid
          ? "Đóng gói chỉ chặn đơn mua mới. Người đang dùng gói này vẫn dùng bình thường đến hết kỳ."
          : "Đóng Free khi server quá tải: tài khoản mới vẫn tạo được nhưng vào hàng chờ, tự mở khi Free mở lại hoặc khi mua gói. Tài khoản Free cũ không bị ảnh hưởng."}
      </p>
      {plan.paid && (
        <>
          <label className="block text-sm">
            Giảm giá {plan.label} (%)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              required
              className={`${field} mt-2`}
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Mã giảm giá đang áp dụng
            <textarea
              className={`${field} mt-2`}
              value={codes}
              onChange={(event) => setCodes(event.target.value)}
              placeholder="Mỗi mã một dòng hoặc ngăn cách bằng dấu phẩy"
            />
          </label>
          <p className="text-xs text-fg-3">
            Mã có 3–32 chữ, số, dấu _ hoặc -. Phần trăm hiện tại chỉ áp dụng cho
            đơn mới có mã hợp lệ.
          </p>
        </>
      )}
      <label className="block text-sm">
        Lý do thay đổi
        <input
          className={`${field} mt-2`}
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="btn-glow rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50"
      >
        Lưu trạng thái gói
      </button>
    </form>
  );
}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const moderator = user?.role === "moderator";
  const requestedTab = searchParams.get("tab") ?? "summary";
  const tab: Tab = Object.hasOwn(adminLabels, requestedTab) &&
    (!moderator || ["summary", "characters", "scenes", "reports"].includes(requestedTab))
    ? requestedTab as Tab : "summary";
  const requestedDays = Number(searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const [queue, setQueue] = useState<DashboardQueue>();
  const [feedbackRefresh, setFeedbackRefresh] = useState(0);
  const requestKey = `${moderator ? "moderation" : "admin"}:${tab}:${days}`;
  const [cachedData, setData] = useState<unknown>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const data = loadedKey === requestKey ? cachedData : null;
  const [voiceOptions, setVoiceOptions] = useState<string[]>([]);
  const [voicePresets, setVoicePresets] = useState<Voice[]>([]);
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
  const fetchEpoch = useRef(0);
  const load = useCallback(async () => {
    const version = ++fetchEpoch.current;
    setBusy(true);
    try {
      const [payload, options, presets] = await Promise.all([
        api(tab === "summary" || tab === "feedback" ? moderator ? "/admin/moderation-dashboard" : `/admin/dashboard?days=${days}` : `/admin/${tab}`),
        tab === "voices" ? api<string[]>("/admin/voices/options") : Promise.resolve(null),
        tab === "characters" && !moderator ? api<Voice[]>("/admin/voices") : Promise.resolve(null),
      ]);
      if (version !== fetchEpoch.current) return;
      if (options) setVoiceOptions(options);
      if (presets) setVoicePresets(presets);
      setData(payload);
      setLoadedKey(requestKey);
      if (tab === "summary" || tab === "feedback") setQueue((payload as DashboardData).queue);
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
  }, [tab, moderator, days, requestKey]);
  useEffect(() => {
    const versions = fetchEpoch;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load updates state after the protected network response
    if (ready && user && user.role !== "user") void load();
    return () => { versions.current++; };
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
  function navigate(next: Tab, period = days) {
    if (next === tab && period === days) return;
    fetchEpoch.current++;
    setData(null);
    setBusy(true);
    setError("");
    setUsage(null);
    setMessage("");
    setEditor(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    params.set("days", String(period));
    for (const key of ["feedback", "compose", "message_page", "status", "kind", "q", "page"]) params.delete(key);
    if (next === tab) router.replace(`/admin?${params}`, { scroll: false });
    else router.push(`/admin?${params}`, { scroll: false });
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
  const dashboard = tab === "summary" ? data as DashboardData | null : null;
  const promptData = data as {
    tag_catalog: string[];
    versions: Prompt[];
  } | null;
  return (
    <AdminShell user={user} tab={tab} days={days} busy={busy} queue={queue}
      updatedAt={dashboard?.generated_at} onNavigate={navigate} onPeriod={(period) => navigate("summary", period)}
      onRefresh={() => { setBusy(true); setError(""); setFeedbackRefresh(value => value + 1); void load(); }}>
      {message && <p role="status" className="mb-5 rounded-xl border border-emerald-300/10 bg-emerald-300/5 p-3 text-sm text-emerald-300">{message}</p>}
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-2xl bg-danger/15 p-4 text-danger"
        >
          {error}
        </p>
      )}
      {tab === "summary" && !dashboard && busy && <DashboardSkeleton />}
      {dashboard && <AdminDashboard data={dashboard} onNavigate={navigate} />}
      {tab === "providers" && data !== null && !moderator && <ProviderPanel data={data as ProviderData} onReload={load} />}
      {tab === "feedback" && !moderator && <FeedbackWorkspace admin refreshKey={feedbackRefresh} onChanged={() => { void load(); }} />}
      {tab !== "summary" && data === null && busy && <p role="status" className="py-12 text-center text-sm text-fg-3">Đang tải dữ liệu…</p>}
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
                              "Ghi nhận khoản tiền đã hoàn bên ngoài; thu hồi kỳ gói tương ứng",
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
      {data !== null && tab === "plans" && <PromotionPanel />}
      {data !== null && tab === "plans" && (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
          {(data as Plan[])
            .filter((p) => p.active)
            .map((p) => (
              <section key={p.id} className="glass rounded-2xl p-5">
                <h2 className="text-xl font-semibold">
                  {p.label ?? p.code} · {p.price_vnd.toLocaleString("vi-VN")} ₫
                </h2>
                <PlanAvailabilityForm
                  key={`${p.code}:${p.enabled}:${p.discount_percent}:${p.promo_codes.join(",")}`}
                  plan={p}
                  busy={busy}
                  save={(body) =>
                    act(`/admin/plans/${p.code}/availability`, body, "PUT")
                  }
                />
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
                  Kỳ đã mua giữ phiên bản giới hạn lúc tạo đơn; bản mới áp dụng cho đơn sau.
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
              <p className="mb-3 text-sm text-fg-2">
                <span lang="vi">{v.description_vi}</span><br />
                <span lang="en">{v.description_en}</span>
              </p>
              <button
                className={button}
                onClick={() =>
                  edit("Preset giọng đọc", `/admin/voices/${v.id}`, "PATCH", {
                    name: v.name,
                    voice: v.voice,
                    style: v.style,
                    description_vi: v.description_vi,
                    description_en: v.description_en,
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
                <span className="font-semibold">
                  {c.name}
                </span>
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
                        scenario,
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
                          scenario: scenario ?? "",
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
              <ModerationPreview id={c.id} />
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
                voice: voiceOptions,
                voice_id: voicePresets.map((preset) => preset.id),
              };
              if (choices[key])
                return (
                  <label key={key} className="block text-sm">
                    {key}
                    <select
                      aria-label={key}
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
                        <option key={v} value={v} disabled={key === "voice_id" && !voicePresets.find((preset) => preset.id === v)?.enabled}>
                          {key === "voice_id" ? voicePresets.find((preset) => preset.id === v)?.name ?? v : v}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              return (
                <label key={String(options)} className="block text-sm">
                  {editorLabels[key] ?? key}
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
                      aria-label={editorLabels[key] ?? key}
                      required={!["style", "description_vi", "description_en", "seed", "scenario"].includes(key)}
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
      <div id="account-security" className="mt-8"><SecurityPanel /></div>
    </AdminShell>
  );
}
