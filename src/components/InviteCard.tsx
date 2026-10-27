"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Gift, Share2 } from "lucide-react";
import { api } from "@/lib/api";

type Invite = {
  code: string;
  link: string;
  invited: number;
  qualified: number;
  rewards_granted: number;
  rewards_max: number;
  invites_per_reward: number;
  remaining_to_next: number;
  trial_days: number;
};

export function InviteCard() {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    api<Invite>("/me/invite")
      .then((data) => live && setInvite(data))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!invite) return null;

  const maxed = invite.rewards_granted >= invite.rewards_max;
  const step = invite.invites_per_reward - invite.remaining_to_next;
  const message = `Mình đang trò chuyện với nhân vật AI trên PersonaX. Đăng ký bằng link này để nhận ${invite.trial_days} ngày Basic miễn phí: ${invite.link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite!.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  async function share() {
    if (navigator.share) {
      await navigator.share({ title: "PersonaX", text: message, url: invite!.link }).catch(() => {});
    } else {
      await copy();
    }
  }

  return (
    <section id="invite" className="glass mt-8 scroll-mt-24 rounded-3xl p-5 sm:p-6" aria-labelledby="invite-title">
      <h2 id="invite-title" className="flex items-center gap-2 text-lg font-semibold">
        <Gift className="size-5 text-accent" aria-hidden="true" />
        Mời bạn bè
      </h2>
      <p className="mt-1 text-sm text-fg-2">
        Bạn bè nhận <strong>{invite.trial_days} ngày Basic</strong> khi xác minh email. Cứ{" "}
        {invite.invites_per_reward} bạn xác minh và trò chuyện lần đầu, bạn nhận{" "}
        <strong>1 tháng Basic miễn phí</strong> (tối đa {invite.rewards_max} tháng).
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="field flex min-w-0 flex-1 items-center gap-3 !py-2.5">
          <span className="shrink-0 font-mono text-lg font-bold tracking-widest text-accent">
            {invite.code}
          </span>
          <span className="truncate text-sm text-fg-3">{invite.link}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-medium hover:bg-white/5"
          >
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Đã chép" : "Chép link"}
          </button>
          <button
            type="button"
            onClick={() => void share()}
            className="btn-glow flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-semibold"
          >
            <Share2 className="size-4" aria-hidden="true" /> Chia sẻ
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(invite.link)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Facebook<span className="sr-only"> (mở trong tab mới)</span>
        </a>
        <a
          href={`https://zalo.me/share?url=${encodeURIComponent(invite.link)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Zalo<span className="sr-only"> (mở trong tab mới)</span>
        </a>
      </div>

      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-xs text-fg-2">
          <span>
            {maxed
              ? `Đã nhận đủ ${invite.rewards_max} tháng Basic. Cảm ơn bạn!`
              : `${step}/${invite.invites_per_reward} bạn đến tháng Basic tiếp theo`}
          </span>
          <span>
            {invite.rewards_granted}/{invite.rewards_max} tháng đã nhận
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={invite.invites_per_reward}
          aria-valuenow={maxed ? invite.invites_per_reward : step}
          aria-label="Tiến độ đến tháng Basic tiếp theo"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent via-violet to-pink transition-[width]"
            style={{ width: `${((maxed ? invite.invites_per_reward : step) / invite.invites_per_reward) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-fg-3">
          {invite.invited} bạn đã đăng ký · {invite.qualified} bạn hợp lệ (đã xác minh email và trò chuyện)
        </p>
      </div>
    </section>
  );
}
