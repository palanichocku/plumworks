export type MarketingMedia = {
  slot: string;
  imageUrl: string;
  alt: string;
  heading: string | null;
  body: string | null;
  objectPosition: string | null;
};

export function isClientAssetUrl(value: string) {
  return value.startsWith("/client-assets/");
}

export function encodeMarketingMedia(items: MarketingMedia[]) {
  return JSON.stringify({ version: 1, items });
}

export function decodeMarketingMedia(value: string | null | undefined): MarketingMedia[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { version?: unknown; items?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter((item): item is MarketingMedia => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const media = item as Record<string, unknown>;
      return typeof media.slot === "string"
        && typeof media.imageUrl === "string"
        && isClientAssetUrl(media.imageUrl)
        && typeof media.alt === "string"
        && (media.heading == null || typeof media.heading === "string")
        && (media.body == null || typeof media.body === "string")
        && (media.objectPosition == null || typeof media.objectPosition === "string");
    });
  } catch {
    return [];
  }
}

