"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useUserChars } from "@/lib/userCharacters";
import type { Scene } from "@/lib/data";
import { Portrait } from "./Portrait";
export function SceneView({ id }: { id: string }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState("");
  const catalog = useUserChars();
  useEffect(() => {
    let live = true;
    api<Scene>(`/scenes/${encodeURIComponent(id)}`)
      .then((s) => {
        if (live) setScene(s);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  if (error)
    return (
      <p role="alert" className="p-10 text-danger">
        {error}
      </p>
    );
  if (!scene) return <p className="p-10">Đang tải bối cảnh…</p>;
  const cast = catalog.filter((c) => scene.characterIds.includes(c.id));
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Link href="/" className="text-sm text-accent">
        ← Khám phá
      </Link>
      <div className="flex flex-col gap-6 sm:flex-row">
        <Portrait
          seed={scene.id}
          hue={scene.hue}
          variant="scene"
          className="h-64 w-48 rounded-2xl"
        />
        <div>
          <p className="mb-2 text-sm text-accent">Bối cảnh</p>
          <h1 className="text-3xl font-semibold">{scene.title}</h1>
          <p className="my-3 text-sm text-fg-2">@{scene.creator}</p>
          <p className="leading-relaxed">{scene.premise}</p>
        </div>
      </div>
      <h2 className="text-xl font-semibold">Chọn nhân vật</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {cast.map((c) => (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}?scene=${scene.id}`}
              className="glass flex items-center gap-4 rounded-2xl p-4"
            >
              <Portrait
                seed={c.seed ?? c.id}
                hue={c.hue}
                className="size-14 rounded-xl"
              />
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="text-sm text-fg-2">{c.tagline}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
