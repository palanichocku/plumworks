import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getPublicShop } from "@/lib/marketing";

export const dynamic = "force-dynamic";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingShell shop={await getPublicShop()}>{children}</MarketingShell>;
}
