"use client";

import Link from "next/link";
import type { User } from "@/lib/auth";

export function PlanGate({ user }: { user: User }) {
  return (
    <section
      className="mx-auto max-w-lg space-y-5 px-5 py-20 text-center"
      aria-live="polite"
    >
      <h1 className="text-2xl font-semibold">Gói sử dụng của bạn</h1>
      <p className="text-fg-2">{user.plan_message}</p>
      <Link
        href="/billing"
        className="btn-glow inline-block rounded-full px-6 py-3 font-semibold"
      >
        {user.plan === "free" ? "Đăng kí gói Premium" : "Xem gói & thanh toán"}
      </Link>
      <p className="text-sm text-fg-3">
        Bạn vẫn có thể quản lý tài khoản và thanh toán.
      </p>
    </section>
  );
}
