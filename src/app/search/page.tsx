import Link from "next/link";
import { CategoryChips } from "@/components/CategoryChips";
import { CharacterCard } from "@/components/CharacterCard";
import { PageFade } from "@/components/PageFade";
import { SearchBar } from "@/components/SearchBar";
import { searchCharacters } from "@/lib/data";

export const metadata = { title: "Tìm kiếm — lumi.ai" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const tag = typeof sp.tag === "string" ? sp.tag : undefined;
  const results = searchCharacters(q, tag);

  return (
    <PageFade className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-14">
      <h1 className="text-2xl font-semibold">Tìm kiếm</h1>
      <SearchBar key={q} initial={q} tag={tag} />
      <CategoryChips active={tag} q={q} />
      <p className="text-sm text-fg-2" aria-live="polite">
        {results.length} nhân vật
        {q && <> cho “{q}”</>}
        {tag && <> trong thể loại {tag}</>}
      </p>
      {results.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-6 py-16 text-center">
          <p className="font-medium">Không tìm thấy nhân vật nào</p>
          <p className="text-sm text-fg-2">Thử từ khóa khác hoặc bỏ bộ lọc thể loại.</p>
          <Link href="/search" className="mt-2 rounded-full bg-fg px-4 py-2 text-sm font-medium text-canvas">
            Xóa bộ lọc
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((c) => (
            <li key={c.id}>
              <CharacterCard character={c} />
            </li>
          ))}
        </ul>
      )}
    </PageFade>
  );
}
