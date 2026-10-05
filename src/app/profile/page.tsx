import type { Metadata } from "next";
import { ProfileView } from "./ProfileView";

export const metadata: Metadata = { title: "Hồ sơ — PersonaX" };

export default function ProfilePage() {
  return <ProfileView />;
}
