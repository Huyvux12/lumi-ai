"use client";
import { useUserChars } from "@/lib/userCharacters";
import { CharacterCard } from "./CharacterCard";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
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
  const user = useUser();
  const query = new URLSearchParams({ q, tag, limit: "40" });
  ids?.forEach((id) => query.append("ids", id));
  return <Results key={`${user?.id ?? "guest"}:${query}`} query={query.toString()} />;
}
function Results({ query }: { query: string }) {
  const [list, setList] = useState<import("@/lib/data").Character[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<import("@/lib/data").Character[]>(`/characters?${query}`, { signal: controller.signal })
      .then((rows) => { setList(rows); setMore(rows.length === 40); setOffset(rows.length); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [query]);
  async function loadMore() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const rows = await api<import("@/lib/data").Character[]>(`/characters?${query}&offset=${offset}`);
      setList((old) => Array.from(new Map([...old, ...rows].map((c) => [c.id, c])).values()));
      setOffset(offset + rows.length);
      setMore(rows.length === 40);
    } catch (error) { setError(error instanceof Error ? error.message : "Không thể tải nhân vật."); }
    finally { setBusy(false); }
  }
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
      {error && <p role="alert" className="text-danger">{error}</p>}
      {busy && <p>Đang tải nhân vật…</p>}
      {more && <button disabled={busy} onClick={() => void loadMore()} className="text-accent">Tải thêm nhân vật</button>}
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
