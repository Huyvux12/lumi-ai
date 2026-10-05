import { notFound } from "next/navigation";
import { CharacterProfile } from "@/components/CharacterProfile";
import { UserCharacterRoute } from "@/components/UserCharacterRoute";
import { characters, getCharacter } from "@/lib/data";

export function generateStaticParams() {
  return characters.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: PageProps<"/character/[id]">) {
  const { id } = await params;
  const c = getCharacter(id);
  return { title: c ? `${c.name} — lumi.ai` : id.startsWith("u-") ? "Nhân vật của bạn — lumi.ai" : "Không tìm thấy" };
}

export default async function CharacterPage({ params }: PageProps<"/character/[id]">) {
  const { id } = await params;
  const c = getCharacter(id);
  if (c) return <CharacterProfile character={c} />;
  if (id.startsWith("u-")) return <UserCharacterRoute id={id} view="profile" />;
  notFound();
}
