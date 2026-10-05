import { CatalogResults } from "@/components/CatalogResults";
import { SearchBar } from "@/components/SearchBar";
import { CategoryChips } from "@/components/CategoryChips";
export const metadata = { title: "Tìm kiếm — Lumi" };
export default async function Page({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const tag = typeof sp.tag === "string" ? sp.tag : "";
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Tìm kiếm</h1>
      <SearchBar initial={q} tag={tag} />
      <CategoryChips active={tag} q={q} />
      <CatalogResults q={q} tag={tag} />
    </div>
  );
}
