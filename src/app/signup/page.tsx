import type { Metadata } from "next";
import { safeNext } from "@/lib/nav";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Đăng ký — PersonaX" };

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const { next, ref } = await searchParams;
  const code = typeof ref === "string" ? ref.trim().toUpperCase().slice(0, 12) : "";
  return <SignupForm next={safeNext(next)} invite={code} />;
}
