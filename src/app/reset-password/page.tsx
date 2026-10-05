import { AccountRecovery } from "@/components/AccountRecovery";
export default async function Page({
  searchParams,
}: PageProps<"/reset-password">) {
  const sp = await searchParams;
  return (
    <AccountRecovery
      mode="reset"
      token={typeof sp.token === "string" ? sp.token : ""}
    />
  );
}
