import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedbackView } from "./FeedbackView";

export const metadata: Metadata = { title: "Góp ý & hỗ trợ — PersonaX" };
export default function FeedbackPage() {
  return (
    <Suspense fallback={<p className="p-8">Đang tải góp ý…</p>}>
      <FeedbackView />
    </Suspense>
  );
}
