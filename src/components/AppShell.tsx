"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Compass, LogIn, Menu, Plus, Search, Sparkles, UserRound, X } from "lucide-react";
import { loadRecent } from "@/lib/chat/client";
import { useUser } from "@/lib/auth";
import { useHydrated } from "@/lib/store";
import { CHARS_EVENT, resolveCharacter } from "@/lib/userCharacters";
import { Portrait } from "./Portrait";
import { UserAvatar } from "./UserAvatar";
import { CursorGlow } from "./fx/CursorGlow";

/** Full-bleed routes that render without the sidebar chrome. */
const BARE = ["/welcome", "/login", "/signup"];

function subscribeRecent(cb: () => void) {
  window.addEventListener("rb:recent", cb);
  window.addEventListener(CHARS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("rb:recent", cb);
    window.removeEventListener(CHARS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function useRecent() {
  const raw = useSyncExternalStore(
    subscribeRecent,
    () => JSON.stringify(loadRecent()),
    () => "[]",
  );
  return (JSON.parse(raw) as string[]).map(resolveCharacter).filter((c) => c !== undefined);
}

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className="group flex items-center gap-2.5 px-2 text-lg font-bold tracking-tight">
      <span className="relative grid size-8 place-items-center">
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-accent via-violet to-pink opacity-80 blur-md transition-opacity group-hover:opacity-100" />
        <span className="relative size-6 rounded-full bg-gradient-to-br from-white via-accent to-violet shadow-[inset_0_-3px_6px_rgb(0_0_0/0.25)]" />
      </span>
      <span>
        lumi<span className="text-gradient">.ai</span>
      </span>
    </Link>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const recent = useRecent();
  const user = useUser();
  const hydrated = useHydrated();

  const item = (href: string, label: string, Icon: typeof Compass) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
          active ? "text-fg" : "text-fg-2 hover:bg-white/[0.04] hover:text-fg"
        }`}
      >
        {active && (
          <motion.span
            layoutId={onNavigate ? "nav-active-m" : "nav-active"}
            className="absolute inset-0 rounded-xl border border-white/10 bg-gradient-to-r from-accent/20 via-violet/10 to-transparent"
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
          />
        )}
        <Icon className={`relative size-[18px] ${active ? "text-accent" : ""}`} aria-hidden="true" />
        <span className="relative">{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <Logo onClick={onNavigate} />
      <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
        <Link
          href="/create"
          onClick={onNavigate}
          className="btn-glow flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
        >
          <Plus className="size-4" aria-hidden="true" /> Tạo nhân vật
        </Link>
      </motion.div>
      <nav aria-label="Điều hướng chính" className="flex flex-col gap-1">
        {item("/", "Khám phá", Compass)}
        {item("/search", "Tìm kiếm", Search)}
        {user && item("/profile", "Hồ sơ", UserRound)}
        {item("/welcome", "Giới thiệu", Sparkles)}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-fg-3">Gần đây</h2>
        {recent.length === 0 ? (
          <p className="px-3 text-xs text-fg-3">Chưa có cuộc trò chuyện nào.</p>
        ) : (
          <ul className="no-scrollbar flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {recent.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  onClick={onNavigate}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-fg-2 transition-colors hover:bg-white/[0.04] hover:text-fg"
                >
                  <Portrait
                    seed={c.seed ?? c.id}
                    hue={c.hue}
                    className="size-7 shrink-0 rounded-full ring-1 ring-white/10 transition-transform group-hover:scale-110"
                  />
                  <span className="truncate">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hydrated &&
        (user ? (
          <Link
            href="/profile"
            onClick={onNavigate}
            className="glass flex items-center gap-3 rounded-2xl p-2.5 transition-transform hover:scale-[1.02]"
          >
            <UserAvatar name={user.name} hue={user.hue} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{user.name}</span>
              <span className="block truncate text-xs text-fg-3">@{user.username}</span>
            </span>
          </Link>
        ) : (
          <Link
            href="/login"
            onClick={onNavigate}
            className="glass flex items-center justify-center gap-2 rounded-2xl p-3 text-sm font-medium transition-transform hover:scale-[1.02]"
          >
            <LogIn className="size-4 text-accent" aria-hidden="true" /> Đăng nhập / Đăng ký
          </Link>
        ))}
      <p className="px-3 text-[11px] leading-relaxed text-fg-3">
        Nhân vật do AI nhập vai. Hãy nhớ: mọi điều nhân vật nói là do AI tạo ra.
      </p>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const bare = BARE.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (bare) {
    return (
      <MotionConfig reducedMotion="user">
        <main id="main">{children}</main>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-accent px-3 py-2 text-black focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Bỏ qua tới nội dung
      </a>
      {/* ambient backdrop */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute -right-40 -top-40 size-[640px] animate-aurora rounded-full bg-accent/10 blur-[140px]" />
        <div className="absolute -bottom-60 left-1/4 size-[560px] animate-aurora rounded-full bg-violet/10 blur-[140px] [animation-delay:-9s]" />
      </div>
      <CursorGlow />

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-white/[0.06] bg-sidebar/70 backdrop-blur-xl lg:block">
        <NavContent />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.06] bg-sidebar/80 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <Link href="/search" aria-label="Tìm kiếm" className="rounded-full p-2 hover:bg-surface">
            <Search className="size-5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            aria-label="Mở menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="rounded-full p-2 hover:bg-surface"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/10 bg-sidebar/95 backdrop-blur-xl"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <button
                type="button"
                aria-label="Đóng menu"
                autoFocus
                onClick={() => setOpen(false)}
                className="absolute right-3 top-3 z-10 rounded-full p-2 hover:bg-surface"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
              <NavContent onNavigate={() => setOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main id="main" className="relative z-10 min-w-0 lg:pl-60">
        {children}
      </main>
    </MotionConfig>
  );
}
