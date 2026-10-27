import type { Metadata } from "next";
import { safeNext } from "@/lib/nav";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Đăng ký — PersonaX",
  description: "Trò chuyện với nhân vật AI bằng tiếng Việt, có giọng nói. Đăng ký bằng link mời để nhận 7 ngày Basic miễn phí.",
  openGraph: {
    title: "PersonaX — Nhận 7 ngày Basic miễn phí",
    description: "Trò chuyện với nhân vật AI bằng tiếng Việt, có giọng nói. Đăng ký bằng link mời của bạn bè.",
    siteName: "PersonaX",
    locale: "vi_VN",
    type: "website",
  },
};

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const { next, ref } = await searchParams;
  const code = typeof ref === "string" ? ref.trim().toUpperCase().slice(0, 12) : "";
  return <SignupForm next={safeNext(next)} invite={code} />;
}
