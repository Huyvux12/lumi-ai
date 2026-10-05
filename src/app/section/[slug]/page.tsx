import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CharacterCard } from "@/components/CharacterCard";
import { PageFade } from "@/components/PageFade";
import { getSection, sections } from "@/lib/data";

export function generateStaticParams() {
  return Object.keys(sections).map((slug) => ({ slug }));
}

export default async function SectionPage({ params }: PageProps<"/section/[slug]">) {
  const { slug } = await params;
  const section = getSection(slug);
  if (!section) notFound();

  return (
    <PageFade className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-14">
      <Link href="/" className="flex w-fit items-center gap-1 text-sm text-fg-2 hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden="true" /> Khám phá
      </Link>
      <h1 className="text-2xl font-semibold">{section.title}</h1>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {section.characters.map((c) => (
          <li key={c.id}>
            <CharacterCard character={c} />
          </li>
        ))}
      </ul>
    </PageFade>
  );
}
