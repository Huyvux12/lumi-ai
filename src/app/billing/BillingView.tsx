"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, CreditCard, Copy, QrCode } from "lucide-react";
import { api, mutation, requestId } from "@/lib/api";
import { refreshUser, useAuthReady, useUser } from "@/lib/auth";
import {
  PLAN_META,
  planLabel,
  type PaidPlanCode,
  type PlanCode,
  type PublicPlan,
} from "@/lib/plans";
import { shouldPollOrder, BILLING_POLL_WINDOW_MS } from "@/lib/billing";
type Quote = {
  plan: PaidPlanCode;
  upgrade: boolean;
  amount_vnd: number;
  list_price_vnd: number;
  discount_percent: number;
  credit_vnd: number;
  promo_code: string | null;
};
type Order = {
  id: string;
  plan: PaidPlanCode | null;
  plan_label: string | null;
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
  credit_vnd: number;
  promo_code: string | null;
};
type Subscription = {
  plan: string | null;
  plan_label: string | null;
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
const isPaid = (code: string): code is PaidPlanCode =>
  code in PLAN_META && PLAN_META[code as PaidPlanCode].paid;
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
  const [promos, setPromos] = useState<Partial<Record<PaidPlanCode, string>>>(
    () => {
      const code = initialPromo.slice(0, 32);
      return code ? { basic: code, plus: code, premium: code } : {};
    },
  );
  const [quotes, setQuotes] = useState<Partial<Record<PaidPlanCode, Quote>>>(
    {},
  );
  const [order, setOrder] = useState<Order | null>(null);
  const [history, setHistory] = useState<Order[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PaidPlanCode | "refresh" | null>(null);
  const [copied, setCopied] = useState("");
  // One idempotency key per attempted purchase, reset when the plan or promo changes.
  const key = useRef<{ plan: PaidPlanCode; value: string } | null>(null);
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
  // Price every open paid tier for this account so upgrade credit shows up front.
  // Promo edits re-quote one card at a time through applyCode.
  useEffect(() => {
    if (!user) return;
    let live = true;
    const promo = initialPromo.slice(0, 32);
    const price = (code: PlanCode, promo_code: string) =>
      api<Quote>("/billing/quote", mutation({ plan: code, promo_code }));
    void Promise.all(
      plans
        .filter((plan) => plan.enabled && isPaid(plan.code))
        .map((plan) =>
          price(plan.code, promo)
            .catch(() => (promo ? price(plan.code, "") : null))
            .catch(() => null),
        ),
    ).then((results) => {
      if (live)
        setQuotes(
          Object.fromEntries(
            results.filter((q): q is Quote => q !== null).map((q) => [q.plan, q]),
          ),
        );
    });
    return () => {
      live = false;
    };
  }, [user, plans, initialPromo, subscription?.plan]);
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
    setBusy("refresh");
    setError("");
    try {
      setOrder(await api<Order>(`/billing/orders/${order.id}`));
      await refreshUser();
      const [s, list] = await Promise.all([api<Subscription>("/billing/subscription"), api<Order[]>("/billing/history")]);
      setSubscription(s);
      setHistory(list);
    } catch (error) { setError(error instanceof Error ? error.message : "Không thể kiểm tra thanh toán."); }
    finally { setBusy(null); }
  }
  async function applyCode(code: PaidPlanCode) {
    if (!user || busy) return;
    setBusy(code);
    setError("");
    try {
      const result = await api<Quote>(
        "/billing/quote",
        mutation({ plan: code, promo_code: promos[code] ?? "" }),
      );
      setQuotes((old) => ({ ...old, [code]: result }));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Không thể áp dụng mã.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function buy(code: PaidPlanCode) {
    if (!user || busy) return;
    setBusy(code);
    setError("");
    if (key.current?.plan !== code) key.current = { plan: code, value: requestId() };
    try {
      const result = await api<Order>(
        "/billing/orders",
        mutation({ plan: code, promo_code: promos[code] ?? "" }, key.current.value),
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
      setBusy(null);
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
  const current = user?.plan ?? null;
  const currentRank = current ? PLAN_META[current].rank : 0;
  const pending = order?.status === "pending";
  function action(plan: PublicPlan, code: PaidPlanCode) {
    const label = PLAN_META[code].label;
    const rank = PLAN_META[code].rank;
    if (!plan.enabled) return "Tạm hết chỗ";
    if (busy === code) return "Đang tạo QR…";
    if (pending) return "QR đang chờ thanh toán";
    if (quotes[code]?.amount_vnd === 0) return `Kích hoạt ${label}`;
    if (current === code) return "Gia hạn thêm 1 tháng";
    if (currentRank > 0 && rank > currentRank) return "Nâng cấp ngay";
    if (currentRank > 0 && rank < currentRank)
      return "Chuyển sau khi gói hiện tại hết hạn";
    return `Đăng ký ${label} bằng QR`;
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
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
        Mỗi gói có hiệu lực 1 tháng từ lúc được xác nhận thanh toán. Nâng lên
        gói cao hơn có hiệu lực ngay và được trừ phần tiền còn lại của gói cũ.
      </p>
      {subscription && (
        <p className="glass mt-6 rounded-2xl p-4">
          Gói tài khoản:{" "}
          <strong>{subscription.plan_label ?? planLabel(subscription.plan)}</strong>
          {subscription.plan &&
            isPaid(subscription.plan) &&
            subscription.paid_until && (
              <> · Đã thanh toán đến {date(subscription.paid_until)}</>
            )}
          .
        </p>
      )}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const code = plan.code;
          const paid = isPaid(code);
          const quote = paid ? quotes[code] : undefined;
          return (
            <section
              key={code}
              className={`glass flex flex-col rounded-3xl p-6 ${current === code ? "border-accent/60" : code === "plus" ? "border-accent/30" : ""}`}
            >
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                {plan.label ?? planLabel(code)}
                {current === code && (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                    Đang dùng
                  </span>
                )}
                {code === "plus" && current !== code && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-fg-2">
                    Phổ biến
                  </span>
                )}
              </h2>
              <p className="my-4 flex flex-wrap items-baseline gap-x-1 text-3xl font-bold lg:text-2xl xl:text-[1.7rem]">
                <span className="whitespace-nowrap">
                  {money(quote ? quote.amount_vnd : plan.price_vnd)}
                </span>
                {paid && (
                  <span className="whitespace-nowrap text-sm font-normal text-fg-2">
                    / tháng
                  </span>
                )}
              </p>
              {quote && quote.amount_vnd !== plan.price_vnd && (
                <p className="-mt-2 mb-4 text-xs text-fg-3">
                  Giá gốc {money(plan.price_vnd)}
                  {quote.discount_percent > 0 &&
                    ` · Giảm ${quote.discount_percent}%`}
                  {quote.credit_vnd > 0 &&
                    ` · Trừ ${money(quote.credit_vnd)} còn lại của gói ${planLabel(current)}`}
                </p>
              )}
              {plan.closed_message && (
                <p className="mb-4 text-sm text-amber-200">
                  {code === "free" && !plan.enabled
                    ? "Đang tạm đầy. Tài khoản mới sẽ xếp hàng và tự được mở khi có chỗ."
                    : plan.closed_message}
                </p>
              )}
              <p className="text-sm leading-relaxed text-fg-2">
                {plan.description}
              </p>
              <ul className="my-5 space-y-3 text-sm">
                {PLAN_META[code].features.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check className="size-4 shrink-0 text-accent" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                {paid && plan.enabled && user && (
                  <div className="mb-4 space-y-2">
                    <label className="block text-sm">
                      Mã giảm giá
                      <span className="mt-2 flex gap-2">
                        <input
                          className="field min-w-0 flex-1"
                          maxLength={32}
                          value={promos[code] ?? ""}
                          disabled={!!busy || pending}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPromos((old) => ({ ...old, [code]: value }));
                            if (key.current?.plan === code) key.current = null;
                          }}
                          placeholder="Nhập mã"
                        />
                        <button
                          type="button"
                          className="rounded-full border border-white/10 px-3 text-sm disabled:opacity-50"
                          disabled={!!busy || pending}
                          onClick={() => void applyCode(code)}
                        >
                          Áp dụng
                        </button>
                      </span>
                    </label>
                    {!quote?.discount_percent && plan.discount_percent > 0 && (
                      <p className="text-xs text-fg-3">
                        Mã hợp lệ được giảm {plan.discount_percent}%.
                      </p>
                    )}
                  </div>
                )}
                {paid ? (
                  user ? (
                    <button
                      disabled={!plan.enabled || !!busy || pending}
                      onClick={() => {
                        if (order && order.status !== "pending") key.current = null;
                        void buy(code);
                      }}
                      className="btn-glow w-full rounded-full p-3 font-semibold disabled:opacity-50"
                    >
                      {action(plan, code)}
                    </button>
                  ) : (
                    <Link
                      href="/signup?next=/billing"
                      className="btn-glow block rounded-full p-3 text-center font-semibold"
                    >
                      Tạo tài khoản để đăng ký
                    </Link>
                  )
                ) : (
                  <p className="py-3 text-center text-sm text-fg-3">
                    {current === "free" ? "Gói hiện tại" : user ? "Miễn phí" : (
                      <Link href="/signup" className="text-accent hover:underline">
                        Bắt đầu miễn phí
                      </Link>
                    )}
                  </p>
                )}
              </div>
            </section>
          );
        })}
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
            Thanh toán gói {order.plan_label ?? planLabel(order.plan)}
          </h2>
          <p className="mt-2 text-accent">
            {statuses[order.status] ?? order.status}
          </p>
          {["pending", "expired", "review"].includes(order.status) && <button disabled={!!busy} onClick={() => void refreshPayment()} className="mt-3 text-accent">Kiểm tra lại thanh toán</button>}
          {(order.promo_code || order.credit_vnd > 0) && (
            <p className="mt-3 text-sm">
              Giá gốc {money(order.list_price_vnd)}
              {order.promo_code &&
                ` · Mã ${order.promo_code} giảm ${order.discount_percent}%`}
              {order.credit_vnd > 0 &&
                ` · Trừ ${money(order.credit_vnd)} còn lại của gói cũ`}
              {" · "}Thanh toán {money(order.amount_vnd)}
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
                ? `Gói ${order.plan_label ?? planLabel(order.plan)} đã được kích hoạt. Bạn có thể tiếp tục câu chuyện.`
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
                  <th>Gói</th>
                  <th>Ngày tạo</th>
                  <th>Số tiền</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {history.map((o) => (
                  <tr key={o.id} className="border-t border-white/10">
                    <td className="p-3">{o.invoice}</td>
                    <td>{o.plan_label ?? planLabel(o.plan)}</td>
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
