import type { Metadata } from "next";
import { ProfileView } from "./ProfileView";

export const metadata: Metadata = { title: "Hồ sơ — lumi.ai" };

export default function ProfilePage() {
  return <ProfileView />;
}
