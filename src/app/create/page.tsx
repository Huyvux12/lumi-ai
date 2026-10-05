import type { Metadata } from "next";
import { CharacterEditor } from "./CharacterEditor";

export const metadata: Metadata = { title: "Tạo nhân vật — PersonaX" };

export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const { edit } = await searchParams;
  const editId = typeof edit === "string" && edit.startsWith("u-") ? edit : undefined;
  return <CharacterEditor key={editId ?? "new"} editId={editId} />;
}
