"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useUser } from "@/lib/auth";
import { useHydrated } from "@/lib/store";
import { useUserChars } from "@/lib/userCharacters";
import { CharacterProfile } from "./CharacterProfile";
import { ChatView } from "./ChatView";
import { Mascot } from "./Mascot";

/** Characters created in this browser only exist client-side, so their routes resolve here. */
export function UserCharacterRoute({ id, view }: { id: string; view: "profile" | "chat" }) {
  const hydrated = useHydrated();
  const chars = useUserChars();
  const user = useUser();
  const c = chars.find((x) => x.id === id);

  if (!hydrated) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Đang tải" />
      </div>
    );
  }
  if (!c) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
        <Mascot mood="sad" className="size-40" />
        <h1 className="text-2xl font-bold">Nhân vật này đã lạc mất</h1>
        <p className="text-fg-2">Nhân vật do người dùng tạo chỉ được lưu trên trình duyệt đã tạo ra nó.</p>
        <Link href="/" className="btn-glow rounded-full px-5 py-2.5 text-sm font-semibold">
          Về trang Khám phá
        </Link>
      </div>
    );
  }
  return view === "chat" ? (
    <ChatView key={id} character={c} />
  ) : (
    <CharacterProfile character={c} editable={user?.email === c.owner} />
  );
}
