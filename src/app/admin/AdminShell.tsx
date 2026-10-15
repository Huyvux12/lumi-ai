"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  Activity,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CreditCard,
  FileText,
  LayoutDashboard,
  Menu,
  MessageSquareWarning,
  MessageSquare,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Server,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { User } from "@/lib/auth";
import type { AdminTab, DashboardQueue } from "./dashboard-types";

export const adminLabels: Record<AdminTab, string> = {
  summary: "Tổng quan",
  users: "Người dùng & quota",
  orders: "Thanh toán",
  plans: "Gói & giới hạn",
  characters: "Nhân vật",
  scenes: "Bối cảnh",
  reports: "Báo cáo",
  feedback: "Phản hồi người dùng",
  voices: "Giọng đọc",
  providers: "Nhà cung cấp AI",
  prompts: "System prompt",
  audit: "Nhật ký",
};
const groups = [
  {
    label: "KHÔNG GIAN LÀM VIỆC",
    items: [
      { id: "summary", icon: LayoutDashboard },
      { id: "feedback", icon: MessageSquare },
    ],
  },
  {
    label: "KINH DOANH",
    items: [
      { id: "users", icon: Users },
      { id: "orders", icon: CreditCard },
      { id: "plans", icon: Settings2 },
    ],
  },
  {
    label: "NỘI DUNG",
    items: [
      { id: "characters", icon: Sparkles },
      { id: "scenes", icon: BookOpen },
      { id: "reports", icon: MessageSquareWarning },
    ],
  },
  {
    label: "AI & VẬN HÀNH",
    items: [
      { id: "providers", icon: Server },
      { id: "voices", icon: AudioLines },
      { id: "prompts", icon: FileText },
      { id: "audit", icon: Activity },
    ],
  },
] as const;
const roles: Record<string, string> = {
  owner: "Chủ hệ thống",
  admin: "Quản trị viên",
  moderator: "Kiểm duyệt viên",
};

type Props = {
  user: User;
  tab: AdminTab;
  days: number;
  busy: boolean;
  updatedAt?: number;
  queue?: DashboardQueue;
  onNavigate: (tab: AdminTab) => void;
  onPeriod: (days: number) => void;
  onRefresh: () => void;
  children: React.ReactNode;
};

