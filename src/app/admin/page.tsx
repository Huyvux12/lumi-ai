import { AdminView } from "./AdminView";
import { Suspense } from "react";
import { DashboardSkeleton } from "./AdminDashboard";
export const metadata = { title: "Quản trị PersonaX" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#111217] p-8">
          <DashboardSkeleton />
        </div>
      }
    >
      <AdminView />
    </Suspense>
  );
}
