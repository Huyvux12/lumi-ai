"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

export function SearchBar({ initial = "", tag }: { initial?: string; tag?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams();
        if (q.trim()) p.set("q", q.trim());
        if (tag) p.set("tag", tag);
        router.push(`/search${p.size ? `?${p}` : ""}`);
      }}
      className="relative w-full max-w-md"
    >
      <label htmlFor="search" className="sr-only">
        Tìm nhân vật
      </label>
      <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
      <input
        id="search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm nhân vật, thể loại, người tạo…"
        autoComplete="off"
        className="w-full rounded-full border border-line bg-surface py-2.5 pl-10 pr-4 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none focus-visible:outline-none"
      />
    </form>
  );
}
