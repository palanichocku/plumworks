export function encodeGalleryCaption(caption: string | null, alt: string | null) {
  return alt ? JSON.stringify({ version: 1, caption, alt }) : caption;
}

export function decodeGalleryCaption(value: string | null) {
  if (!value?.startsWith("{")) return { caption: value, alt: null };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.version !== 1) return { caption: value, alt: null };
    return {
      caption: typeof parsed.caption === "string" ? parsed.caption : null,
      alt: typeof parsed.alt === "string" ? parsed.alt : null,
    };
  } catch {
    return { caption: value, alt: null };
  }
}
