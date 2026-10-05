import { AccountRecovery } from "@/components/AccountRecovery";
export default async function Page({
  searchParams,
}: PageProps<"/verify-email">) {
  const sp = await searchParams;
  return (
    <AccountRecovery
      mode="verify"
      token={typeof sp.token === "string" ? sp.token : ""}
    />
  );
}
