"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthReady, useUser } from "@/lib/auth";
import { fetchCharacter, type UserCharacter } from "@/lib/userCharacters";
import { api } from "@/lib/api";
import type { Scene } from "@/lib/data";
import { CharacterProfile } from "./CharacterProfile";
import { ChatView } from "./ChatView";
type Props = {
  id: string;
  view: "profile" | "chat";
  sceneId?: string;
  conversationId?: string;
};
export function UserCharacterRoute(props: Props) {
  const user = useUser();
  return (
    <ResolvedCharacter
      key={`${props.id}:${props.sceneId ?? ""}:${props.conversationId ?? ""}:${user?.id ?? "guest"}`}
      {...props}
    />
  );
}
function ResolvedCharacter({ id, view, sceneId, conversationId }: Props) {
  const user = useUser();
  const ready = useAuthReady();
  const [scene, setScene] = useState<Scene | undefined>(undefined);
  const [c, setC] = useState<UserCharacter | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ready) return;
    let live = true;
    Promise.all([
      fetchCharacter(id),
      sceneId
        ? api<Scene>(`/scenes/${encodeURIComponent(sceneId)}`)
        : Promise.resolve(undefined),
    ])
      .then(([c, s]) => {
        if (live) {
          setC(c);
          setScene(s);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, ready, user?.id, sceneId]);
  if (error)
    return (
      <div className="p-10 text-center">
        <p role="alert">{error}</p>
        <Link href="/" className="text-accent">
          Về Khám phá
        </Link>
      </div>
    );
  if (!c)
    return <p className="p-10 text-center text-fg-2">Đang tải nhân vật…</p>;
  return view === "chat" ? (
    <ChatView
      key={id}
      character={c}
      scene={scene}
      initialConversationId={conversationId}
    />
  ) : (
    <CharacterProfile character={c} editable={user?.id === c.owner} />
  );
}
