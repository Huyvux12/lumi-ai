"use client";

import { useId, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Crown,
  Flag,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import type {
  AdminTab,
  BusinessDashboard,
  DashboardActivity,
  DashboardData,
  DashboardDay,
  DashboardQueue,
} from "./dashboard-types";

const number = (value: number) => value.toLocaleString("vi-VN");
const money = (value: number) => `${number(value)} ₫`;
const compact = (value: number) =>
  new Intl.NumberFormat("vi-VN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const shortDate = (value: string) =>
  `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const panel = "rounded-2xl border border-white/[0.07] bg-[#181a22]";

function Change({ value, previous }: { value: number; previous: number }) {
  if (!previous)
    return (
      <span className="text-fg-3">
        {value ? "Mới trong kỳ này" : "Chưa có thay đổi"}
      </span>
    );
  const difference = ((value - previous) / previous) * 100;
  const Icon = difference < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={`inline-flex items-center gap-1 ${difference < 0 ? "text-amber-300/80" : difference > 0 ? "text-emerald-300/80" : "text-fg-3"}`}
    >
      <Icon className="size-3" />
      {Math.abs(difference).toLocaleString("vi-VN", {
        maximumFractionDigits: 1,
      })}
      % <span className="ml-1 text-fg-3">so với kỳ trước</span>
    </span>
  );
}

function MetricCards({ data }: { data: BusinessDashboard }) {
  const { metrics, previous, period } = data;
  const cards = [
    {
      label: "Doanh thu",
      value: money(metrics.revenue_vnd),
      icon: CreditCard,
      color: "text-violet",
      tint: "bg-violet/10",
      detail: `Đơn đã thanh toán · ${period.days} ngày`,
      current: metrics.revenue_vnd,
      previous: previous.revenue_vnd,
      help: "Theo ngày thanh toán, chỉ tính đơn còn ở trạng thái đã thanh toán; không gồm đơn đã hoàn tiền. Thuộc môi trường SePay đang chọn.",
    },
    {
      label: "Người dùng mới",
      value: number(metrics.new_users),
      icon: UserPlus,
      color: "text-sky-300",
      tint: "bg-sky-300/10",
      detail: `Đăng ký trong ${period.days} ngày`,
      current: metrics.new_users,
      previous: previous.new_users,
      help: "Số tài khoản được tạo trong kỳ đã chọn.",
    },
    {
      label: "Người dùng hoạt động",
      value: number(metrics.active_users),
      icon: Users,
      color: "text-emerald-300",
      tint: "bg-emerald-300/10",
      detail: `Có sử dụng AI · ${period.days} ngày`,
      current: metrics.active_users,
      previous: previous.active_users,
      help: "Tài khoản có ít nhất một lượt chat, chuyển giọng nói hoặc đọc lời thoại hoàn tất trong kỳ. Mỗi tài khoản chỉ tính một lần.",
    },
    {
      label: "Premium đang hiệu lực",
      value: number(metrics.premium_users),
      icon: Crown,
      color: "text-amber-300",
      tint: "bg-amber-300/10",
      detail: "Trạng thái hiện tại",
      current: metrics.premium_users,
      previous: undefined,
      help: "Số tài khoản đang có kỳ Premium còn hiệu lực tại thời điểm cập nhật, không phụ thuộc bộ lọc ngày.",
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(
        ({
          label,
          value,
          icon: Icon,
          color,
          tint,
          detail,
          current,
          previous: previousValue,
          help,
        }) => (
          <section
            key={label}
            className={`${panel} relative overflow-hidden p-5`}
          >
            <div className="mb-5 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-fg-2">{label}</p>
              <span
                className={`grid size-8 place-items-center rounded-lg ${tint} ${color}`}
              >
                <Icon className="size-4" />
              </span>
            </div>
            <p
              className="text-[27px] font-semibold tracking-tight tabular-nums"
              data-testid={`metric-${label}`}
            >
              {value}
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-3">
              <span>{detail}</span>
              <span title={help} className="cursor-help">
                <CircleHelp className="size-3" aria-hidden="true" />
                <span className="sr-only">{help}</span>
              </span>
            </div>
            <div className="mt-5 border-t border-white/5 pt-3 text-[11px]">
              {previousValue === undefined ? (
                <span className="text-fg-3">
                  {number(metrics.total_users)} tài khoản trên hệ thống
                </span>
              ) : (
                <Change value={current} previous={previousValue} />
              )}
            </div>
          </section>
        ),
      )}
    </div>
  );
}

export function DashboardChart({
  series,
  mode,
}: {
  series: DashboardDay[];
  mode: "revenue" | "usage";
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const points = useRef<(SVGRectElement | null)[]>([]);
  const revenue = mode === "revenue";
  const title = revenue ? "Doanh thu theo ngày" : "Sử dụng AI theo ngày";
  const values = series.map((day) =>
    revenue
      ? day.revenue_vnd
      : day.chat_turns + day.stt_requests + day.tts_requests,
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  const max = Math.max(...values, 1);
  const top = Math.ceil(max / 4) * 4;
  const width = 350,
    height = 165,
    left = 48,
    bottom = 190;
  const step = width / Math.max(series.length - 1, 1);
  const x = (index: number) => left + index * step;
  const y = (value: number) => bottom - (value / top) * height;
  const line = values
    .map((value, index) => `${index ? "L" : "M"} ${x(index)} ${y(value)}`)
    .join(" ");
  const index =
    active !== null && active < series.length ? active : series.length - 1;
  const selected = series[index];
  return (
    <section
      className={`${panel} min-w-0 p-5 sm:p-6`}
      aria-labelledby={`${id}-title`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            {title}
          </h2>
          <p className="mt-1 text-[11px] text-fg-3">
            {revenue
              ? "Đơn đã thanh toán · VND"
              : "Lượt xử lý hoàn tất · Chat, STT và TTS"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">
            {revenue ? money(total) : `${number(total)} lượt`}
          </p>
          <p className="text-[10px] text-fg-3">Tổng trong kỳ</p>
        </div>
      </div>
      <div
        className="mb-3 flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/3 px-3 py-2 text-[11px]"
        aria-live="polite"
      >
        <span className="text-fg-3">
          {selected ? shortDate(selected.date) : "—"}
        </span>
        {selected &&
          (revenue ? (
            <span className="font-medium text-violet">
              {money(selected.revenue_vnd)}
            </span>
          ) : (
            <>
              <span className="text-violet">
                Chat {number(selected.chat_turns)}
              </span>
              <span className="text-sky-300">
                STT {number(selected.stt_requests)}
              </span>
              <span className="text-emerald-300">
                TTS {number(selected.tts_requests)}
              </span>
            </>
          ))}
      </div>
      <div className="relative">
        <svg
          viewBox="0 0 420 230"
          role="group"
          aria-label={title}
          className="block w-full overflow-visible"
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => (
            <g key={tick} aria-hidden="true">
              <line
                x1={left}
                x2={left + width}
                y1={y((top * tick) / 4)}
                y2={y((top * tick) / 4)}
                stroke="#ffffff"
                strokeOpacity="0.06"
                strokeDasharray="3 5"
              />
              <text
                x={left - 10}
                y={y((top * tick) / 4) + 3}
                textAnchor="end"
                fill="#71717a"
                fontSize="12"
              >
                {compact((top * tick) / 4)}
              </text>
            </g>
          ))}
          {revenue && values.length > 0 && (
            <g aria-hidden="true">
              <path
                d={`${line} L ${x(series.length - 1)} ${bottom} L ${left} ${bottom} Z`}
                fill={`url(#${id}-fill)`}
              />
              <path
                d={line}
                stroke="#a78bfa"
                fill="none"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          )}
          {!revenue &&
            series.map((day, i) => {
              const barWidth = Math.min(16, (width / series.length) * 0.6);
              let stack = 0;
              return (
                <g key={day.date} aria-hidden="true">
                  {[
                    [day.chat_turns, "#a78bfa"],
                    [day.stt_requests, "#7dd3fc"],
                    [day.tts_requests, "#6ee7b7"],
                  ].map(([value, color], j) => {
                    const amount = Number(value);
                    stack += amount;
                    return (
                      <rect
                        key={j}
                        x={x(i) - barWidth / 2}
                        y={y(stack)}
                        width={barWidth}
                        height={(amount / top) * height}
                        fill={String(color)}
                        rx="1"
                        opacity={active === null || active === i ? 0.9 : 0.45}
                      />
                    );
                  })}
                </g>
              );
            })}
          {active !== null && selected && (
            <g aria-hidden="true">
              <line
                x1={x(index)}
                x2={x(index)}
                y1="20"
                y2={bottom}
                stroke="#a78bfa"
                strokeOpacity="0.35"
              />
              {revenue && (
                <circle
                  cx={x(index)}
                  cy={y(values[index])}
                  r="4"
                  fill="#a78bfa"
                  stroke="#181a22"
                  strokeWidth="2"
                />
              )}
            </g>
          )}
          {series.map((day, i) => (
            <rect
              key={day.date}
              ref={(element) => {
                points.current[i] = element;
              }}
              x={Math.max(0, x(i) - step / 2)}
              y="15"
              width={Math.min(step, width)}
              height={height + 20}
              fill="transparent"
              role="button"
              tabIndex={i === (active ?? 0) ? 0 : -1}
              aria-label={`${shortDate(day.date)}: ${revenue ? money(day.revenue_vnd) : `Chat ${day.chat_turns}, STT ${day.stt_requests}, TTS ${day.tts_requests}`}`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              onKeyDown={(event) => {
                if (["Enter", " "].includes(event.key)) {
                  event.preventDefault();
                  setActive(i);
                  return;
                }
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? series.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            series.length - 1,
                            i + (event.key === "ArrowLeft" ? -1 : 1),
                          ),
                        );
                points.current[next]?.focus();
              }}
              className="cursor-crosshair outline-none focus:stroke-violet/30"
            />
          ))}
          {[0, Math.floor((series.length - 1) / 2), series.length - 1]
            .filter((value, i, all) => value >= 0 && all.indexOf(value) === i)
            .map((i) => (
              <text
                key={i}
                x={x(i)}
                y="217"
                textAnchor={
                  i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"
                }
                fill="#71717a"
                fontSize="12"
                aria-hidden="true"
              >
                {shortDate(series[i].date)}
              </text>
            ))}
        </svg>
        {!total && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center pb-8 text-xs text-fg-3">
            {revenue
              ? "Chưa có doanh thu trong kỳ này"
              : "Chưa có lượt sử dụng trong kỳ này"}
          </p>
        )}
      </div>
      <p className="mt-2 text-[10px] text-fg-3">
        Giờ Việt Nam · Di chuột hoặc dùng phím ← → để xem từng ngày.
      </p>
    </section>
  );
}

