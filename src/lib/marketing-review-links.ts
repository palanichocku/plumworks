import type { PublicShop } from "@/lib/marketing";
import { shopAddress } from "@/lib/marketing";

const CAR_DOC_PLACE_ID = "ChIJ6c7M8uXcJIgRB8kgW2jUZ9A";
const CAR_DOC_FACEBOOK = "https://www.facebook.com/subbuscardoc/";

function isCarDoc(shop: PublicShop) {
  const address = shop.addressLine1?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  const phone = shop.phone?.replace(/\D/g, "") ?? "";
  return address === "42464moundroad" && phone === "5868433347";
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
  if (!isCarDoc(shop)) return { google: null, facebook: null, leaveGoogle: null };
  const query = encodeURIComponent(`${shop.name} ${shopAddress(shop)}`);
  const google = `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${CAR_DOC_PLACE_ID}`;
  return { google, facebook: CAR_DOC_FACEBOOK, leaveGoogle: trustedGoogleReviewUrl(configuredGoogleReviewUrl) ?? google };
}
