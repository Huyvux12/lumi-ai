import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "PersonaX — Trò chuyện với những nhân vật có linh hồn",
  description: "Trò chuyện với Gojo, Naruto, Conan, Rem và cả một vũ trụ nhân vật biết cười, biết buồn, biết nhớ bạn. Trò chuyện, nhập vai và tự tạo nhân vật của riêng bạn.",
};

export default function WelcomePage() {
  return <Landing />;
}