function Queue({
  queue,
  onNavigate,
}: {
  queue: DashboardQueue;
  onNavigate: (tab: AdminTab) => void;
}) {
  const entries = [
    {
      tab: "characters" as const,
      label: "Nhân vật chờ duyệt",
      detail: "Nội dung công khai cần kiểm duyệt",
      count: queue.characters_pending,
      icon: Sparkles,
      color: "text-violet",
      tint: "bg-violet/10",
    },
    {
      tab: "reports" as const,
      label: "Báo cáo chưa xử lý",
      detail: "Phản hồi từ cộng đồng",
      count: queue.reports_open,
      icon: Flag,
      color: "text-amber-300",
      tint: "bg-amber-300/10",
    },
    ...(queue.payments_review === undefined
      ? []
      : [
          {
            tab: "orders" as const,
            label: "Giao dịch cần đối soát",
            detail: "Giao dịch được ghi nhận để kiểm tra",
            count: queue.payments_review,
            icon: CreditCard,
            color: "text-sky-300",
            tint: "bg-sky-300/10",
          },
        ]),
    ...(queue.feedback_new === undefined
      ? []
      : [
          {
            tab: "feedback" as const,
            label: "Phản hồi mới từ người dùng",
            detail: "Báo lỗi, đề xuất và góp ý cần tiếp nhận",
            count: queue.feedback_new,
            icon: Flag,
            color: "text-violet",
            tint: "bg-violet/10",
          },
        ]),
  ];
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <section className={`${panel} p-5 sm:p-6`}>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Cần xử lý</h2>
        <span
          className={`rounded-md px-2 py-1 text-[10px] ${total ? "bg-amber-300/10 text-amber-300" : "bg-emerald-300/10 text-emerald-300"}`}
        >
          {total ? `${number(total)} mục` : "Đã xử lý hết"}
        </span>
      </div>
      <p className="mb-5 text-[11px] text-fg-3">
        Hàng chờ hiện tại · Không phụ thuộc kỳ thống kê
      </p>
      <div className="space-y-2">
        {entries.map(
          ({ tab, label, detail, count, icon: Icon, color, tint }) => (
            <button
              type="button"
              key={tab}
              onClick={() => onNavigate(tab)}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/2 p-3.5 text-left transition-colors hover:border-white/12 hover:bg-white/4"
            >
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-xl ${tint} ${color}`}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{label}</span>
                <span className="mt-1 block text-[10px] text-fg-3">
                  {detail}
                </span>
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {number(count)}
              </span>
              <ChevronRight className="size-4 text-fg-3 transition-transform group-hover:translate-x-0.5" />
            </button>
          ),
        )}
      </div>
    </section>
  );
}

const actionLabels: Record<string, string> = {
  "feedback.update": "Cập nhật phản hồi",
  "feedback.reply": "Trả lời phản hồi",
  "feedback.note": "Ghi chú phản hồi",
  "character.moderate": "Kiểm duyệt nhân vật",
  "catalog.update": "Cập nhật hồ sơ nhân vật",
  "scene.create": "Tạo bối cảnh",
  "scene.update": "Cập nhật bối cảnh",
  "report.close": "Xử lý báo cáo",
  "user.update": "Cập nhật tài khoản",
  "plan.availability": "Thay đổi cấu hình gói",
  "plan.version": "Cập nhật giới hạn gói",
  "order.reconcile": "Đối soát thanh toán",
  "order.refund_recorded": "Ghi nhận hoàn tiền",
  "voice.update": "Cập nhật giọng đọc",
  "prompt.draft": "Tạo bản nháp prompt",
  "prompt.publish": "Xuất bản prompt",
  "prompt.test": "Thử nghiệm prompt",
};
function RecentActivity({
  activity,
  admin,
  onNavigate,
}: {
  activity: DashboardActivity[];
  admin: boolean;
  onNavigate: (tab: AdminTab) => void;
}) {
  return (
    <section className={`${panel} p-5 sm:p-6`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Hoạt động gần đây</h2>
        {admin && (
          <button
            type="button"
            onClick={() => onNavigate("audit")}
            className="flex items-center gap-1 text-[11px] text-violet hover:text-fg"
          >
            Xem nhật ký <ArrowRight className="size-3" />
          </button>
        )}
      </div>
      {!activity.length ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-fg-3">
          <Clock3 className="size-6" />
          <p className="text-xs">Chưa có hoạt động quản trị</p>
        </div>
      ) : (
        <ol className="space-y-4">
          {activity.map((item) => (
            <li key={item.id} className="flex gap-3">
              <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-white/4">
                <Activity className="size-3 text-fg-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {actionLabels[item.action] ?? "Cập nhật hệ thống"}
                </p>
                <p className="mt-1 truncate text-[10px] text-fg-3">
                  {item.actor ? `@${item.actor}` : "Hệ thống"} · {item.target}
                </p>
              </div>
              <time
                dateTime={new Date(item.created_at).toISOString()}
                className="shrink-0 text-[10px] text-fg-3"
              >
                {new Date(item.created_at).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Operations({ data }: { data: BusinessDashboard }) {
  const { usage, services } = data;
  const features = [
    {
      label: "Chat",
      value: `${number(usage.chat_turns)} lượt`,
      icon: MessageSquare,
      color: "text-violet",
    },
    {
      label: "Chuyển giọng nói",
      value: `${(usage.stt_ms / 60000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} phút`,
      icon: AudioLines,
      color: "text-sky-300",
    },
    {
      label: "Đọc lời thoại",
      value: `${(usage.tts_ms / 60000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} phút`,
      icon: AudioLines,
      color: "text-emerald-300",
    },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
      <section className={`${panel} p-5 sm:p-6`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Sử dụng & chi phí AI</h2>
          <span className="text-[10px] text-fg-3">Trong kỳ đã chọn</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {features.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl bg-white/3 p-3">
              <div className="mb-3 flex items-center gap-2 text-[11px] text-fg-2">
                <Icon className={`size-3.5 ${color}`} />
                {label}
              </div>
              <p className="text-base font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-white/5 pt-4">
          <div>
            <p className="text-[11px] text-fg-3">Chi phí LLM ước tính</p>
            <p className="mt-1 text-xl font-semibold">
              {usage.llm_estimated_usd.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}
            </p>
          </div>
          <p className="text-[10px] text-fg-3">
            {compact(usage.input_tokens)} token vào ·{" "}
            {compact(usage.output_tokens)} token ra
          </p>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-fg-3">
          Ước tính theo Qwen 3.8, chưa gồm STT/TTS. Chi phí thực tế cần đối
          chiếu hóa đơn dịch vụ. {number(usage.released_requests)} yêu cầu chưa
          hoàn tất, gồm hủy, lỗi hoặc hết hạn.
        </p>
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Cấu hình dịch vụ</h2>
          <ShieldCheck className="size-4 text-fg-3" />
        </div>
        <div className="space-y-3">
          {[
            ["Groq · Chat & STT", services.groq],
            ["Gemini · Đọc lời thoại", services.tts],
            ["SePay · Thanh toán", services.sepay],
          ].map(([label, configured]) => (
            <div
              className="flex items-center justify-between gap-3"
              key={String(label)}
            >
              <span className="text-xs text-fg-2">{label}</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] ${configured ? "bg-emerald-300/8 text-emerald-300/80" : "bg-amber-300/8 text-amber-300/80"}`}
              >
                {configured && <Check className="size-3" />}
                {configured ? "Đã cấu hình" : "Chưa cấu hình"}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/5 pt-4">
          <span className="rounded-md bg-white/4 px-2 py-1 text-[10px] text-fg-2">
            SePay:{" "}
            {services.sepay_environment === "live" ? "Thực tế" : "Thử nghiệm"}
          </span>
          {services.demo_llm && (
            <span className="rounded-md bg-amber-300/10 px-2 py-1 text-[10px] text-amber-300">
              Chat demo đang bật
            </span>
          )}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-fg-3">
          Trạng thái phản ánh cấu hình hiện có, chưa xác nhận kết nối trực tiếp
          đến dịch vụ.
        </p>
      </section>
    </div>
  );
}

export function AdminDashboard({
  data,
  onNavigate,
}: {
  data: DashboardData;
  onNavigate: (tab: AdminTab) => void;
}) {
  return (
    <div className="space-y-5" data-testid="admin-dashboard">
      {data.scope === "admin" && (
        <>
          <MetricCards data={data} />
          <p className="text-[10px] text-fg-3">
            {shortDate(data.period.start)} – {shortDate(data.period.end)} · Gồm
            hôm nay, ngày hiện tại chưa kết thúc. So sánh với {data.period.days}{" "}
            ngày liền trước.
          </p>
          <div className="grid gap-5 xl:grid-cols-2">
            <DashboardChart series={data.series} mode="revenue" />
            <DashboardChart series={data.series} mode="usage" />
          </div>
        </>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <Queue queue={data.queue} onNavigate={onNavigate} />
        <RecentActivity
          activity={data.activity}
          admin={data.scope === "admin"}
          onNavigate={onNavigate}
        />
      </div>
      {data.scope === "admin" && <Operations data={data} />}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Đang tải tổng quan" className="space-y-5">
      <span className="sr-only">Đang tải tổng quan…</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`${panel} h-44 animate-pulse motion-reduce:animate-none`}
          />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className={`${panel} h-80 animate-pulse motion-reduce:animate-none`}
          />
        ))}
      </div>
    </div>
  );
}
