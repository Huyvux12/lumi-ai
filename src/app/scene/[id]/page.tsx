import { SceneView } from "@/components/SceneView";
export const metadata = { title: "Bối cảnh — PersonaX" };
export default async function Page({ params }: PageProps<"/scene/[id]">) {
  const { id } = await params;
  return <SceneView key={id} id={id} />;
}
