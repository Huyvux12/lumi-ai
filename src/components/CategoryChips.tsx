import Link from "next/link";
import { categories } from "@/lib/data";

export function CategoryChips({ active, q }: { active?: string; q?: string }) {
  const href = (tag?: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (tag) p.set("tag", tag);
    return `/search${p.size ? `?${p}` : ""}`;
  };
  const chip = (label: string, tag: string | undefined, isActive: boolean) => (
    <li key={label} className="shrink-0">
      <Link
        href={href(tag)}
        aria-current={isActive ? "true" : undefined}
        className={`block rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
          isActive ? "bg-fg text-canvas" : "bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg"
        }`}
      >
        {label}
      </Link>
    </li>
  );
  return (
    <nav aria-label="Thể loại">
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {chip("Tất cả", undefined, !active)}
        {categories.map((t) => chip(t, t, active === t))}
      </ul>
    </nav>
  );
}
