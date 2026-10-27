"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Gift, X } from "lucide-react";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";

const NEVER = "lumi:invite-popup:never";
const CLOSED = "lumi:invite-popup:closed";
const DELAY_MS = 2500;

type Invite = {
  link: string;
  qualified: number;
  rewards_granted: number;
  rewards_max: number;
  invites_per_reward: number;
  remaining_to_next: number;
  trial_days: number;
};

function stored(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key) === "1";
  } catch {
    return false;
  }
}
function remember(storage: () => Storage, key: string) {
  try {
    storage().setItem(key, "1");
  } catch {
    // Private mode or blocked storage: the popup simply shows again next time.
  }
}

/** Small, dismissible invite promotion. Admins can switch it off; users can hide it for good. */
export function InvitePopup() {
  const user = useUser();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [open, setOpen] = useState(false);
  const [never, setNever] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (stored(() => localStorage, NEVER) || stored(() => sessionStorage, CLOSED)) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const promotions = await api<Record<string, boolean>>("/promotions");
        if (!promotions.invite_banner) return;
        const data = await api<Invite>("/me/invite");
        if (!live || data.rewards_granted >= data.rewards_max) return;
        setInvite(data);
        setOpen(true);
      } catch {
        // A promotion must never get in the way of the app.
      }
    }, DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    if (never) remember(() => localStorage, NEVER);
    else remember(() => sessionStorage, CLOSED);
    setOpen(false);
  }
  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const step = invite ? invite.invites_per_reward - invite.remaining_to_next : 0;

  // Portal to <body>: animated page wrappers use transforms, which would anchor "fixed" to them.
  if (!invite) return null;
  return createPortal(
    <AnimatePresence>
      {open && invite && (
        <motion.aside
          role="dialog"
          aria-labelledby="invite-popup-title"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="fixed inset-x-4 bottom-4 z-50 overflow-hidden rounded-3xl border border-white/10 bg-[#15131f]/95 shadow-2xl shadow-black/50 backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[360px]"
        >
          <div className="relative bg-gradient-to-r from-accent/30 via-violet/30 to-pink/30 px-5 pt-5 pb-4">
            <button
              type="button"
              onClick={close}
              aria-label="Đóng"
              className="absolute top-3 right-3 rounded-full p-1.5 text-fg-2 hover:bg-white/10 hover:text-fg"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <span className="grid size-10 place-items-center rounded-2xl bg-white/15">
              <Gift className="size-5 text-white" aria-hidden="true" />
            </span>
            <h2 id="invite-popup-title" className="mt-3 pr-6 text-lg leading-snug font-semibold">
              Mời bạn bè, nhận Basic miễn phí
            </h2>
          </div>
          <div className="px-5 pt-3 pb-5">
            <p className="text-sm leading-relaxed text-fg-2">
              Bạn bè nhận <strong className="text-fg">{invite.trial_days} ngày Basic</strong>. Cứ{" "}
              {invite.invites_per_reward} bạn tham gia, bạn nhận{" "}
              <strong className="text-fg">1 tháng Basic</strong> (tối đa {invite.rewards_max} tháng).
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-fg-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-accent to-pink"
                  style={{ width: `${(step / invite.invites_per_reward) * 100}%` }}
                />
              </span>
              {step}/{invite.invites_per_reward} bạn
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="btn-glow flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap"
              >
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                {copied ? "Đã chép link" : "Chép link mời"}
              </button>
              <Link
                href="/profile#invite"
                onClick={() => remember(() => sessionStorage, CLOSED)}
                className="flex items-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-medium whitespace-nowrap hover:bg-white/5"
              >
                Chi tiết
              </Link>
            </div>
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-fg-3">
              <input
                type="checkbox"
                checked={never}
                onChange={(event) => setNever(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent,#8ab4ff)]"
              />
              Không hiển thị lại
            </label>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}
