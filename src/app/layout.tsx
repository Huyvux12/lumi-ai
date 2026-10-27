import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

export const metadata: Metadata = {
  // Absolute base for Open Graph images shared on Facebook and Zalo.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://personaxai.tech"),
  title: "PersonaX — Khám phá nhân vật AI",
  description: "Khám phá và trò chuyện nhập vai với nhân vật anime, game và nhân vật AI của riêng bạn.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
