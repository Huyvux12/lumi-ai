import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { formatCount, type Character } from "@/lib/data";
import { Portrait } from "./Portrait";
import { TiltCard } from "./TiltCard";

export function CharacterCard({ character: c, badge }: { character: Character; badge?: string }) {
  return (
    <TiltCard hue={c.hue} className="h-36">
      <Link
        href={`/character/${c.id}`}
        className="group relative flex h-full gap-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-surface/85 p-4 backdrop-blur-sm transition-colors duration-200 hover:border-white/15 hover:bg-surface-2/85"
      >
        <div
          className="relative size-24 shrink-0 self-start overflow-hidden rounded-xl"
          style={{ boxShadow: `0 10px 30px -10px hsl(${c.hue} 80% 50% / 0.6)` }}
        >
          <Portrait
            seed={c.seed ?? c.id}
            hue={c.hue}
            className="size-full transition-transform duration-500 ease-[var(--ease-expo)] group-hover:scale-[1.1]"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-sm font-semibold">{c.name}</h3>
          <p className="truncate text-xs text-fg-2">Người thực hiện @{c.creator}</p>
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug">{c.tagline}</p>
          <div className="mt-1.5 flex gap-1.5">
            {c.lore && (
              <span className="w-fit rounded-md bg-accent-bg px-1.5 py-0.5 text-[11px] font-medium text-accent">
                +Lore
              </span>
            )}
            {badge && (
              <span className="w-fit rounded-md bg-fuchsia-500/15 px-1.5 py-0.5 text-[11px] font-medium text-pink">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-auto flex items-center gap-1 text-xs text-fg-2">
            <MessageCircle className="size-3.5" aria-hidden="true" />
            <span>
              {formatCount(c.chats)}
              <span className="sr-only"> lượt trò chuyện</span>
            </span>
          </p>
        </div>
      </Link>
    </TiltCard>
  );
}
