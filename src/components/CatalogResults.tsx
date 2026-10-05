"use client";
import { useUserChars } from "@/lib/userCharacters";
import { CharacterCard } from "./CharacterCard";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Scene } from "@/lib/data";
import { SceneCarousel } from "./SceneCarousel";
export function CatalogResults({
  q = "",
  tag = "",
  ids,
}: {
  q?: string;
  tag?: string;
  ids?: string[];
}) {
  const catalog = useUserChars();
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .toLowerCase();
  const list = catalog.filter(
    (c) =>
      (!ids || ids.includes(c.id)) &&
      (!tag || c.tags.includes(tag)) &&
      normalize(c.name + " " + c.description + " " + c.tagline).includes(
        normalize(q),
      ),
  );
  return (
    <>
      <p className="text-sm text-fg-2">{list.length} nhân vật</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map((c) => (
          <li key={c.id}>
            <CharacterCard character={c} />
          </li>
        ))}
      </ul>
    </>
  );
}
export function CommunityRail() {
  const catalog = useUserChars();
  const list = catalog.filter(
    (c) => c.owner && c.visibility === "public" && c.status === "approved",
  );
  if (!list.length) return null;
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Nhân vật cộng đồng</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.slice(0, 8).map((c) => (
          <li key={c.id}>
            <CharacterCard character={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}
export function LiveScenes() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  useEffect(() => {
    void api<Scene[]>("/scenes")
      .then(setScenes)
      .catch(() => {});
  }, []);
  return <SceneCarousel scenes={scenes} />;
}
