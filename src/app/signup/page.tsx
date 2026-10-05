import type { Metadata } from "next";
import { safeNext } from "@/lib/nav";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Đăng ký — PersonaX" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  return <SignupForm next={safeNext(next)} />;
}
