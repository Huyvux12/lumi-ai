import type { Metadata } from "next";
import { safeNext } from "@/lib/nav";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Đăng nhập — PersonaX" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNext(next)} />;
}
