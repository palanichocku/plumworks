import type { PublicShop } from "@/lib/marketing";
import { shopAddress } from "@/lib/marketing";

const CAR_DOC_PLACE_ID = "ChIJ6c7M8uXcJIgRB8kgW2jUZ9A";
const CAR_DOC_FACEBOOK = "https://www.facebook.com/subbuscardoc/";

function isCarDoc(shop: PublicShop) {
  const address = shop.addressLine1?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  const phone = shop.phone?.replace(/\D/g, "") ?? "";
  return address === "42464moundroad" && phone === "5868433347";
}

/** Explicit Car Doc link preview for the synthetic development shop only.
 * Flag is scoped to the dev branch in Vercel, is denied in production, and\n * requires the exact synthetic dev shop identity. Do not depend on optional Vercel Git vars.
 */
export function carDocReviewPreviewEnabled(shop: PublicShop): boolean {
  return process.env.PLUMWORKS_DEV_CARDOC_REVIEW_PREVIEW === "true" &&
    process.env.VERCEL_ENV !== "production" &&
    shop.name === "Car Doc Development" &&
    shop.addressLine1 === "100 Test Drive" &&
    shop.phone === "555-0100";
}

function trustedGoogleReviewUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      (url.hostname === "google.com" || url.hostname === "www.google.com" || url.hostname === "maps.google.com" || url.hostname === "g.page")
      ? url.href : null;
  } catch { return null; }
}

/** Public profile links; a tenant must match both Car Doc's address and phone. */
export function getReviewLinks(shop: PublicShop, configuredGoogleReviewUrl?: string | null) {
  const preview = carDocReviewPreviewEnabled(shop);
  if (!isCarDoc(shop) && !preview) return { google: null, facebook: null, leaveGoogle: null };
  // Development uses the real public Car Doc profile, not a synthetic shop profile.
  const query = encodeURIComponent(preview ? "Car Doc 42464 Mound Road Sterling Heights MI" : `${shop.name} ${shopAddress(shop)}`);
  const google = `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${CAR_DOC_PLACE_ID}`;
  return { google, facebook: CAR_DOC_FACEBOOK, leaveGoogle: trustedGoogleReviewUrl(configuredGoogleReviewUrl ?? process.env.PLUMWORKS_GOOGLE_REVIEW_URL) ?? google };
}
