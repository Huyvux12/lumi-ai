"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, CreditCard, Copy, QrCode } from "lucide-react";
import { api, mutation, requestId } from "@/lib/api";
import { refreshUser, useAuthReady, useUser } from "@/lib/auth";
import type { PublicPlan } from "@/lib/plans";
import { shouldPollOrder, BILLING_POLL_WINDOW_MS } from "@/lib/billing";
type Quote = {
  amount_vnd: number;
  list_price_vnd: number;
  discount_percent: number;
  promo_code: string | null;
};
type Order = {
  id: string;
  invoice: string;
  amount_vnd: number;
  status: string;
  expires_at: number;
  created_at: number;
  paid_at: number | null;
  qr_url: string;
  bank: string;
  account: string;
  holder: string;
  environment: string;
  list_price_vnd: number;
  discount_percent: number;
  promo_code: string | null;
};
type Subscription = {
  plan: string | null;
  ends_at: number | null;
  paid_until: number | null;
};
const money = (value: number) => value.toLocaleString("vi-VN") + " ₫";
const date = (value: number) => new Date(value).toLocaleString("vi-VN");
const statuses: Record<string, string> = {
  pending: "Chờ chuyển khoản",
  paid: "Đã thanh toán",
  expired: "QR hết hạn",
  review: "Cần đối soát",
  refunded: "Đã hoàn tiền",
  cancelled: "Đã hủy",
};
export function BillingView({ initialPromo = "" }: { initialPromo?: string }) {
  const user = useUser();
  return (
    <BillingAccount key={user?.id ?? "guest"} initialPromo={initialPromo} />
  );
}
function BillingAccount({ initialPromo }: { initialPromo: string }) {
  const user = useUser();
  const ready = useAuthReady();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [promoCode, setPromoCode] = useState(initialPromo.slice(0, 32));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [history, setHistory] = useState<Order[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const key = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    const refreshPlans = () => {
      void api<PublicPlan[]>("/plans")
        .then((list) => {
          if (live) setPlans(list);
        })
        .catch((error) => {
          if (live) setError(error.message);
        });
    };
    refreshPlans();
    window.addEventListener("focus", refreshPlans);
    window.addEventListener("lumi:plan-changed", refreshPlans);
    return () => {
      live = false;
      window.removeEventListener("focus", refreshPlans);
      window.removeEventListener("lumi:plan-changed", refreshPlans);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    if (user) {
      api<Order[]>("/billing/history")
        .then((list) => {
          if (live) {
            setHistory(list);
            setOrder(list.find((o) => shouldPollOrder(o)) ?? list.find((o) => ["expired", "review"].includes(o.status)) ?? null);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
      api<Subscription>("/billing/subscription")
        .then((s) => {
          if (live) setSubscription(s);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [ready, user]);
  const orderId = order?.id;
  const orderStatus = order?.status;
  const orderCreatedAt = order?.created_at;
  useEffect(() => {
    if (!orderId || !orderStatus || !orderCreatedAt || !shouldPollOrder({ status: orderStatus, created_at: orderCreatedAt })) return;
    let live = true;
    let failures = 0;
    const poll = async () => {
      try {
        const next = await api<Order>(`/billing/orders/${orderId}`);
        if (!live) return;
        setOrder(next);
        failures = 0;
        if (next.status === "paid") {
          key.current = null;
          await refreshUser();
          const [s, list] = await Promise.all([
            api<Subscription>("/billing/subscription"),
            api<Order[]>("/billing/history"),
          ]);
          if (live) {
            setSubscription(s);
            setHistory(list);
          }
        }
      } catch (e) {
        if (live && ++failures >= 3)
          setError(
            e instanceof Error ? e.message : "Chưa thể kiểm tra thanh toán.",
          );
      }
    };
    const timer = setInterval(() => {
      if (Date.now() >= orderCreatedAt + BILLING_POLL_WINDOW_MS) {
        clearInterval(timer);
        return;
      }
      void poll();
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [orderId, orderStatus, orderCreatedAt]);
  async function refreshPayment() {
    if (!order || busy) return;
    setBusy(true);
    setError("");
    try {
      setOrder(await api<Order>(`/billing/orders/${order.id}`));
      await refreshUser();
      const [s, list] = await Promise.all([api<Subscription>("/billing/subscription"), api<Order[]>("/billing/history")]);
      setSubscription(s);
      setHistory(list);
    } catch (error) { setError(error instanceof Error ? error.message : "Không thể kiểm tra thanh toán."); }
    finally { setBusy(false); }
  }
  async function applyCode() {
    if (!user || busy) return;
    setBusy(true);
    setError("");
    try {
      setQuote(
        await api<Quote>("/billing/quote", mutation({ promo_code: promoCode })),
      );
    } catch (error) {
      setQuote(null);
      setError(
        error instanceof Error ? error.message : "Không thể áp dụng mã.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function buy() {
    if (!user || busy) return;
    setBusy(true);
    setError("");
    key.current ??= requestId();
    try {
      const result = await api<Order>(
        "/billing/orders",
        mutation({ promo_code: promoCode }, key.current),
      );
      setOrder(result);
      setHistory((old) => [result, ...old.filter((o) => o.id !== result.id)]);
      if (result.status === "paid") {
        key.current = null;
        await refreshUser();
        setSubscription(await api<Subscription>("/billing/subscription"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa thể tạo QR.");
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setError(
        "Không thể sao chép. Bạn có thể chọn và sao chép nội dung bên dưới.",
      );
    }
  }
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <p className="mb-2 flex items-center gap-2 text-sm text-accent">
        <CreditCard className="size-4" />
        Gói của bạn
      </p>
      {user?.plan_message && (
        <p
          role="status"
          className="mt-5 rounded-2xl bg-amber-500/10 p-4 text-amber-200"
        >
          {user.plan_message}
        </p>
      )}
      <h1 className="text-3xl font-bold">
        Thêm không gian cho những câu chuyện
      </h1>
      <p className="mt-3 text-fg-2">
        Premium có hiệu lực 1 tháng từ lúc được xác nhận thanh toán. Gia hạn
        bằng chuyển khoản khi bạn muốn.
      </p>
      {subscription && (
        <p className="glass mt-6 rounded-2xl p-4">
          {subscription.plan ? "Gói tài khoản: " : "Chưa có gói sử dụng: "}
          <strong>
            {subscription.plan === "premium"
              ? "Premium"
              : subscription.plan === "free"
                ? "Free"
                : "Chờ thanh toán Premium"}
          </strong>
          {subscription.plan === "premium" && subscription.paid_until && (
            <> · Đã thanh toán đến {date(subscription.paid_until)}</>
          )}
          .
        </p>
      )}
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {plans.map((plan) => (
          <section
            key={plan.code}
            className={`glass rounded-3xl p-7 ${plan.code === "premium" ? "border-accent/50" : ""}`}
          >
            <h2 className="text-xl font-semibold">
              {plan.code === "premium" ? "Premium" : "Free"}
            </h2>
            <p className="my-5 text-3xl font-bold">
              {money(
                plan.code === "premium" && quote
                  ? quote.amount_vnd
                  : plan.price_vnd,
              )}
              {plan.code === "premium" && (
                <span className="text-sm font-normal text-fg-2">
                  {" "}
                  / 1 tháng
                </span>
              )}
            </p>
            {plan.closed_message && (
              <p className="mb-4 text-sm text-amber-200">
                {plan.closed_message}
              </p>
            )}
            {plan.code === "premium" && plan.enabled && user && (
              <div className="mb-5 space-y-3">
                <label className="block text-sm">
                  Mã giảm giá
                  <input
                    className="field mt-2"
                    maxLength={32}
                    value={promoCode}
                    disabled={busy || order?.status === "pending"}
                    onChange={(event) => {
                      setPromoCode(event.target.value);
                      setQuote(null);
                      key.current = null;
                    }}
                    placeholder="Nhập mã Premium"
                  />
                </label>
                <button
                  className="rounded-full border border-white/10 px-4 py-2 text-sm disabled:opacity-50"
                  disabled={busy || order?.status === "pending"}
                  onClick={() => void applyCode()}
                >
                  Áp dụng mã
                </button>
                {quote && (
                  <p className="text-sm text-accent">
                    Giảm {quote.discount_percent}% · Thanh toán{" "}
                    {money(quote.amount_vnd)}
                  </p>
                )}
                {!quote && plan.discount_percent > 0 && (
                  <p className="text-xs text-fg-3">
                    Mã hợp lệ được giảm {plan.discount_percent}%.
                  </p>
                )}
              </div>
            )}
            <p className="text-sm leading-relaxed text-fg-2">
              {plan.description}
            </p>
            <ul className="my-5 space-y-3 text-sm">
              {(plan.code === "premium"
                ? [
                    "Trò chuyện với giới hạn cao hơn",
                    "Tạo thêm nhân vật",
                    "Thêm thời lượng nghe và nhập giọng nói",
                  ]
                : [
                    "Khám phá các nhân vật",
                    "Trò chuyện với giới hạn cơ bản",
                    "Dùng thử nghe và nhập giọng nói",
                  ]
              ).map((item) => (
                <li key={item} className="flex gap-2">
                  <Check className="size-4 text-accent" />
                  {item}
                </li>
              ))}
            </ul>
            {plan.code === "premium" ? (
              user ? (
                <button
                  disabled={
                    !plan.enabled || busy || order?.status === "pending"
                  }
                  onClick={() => {
                    if (order && order.status !== "pending") key.current = null;
                    void buy();
                  }}
                  className="btn-glow w-full rounded-full p-3 font-semibold disabled:opacity-50"
                >
                  {!plan.enabled
                    ? "Chờ Premium mở lại"
                    : busy
                      ? "Đang tạo QR…"
                      : order?.status === "pending"
                        ? "QR đang chờ thanh toán"
                        : quote?.amount_vnd === 0
                          ? "Kích hoạt Premium"
                          : user.plan === "premium"
                            ? "Gia hạn thêm 1 tháng"
                            : "Nâng cấp bằng QR"}
                </button>
              ) : (
                <Link
                  href={
                    plan.enabled
                      ? "/signup?plan=premium&next=/billing"
                      : "/signup"
                  }
                  className="btn-glow block rounded-full p-3 text-center font-semibold"
                >
                  {plan.enabled ? "Đăng kí Premium" : "Xem trạng thái đăng ký"}
                </Link>
              )
            ) : (
              <p className="py-3 text-center text-sm text-fg-3">
                {!plan.enabled
                  ? "Chọn Premium để sử dụng tính năng hoặc chờ Free mở lại."
                  : user?.plan === "free"
                    ? "Gói hiện tại"
                    : "Bắt đầu miễn phí"}
              </p>
            )}
          </section>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl bg-danger/10 p-4 text-danger"
        >
          {error}
        </p>
      )}
      {order && (
        <section className="glass mt-8 rounded-3xl p-6" aria-live="polite">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <QrCode className="size-5" />
            Thanh toán Premium
          </h2>
          <p className="mt-2 text-accent">
            {statuses[order.status] ?? order.status}
          </p>
          {["pending", "expired", "review"].includes(order.status) && <button disabled={busy} onClick={() => void refreshPayment()} className="mt-3 text-accent">Kiểm tra lại thanh toán</button>}
          {order.promo_code && (
            <p className="mt-3 text-sm">
              Mã {order.promo_code} · Giảm {order.discount_percent}% từ{" "}
              {money(order.list_price_vnd)} · Thanh toán{" "}
              {money(order.amount_vnd)}
            </p>
          )}
          {order.status === "pending" ? (
            <div className="mt-5 grid items-start gap-6 sm:grid-cols-[240px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR generated by the bank transfer provider */}
              <img
                src={order.qr_url}
                alt={`QR chuyển khoản ${money(order.amount_vnd)}`}
                width={240}
                height={240}
                className="rounded-2xl bg-white p-3"
              />
              <div className="space-y-3 text-sm">
                <p>
                  Ngân hàng: <strong>{order.bank}</strong>
                </p>
                <p>
                  Chủ tài khoản: <strong>{order.holder}</strong>
                </p>
                <p>
                  Số tài khoản:{" "}
                  <strong className="select-all">{order.account}</strong>{" "}
                  <button
                    aria-label="Sao chép số tài khoản"
                    onClick={() => void copy(order.account)}
                  >
                    <Copy className="inline size-4" />
                  </button>
                </p>
                <p>
                  Số tiền: <strong>{money(order.amount_vnd)}</strong>
                </p>
                <p>
                  Nội dung:{" "}
                  <strong className="select-all">{order.invoice}</strong>{" "}
                  <button
                    aria-label="Sao chép nội dung"
                    onClick={() => void copy(order.invoice)}
                  >
                    <Copy className="inline size-4" />
                  </button>
                </p>
                {copied && <p className="text-accent">Đã sao chép.</p>}
                <p className="text-fg-2">
                  Giữ nguyên số tiền và nội dung chuyển khoản. PersonaX tự kiểm
                  tra xác nhận thanh toán.
                </p>
                <p className="text-fg-3">
                  QR có hiệu lực đến {date(order.expires_at)}.
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-fg-2">
              {order.status === "paid"
                ? "Premium đã được kích hoạt. Bạn có thể tiếp tục câu chuyện."
                : order.status === "review"
                  ? "Giao dịch cần được quản trị viên đối soát. Hãy cung cấp mã đơn khi liên hệ."
                  : "Bạn có thể tạo QR mới. Nếu đã chuyển tiền, hãy chờ hệ thống đối soát."}
            </p>
          )}
        </section>
      )}
      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold">Lịch sử thanh toán</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-fg-3">
                <tr>
                  <th className="p-3">Mã đơn</th>
                  <th>Ngày tạo</th>
                  <th>Số tiền</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {history.map((o) => (
                  <tr key={o.id} className="border-t border-white/10">
                    <td className="p-3">{o.invoice}</td>
                    <td>{date(o.created_at)}</td>
                    <td>{money(o.amount_vnd)}</td>
                    <td>{statuses[o.status] ?? o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
