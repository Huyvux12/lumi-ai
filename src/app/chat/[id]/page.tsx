import { UserCharacterRoute } from "@/components/UserCharacterRoute";
import { getCharacter } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const c = getCharacter(id);
  return {
    title: c
      ? `Trò chuyện với ${c.name} — PersonaX`
      : id.startsWith("u-")
        ? "Trò chuyện — PersonaX"
        : "Không tìm thấy",
  };
}

export default async function ChatPage({
  params,
  searchParams,
}: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const sceneId = typeof sp.scene === "string" ? sp.scene : undefined;
  const conversationId =
    typeof sp.conversation === "string" ? sp.conversation : undefined;
  return (
    <UserCharacterRoute
      key={`${id}:${sceneId ?? ""}:${conversationId ?? ""}`}
      id={id}
      view="chat"
      sceneId={sceneId}
      conversationId={conversationId}
    />
  );
}