export function AdminShell({
  user,
  tab,
  days,
  busy,
  updatedAt,
  queue,
  onNavigate,
  onPeriod,
  onRefresh,
  children,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const moderator = user.role === "moderator";
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      if (media.matches) dialog.current?.close();
    };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  function navigate(next: AdminTab) {
    dialog.current?.close();
    onNavigate(next);
  }
  const navigation = (
    <div className="flex h-full flex-col">
      <Link
        href="/admin"
        className="flex items-center gap-3 px-6 pb-8 pt-8"
        aria-label="PersonaX quản trị"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-violet/15 text-violet">
          <Sparkles className="size-5" />
        </span>
        <span>
          <span className="block text-lg font-semibold tracking-tight">
            Persona<span className="text-violet">X</span>
          </span>
          <span className="text-[10px] font-medium tracking-[0.22em] text-fg-3">
            ADMIN WORKSPACE
          </span>
        </span>
      </Link>
      <nav aria-label="Trang quản trị" className="flex-1 overflow-y-auto px-3">
        {groups.map((group) => {
          const items = group.items.filter(
            ({ id }) =>
              !moderator ||
              ["summary", "characters", "scenes", "reports"].includes(id),
          );
          if (!items.length) return null;
          return (
            <div className="mb-6" key={group.label}>
              <p className="mb-2 px-3 text-[10px] font-medium tracking-[0.15em] text-fg-3">
                {group.label}
              </p>
              {items.map(({ id, icon: Icon }) => {
                const count =
                  id === "characters"
                    ? queue?.characters_pending
                    : id === "reports"
                      ? queue?.reports_open
                      : id === "feedback"
                        ? queue?.feedback_new
                        : id === "orders"
                          ? queue?.payments_review
                          : undefined;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => navigate(id)}
                    disabled={busy}
                    aria-label={adminLabels[id]}
                    aria-pressed={tab === id}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-wait ${tab === id ? "bg-violet/12 font-medium text-violet ring-1 ring-violet/15" : "text-fg-2 hover:bg-white/5 hover:text-fg"}`}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                    <span className="flex-1">{adminLabels[id]}</span>
                    {!!count && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${tab === id ? "bg-violet/15" : "bg-white/6 text-fg-2"}`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="mx-4 border-t border-white/6 py-4">
        <Link
          href="/"
          className="mb-4 flex items-center justify-between px-2 text-xs text-fg-2 hover:text-fg"
        >
          Về ứng dụng <ArrowUpRight className="size-3.5" />
        </Link>
        <a
          href="#account-security"
          onClick={() => dialog.current?.close()}
          className="flex items-center gap-3 rounded-xl bg-white/3 p-3"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-violet/15 text-sm font-semibold text-violet">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">
              {user.name}
            </span>
            <span className="text-[10px] text-fg-3">
              {roles[user.role] ?? user.role}
            </span>
          </span>
          <ShieldCheck
            className="size-4 text-fg-3"
            aria-label="Bảo mật tài khoản"
          />
        </a>
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh bg-[#111217] text-fg">
      <a
        href="#admin-content"
        className="sr-only z-50 rounded-lg bg-violet px-3 py-2 text-sm text-black focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Bỏ qua tới nội dung quản trị
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/6 bg-[#15161c] lg:block">
        {navigation}
      </aside>
      <dialog
        ref={dialog}
        aria-label="Menu quản trị"
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[90vw] border-0 bg-[#15161c] p-0 text-fg backdrop:bg-black/65"
      >
        <button
          type="button"
          aria-label="Đóng menu quản trị"
          onClick={() => dialog.current?.close()}
          className="absolute right-3 top-3 rounded-lg p-2 text-fg-2 hover:bg-white/5"
        >
          <X className="size-4" />
        </button>
        {navigation}
      </dialog>
      <div className="lg:pl-64">
        <header className="flex h-16 items-center justify-between border-b border-white/6 bg-[#15161c]/80 px-4 sm:px-8">
          <div className="flex items-center gap-3 text-xs text-fg-3">
            <button
              type="button"
              aria-label="Mở menu quản trị"
              onClick={() => dialog.current?.showModal()}
              className="rounded-lg p-2 text-fg-2 hover:bg-white/5 lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <ShieldCheck className="hidden size-4 sm:block" />
            <span>Quản trị</span>
            <ChevronRight className="size-3" />
            <span className="text-fg-2">{adminLabels[tab]}</span>
          </div>
          <span className="rounded-full border border-violet/15 bg-violet/8 px-3 py-1 text-[11px] font-medium text-violet">
            {roles[user.role] ?? user.role}
          </span>
        </header>
        <div
          id="admin-content"
          tabIndex={-1}
          className="mx-auto max-w-[1520px] p-4 outline-none sm:p-8 xl:p-10"
        >
          <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="mb-2 text-[10px] font-medium tracking-[0.18em] text-fg-3">
                TRUNG TÂM ĐIỀU HÀNH
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {adminLabels[tab]}
              </h1>
              <p className="mt-2 text-sm text-fg-2">
                {tab === "summary"
                  ? moderator
                    ? "Hàng chờ nội dung và báo cáo cần bạn xử lý."
                    : "Hoạt động, doanh thu và những việc cần bạn xử lý."
                  : "Quản lý và cập nhật dữ liệu trên hệ thống."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {tab === "summary" && !moderator && (
                <div
                  className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/3 p-1"
                  aria-label="Kỳ thống kê"
                >
                  <CalendarDays className="mx-2 size-4 text-fg-3" />
                  {[7, 30, 90].map((period) => (
                    <button
                      type="button"
                      key={period}
                      disabled={busy}
                      aria-pressed={days === period}
                      onClick={() => onPeriod(period)}
                      className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${days === period ? "bg-violet/15 text-violet" : "text-fg-2 hover:text-fg"}`}
                    >
                      {period} ngày
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={onRefresh}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/4 px-3.5 py-2.5 text-xs font-medium transition hover:bg-white/8 disabled:opacity-60"
              >
                <RefreshCw
                  className={`size-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
                />
                {busy ? "Đang tải…" : "Làm mới"}
              </button>
            </div>
          </div>
          {updatedAt && tab === "summary" && (
            <p className="mb-5 text-[11px] text-fg-3">
              Cập nhật{" "}
              {new Date(updatedAt).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
                hour: "2-digit",
                minute: "2-digit",
                day: "2-digit",
                month: "2-digit",
              })}{" "}
              · Giờ Việt Nam
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
