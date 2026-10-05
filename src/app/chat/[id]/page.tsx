import { notFound } from "next/navigation";
import { ChatView } from "@/components/ChatView";
import { UserCharacterRoute } from "@/components/UserCharacterRoute";
import { getCharacter, getScene } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const c = getCharacter(id);
  return { title: c ? `Trò chuyện với ${c.name} — lumi.ai` : id.startsWith("u-") ? "Trò chuyện — lumi.ai" : "Không tìm thấy" };
}

export default async function ChatPage({ params, searchParams }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const character = getCharacter(id);
  if (!character) {
    if (id.startsWith("u-")) return <UserCharacterRoute id={id} view="chat" />;
    notFound();
  }
  const scene = typeof sp.scene === "string" ? getScene(sp.scene) : undefined;

  return <ChatView key={`${id}:${scene?.id ?? ""}`} character={character} scene={scene} />;
}
