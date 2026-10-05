import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getPublicShop } from "@/lib/marketing";
import { getMarketingCoupons, getMarketingGallery, getMarketingSettings, getMarketingTestimonials } from "@/lib/marketing-content";
import { marketingContentPreviewEnabled } from "@/lib/marketing-content-preview";
import { getReviewLinks } from "@/lib/marketing-review-links";

export const dynamic = "force-dynamic";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [shop, coupons, testimonials, gallery, settings] = await Promise.all([getPublicShop(), getMarketingCoupons(), getMarketingTestimonials(), getMarketingGallery(), getMarketingSettings()]);
  const reviewLinks = getReviewLinks(shop, settings.reviewUrl);
  const optionalLinks = [
    coupons.some((item) => !item.id.startsWith("fallback-")) ? ["Offers", "/coupons"] : null,
    (testimonials.some((item) => !item.id.startsWith("fallback-")) || reviewLinks.google || reviewLinks.facebook) ? ["Reviews", "/reviews"] : null,
    gallery.some((item) => !item.id.startsWith("fallback-") && item.imageUrl) ? ["Photos", "/photos"] : null,
  ].filter((item): item is [string, string] => item !== null);
  return <MarketingShell shop={shop} optionalLinks={optionalLinks} previewMode={marketingContentPreviewEnabled()}>{children}</MarketingShell>;
}
