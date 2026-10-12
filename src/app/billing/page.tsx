import { BillingView } from "./BillingView";
export const metadata = { title: "Gói & thanh toán — PersonaX" };
export default async function Page({ searchParams }: PageProps<"/billing">) {
  const { promo } = await searchParams;
  return <BillingView initialPromo={typeof promo === "string" ? promo : ""} />;
}
