import { redirect } from "next/navigation";

// Short share link: personaxai.tech/i/CODE opens sign-up with the invite applied.
export default async function InvitePage({ params }: PageProps<"/i/[code]">) {
  const { code } = await params;
  const clean = code.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase();
  redirect(clean ? `/signup?ref=${clean}` : "/signup");
}
