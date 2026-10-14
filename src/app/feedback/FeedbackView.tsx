"use client";
import Link from "next/link";
import { useAuthReady, useUser } from "@/lib/auth";
import { FeedbackWorkspace } from "@/components/FeedbackWorkspace";

export function FeedbackView() {
  const ready = useAuthReady();
  const user = useUser();
  if (!ready)
    return (
      <p role="status" className="p-8">
        Đang kiểm tra phiên…
      </p>
    );
  if (!user)
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="mb-4 text-2xl font-semibold">Góp ý & hỗ trợ</h1>
        <Link href="/login?next=/feedback" className="text-accent">
          Đăng nhập để gửi và theo dõi phản hồi
        </Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <FeedbackWorkspace key={user.id} />
    </div>
  );
}
