import "server-only";

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PreviewEnvironment = Partial<Record<"NODE_ENV" | "VERCEL" | "VERCEL_ENV" | "MARKETING_CONTENT_PREVIEW_FILE", string>>;
type UnknownRecord = Record<string, unknown>;

export type MarketingContentPreview = ReturnType<typeof parseMarketingContentPreview>;

function record(value: unknown, name: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as UnknownRecord;
}

function list(value: unknown, name: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

function text(value: unknown, name: string, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const normalized = value.trim().slice(0, 5000);
  if (!normalized && required) throw new Error(`${name} is required.`);
  return normalized || null;
}

function order(value: unknown): number { return Number.isInteger(value) ? value as number : 0; }

function slug(value: unknown, name: string): string {
  const normalized = text(value, name, true)!;
  if (!SLUG.test(normalized)) throw new Error(`${name} is invalid.`);
  return normalized;
}

export function marketingContentPreviewEnabled(environment: PreviewEnvironment = process.env): boolean {
  return Boolean(environment.MARKETING_CONTENT_PREVIEW_FILE)
    && environment.NODE_ENV === "development"
    && !environment.VERCEL
    && !environment.VERCEL_ENV;
}

export function parseMarketingContentPreview(value: unknown) {
  const document = record(value, "marketing content preview");
  const rawSettings = record(document.settings, "settings");
  const rawOwner = document.aboutOwner == null ? null : record(document.aboutOwner, "aboutOwner");
  const aboutOwner = rawOwner ? {
    heading: text(rawOwner.heading, "aboutOwner.heading", true)!,
    name: text(rawOwner.name, "aboutOwner.name", true)!,
    role: text(rawOwner.role, "aboutOwner.role", true)!,
    biography: text(rawOwner.biography, "aboutOwner.biography", true)!,
    imageUrl: text(rawOwner.imageUrl, "aboutOwner.imageUrl", true)!,
    imageAlt: text(rawOwner.imageAlt, "aboutOwner.imageAlt", true)!,
  } : null;
  if (aboutOwner && !aboutOwner.imageUrl.startsWith("/client-assets/")) throw new Error("aboutOwner.imageUrl must use a local client asset path.");
  const settings = {
    headline: text(rawSettings.headline, "settings.headline"),
    subheadline: text(rawSettings.subheadline, "settings.subheadline"),
    serviceIntro: text(rawSettings.serviceIntro, "settings.serviceIntro"),
    aboutTitle: text(rawSettings.aboutTitle, "settings.aboutTitle"),
    aboutBody: text(rawSettings.aboutBody, "settings.aboutBody"),
    contactIntro: text(rawSettings.contactIntro, "settings.contactIntro"),
    hoursText: text(rawSettings.hoursText, "settings.hoursText"),
    reviewUrl: text(rawSettings.reviewUrl, "settings.reviewUrl"),
  };
  const pages = list(document.pages, "pages").map((value, index) => {
    const item = record(value, `pages[${index}]`);
    return { slug: slug(item.slug, `pages[${index}].slug`), eyebrow: text(item.eyebrow, `pages[${index}].eyebrow`), title: text(item.title, `pages[${index}].title`, true)!, description: text(item.description, `pages[${index}].description`, true)!, body: text(item.body, `pages[${index}].body`), active: item.active !== false };
  });
  const services = list(document.services, "services").map((value, index) => {
    const item = record(value, `services[${index}]`);
    return { slug: slug(item.slug, `services[${index}].slug`), name: text(item.name, `services[${index}].name`, true)!, summary: text(item.summary, `services[${index}].summary`, true)!, detail: text(item.detail, `services[${index}].detail`, true)!, active: item.active !== false, sortOrder: order(item.sortOrder), previewIndex: index };
  });
  const coupons = list(document.coupons, "coupons").map((value, index) => {
    const item = record(value, `coupons[${index}]`);
    return { id: `preview-coupon-${index}`, title: text(item.title, `coupons[${index}].title`, true)!, body: text(item.body, `coupons[${index}].body`, true)!, terms: text(item.terms, `coupons[${index}].terms`), active: item.active !== false, sortOrder: order(item.sortOrder), previewIndex: index };
  });
  const testimonials = list(document.testimonials, "testimonials").map((value, index) => {
    const item = record(value, `testimonials[${index}]`);
    const rating = item.rating == null ? null : Number(item.rating);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error(`testimonials[${index}].rating must be 1-5.`);
    return { id: `preview-testimonial-${index}`, quote: text(item.quote, `testimonials[${index}].quote`, true)!, attribution: text(item.attribution, `testimonials[${index}].attribution`), rating, active: item.active !== false, sortOrder: order(item.sortOrder), previewIndex: index };
  });
  const gallery = list(document.gallery, "gallery").map((value, index) => {
    const item = record(value, `gallery[${index}]`);
    const imageUrl = text(item.imageUrl, `gallery[${index}].imageUrl`);
    if (imageUrl && !imageUrl.startsWith("https://")) throw new Error(`gallery[${index}].imageUrl must use HTTPS.`);
    return { id: `preview-gallery-${index}`, title: text(item.title, `gallery[${index}].title`, true)!, caption: text(item.caption, `gallery[${index}].caption`), imageUrl, active: item.active !== false, sortOrder: order(item.sortOrder), previewIndex: index };
  });
  return { settings, aboutOwner, pages, services, coupons, testimonials, gallery };
}

export async function getMarketingContentPreview(environment: PreviewEnvironment = process.env): Promise<MarketingContentPreview | null> {
  if (!marketingContentPreviewEnabled(environment)) return null;
  const file = environment.MARKETING_CONTENT_PREVIEW_FILE!;
  if (!isAbsolute(file)) throw new Error("MARKETING_CONTENT_PREVIEW_FILE must be an absolute path.");
  let source: string;
  try { source = await readFile(file, "utf8"); }
  catch { throw new Error("Marketing content preview file could not be read."); }
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error("Marketing content preview file is not valid JSON."); }
  try { return parseMarketingContentPreview(value); }
  catch (error) { throw new Error(`Marketing content preview is incompatible: ${error instanceof Error ? error.message : "validation failed."}`); }
}
