import { UserCharacterRoute } from "@/components/UserCharacterRoute";
import { characters, getCharacter } from "@/lib/data";

export function generateStaticParams() {
  return characters.map((c) => ({ id: c.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/character/[id]">) {
  const { id } = await params;
  const c = getCharacter(id);
  return {
    title: c
      ? `${c.name} — PersonaX`
      : id.startsWith("u-")
        ? "Nhân vật của bạn — PersonaX"
        : "Không tìm thấy",
  };
}

export default async function CharacterPage({
  params,
}: PageProps<"/character/[id]">) {
  const { id } = await params;
  return <UserCharacterRoute key={id} id={id} view="profile" />;
}
