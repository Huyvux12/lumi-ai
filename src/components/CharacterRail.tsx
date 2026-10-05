import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Character } from "@/lib/data";
import { CharacterCard } from "./CharacterCard";

type Props = { id: string; title: string; href?: string; characters: Character[]; limit?: number };

export function CharacterRail({ id, title, href, characters, limit = 4 }: Props) {
  const headingId = `rail-${id}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-[17px] font-semibold">
        {href ? (
          <Link href={href} className="inline-flex items-center gap-1 hover:text-accent">
            {title}
            <ChevronRight className="size-4" aria-hidden="true" />
            <span className="sr-only">— xem tất cả</span>
          </Link>
        ) : (
          title
        )}
      </h2>
      {/* Mobile: horizontal snap rail. ≥sm: grid like the reference. */}
      <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 sm:mx-0 sm:scroll-px-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 xl:grid-cols-4">
        {characters.slice(0, limit).map((c, i) => (
          <li
            key={c.id}
            className={`w-[85vw] max-w-sm shrink-0 snap-start sm:w-auto sm:max-w-none ${
              i >= 3 ? "lg:hidden xl:block" : ""
            } ${i >= 2 ? "sm:max-lg:hidden" : ""}`}
          >
            <CharacterCard character={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}
