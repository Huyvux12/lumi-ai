import { CategoryChips } from "@/components/CategoryChips";
import { CharacterRail } from "@/components/CharacterRail";
import { HomeHero } from "@/components/HomeHero";
import { MyCharactersRail } from "@/components/MyCharactersRail";
import { PageFade } from "@/components/PageFade";
import { SceneCarousel } from "@/components/SceneCarousel";
import { SearchBar } from "@/components/SearchBar";
import { StarPicker } from "@/components/StarPicker";
import { Reveal } from "@/components/fx/Reveal";
import { getSection, scenes, stars } from "@/lib/data";

export default function Home() {
  const forYou = getSection("danh-cho-ban")!;
  const featured = getSection("noi-bat")!;
  const popular = getSection("pho-bien")!;

  return (
    <PageFade className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 py-6 sm:px-6 lg:px-14">
      <StarPicker characters={stars} />
      <HomeHero faces={stars.slice(0, 6)} />
      <div className="flex flex-col gap-4">
        <SearchBar />
        <CategoryChips />
      </div>
      <MyCharactersRail />
      <Reveal>
        <CharacterRail id="for-you" title={forYou.title} href="/section/danh-cho-ban" characters={forYou.characters} />
      </Reveal>
      <Reveal>
        <SceneCarousel scenes={scenes} />
      </Reveal>
      <Reveal>
        <CharacterRail id="featured" title={featured.title} href="/section/noi-bat" characters={featured.characters} />
      </Reveal>
      <Reveal>
        <CharacterRail id="popular" title={popular.title} href="/section/pho-bien" characters={popular.characters} />
      </Reveal>
    </PageFade>
  );
}
