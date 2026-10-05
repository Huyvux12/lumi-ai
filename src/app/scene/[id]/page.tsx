import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { PageFade } from "@/components/PageFade";
import { Portrait } from "@/components/Portrait";
import { getCharacter, getScene, scenes } from "@/lib/data";

export function generateStaticParams() {
  return scenes.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: PageProps<"/scene/[id]">) {
  const { id } = await params;
  const s = getScene(id);
  return { title: s ? `${s.title} — lumi.ai` : "Không tìm thấy" };
}

export default async function ScenePage({ params }: PageProps<"/scene/[id]">) {
  const { id } = await params;
  const scene = getScene(id);
  if (!scene) notFound();
  const cast = scene.characterIds.map(getCharacter).filter((c) => c !== undefined);

  return (
    <PageFade className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Link href="/" className="flex w-fit items-center gap-1 text-sm text-fg-2 hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden="true" /> Khám phá
      </Link>
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="relative aspect-[5/7] w-48 shrink-0 overflow-hidden rounded-2xl">
          <Portrait seed={scene.id} hue={scene.hue} variant="scene" className="absolute inset-0 size-full" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Cảnh</p>
          <h1 className="text-2xl font-semibold">{scene.title}</h1>
          <p className="text-sm text-fg-2">Người thực hiện @{scene.creator}</p>
          <p className="mt-2 leading-relaxed">{scene.premise}</p>
        </div>
      </div>
      <section aria-labelledby="cast">
        <h2 id="cast" className="mb-3 text-[17px] font-semibold">
          Chọn nhân vật
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {cast.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}?scene=${scene.id}`}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 transition-colors hover:bg-surface-2"
              >
                <Portrait seed={c.seed ?? c.id} hue={c.hue} className="size-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="line-clamp-1 text-sm text-fg-2">{c.tagline}</p>
                </div>
                <MessageCircle className="size-5 shrink-0 text-fg-2" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageFade>
  );
}
