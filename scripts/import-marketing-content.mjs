import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const CONFIRMATION = "IMPORT_MARKETING_CONTENT";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function text(value, name, required = false) { if (value == null || value === "") { if (required) throw new Error(`${name} is required.`); return null; } if (typeof value !== "string") throw new Error(`${name} must be text.`); return value.trim().slice(0, 5000) || null; }
function list(value, name) { if (value == null) return []; if (!Array.isArray(value)) throw new Error(`${name} must be an array.`); return value; }
function order(value) { return Number.isInteger(value) ? value : 0; }

const fileArgument = argument("--file");
const confirmation = argument("--confirm");
const forceDryRun = process.argv.includes("--dry-run");
if (!fileArgument) throw new Error("--file is required.");
if (confirmation && confirmation !== CONFIRMATION) throw new Error(`Write refused. Use --confirm ${CONFIRMATION} exactly.`);
const dryRun = forceDryRun || confirmation !== CONFIRMATION;
const document = JSON.parse(await readFile(resolve(fileArgument), "utf8"));

const settings = {
  headline: text(document.settings?.headline, "settings.headline"), subheadline: text(document.settings?.subheadline, "settings.subheadline"),
  serviceIntro: text(document.settings?.serviceIntro, "settings.serviceIntro"), aboutTitle: text(document.settings?.aboutTitle, "settings.aboutTitle"),
  aboutBody: text(document.settings?.aboutBody, "settings.aboutBody"), contactIntro: text(document.settings?.contactIntro, "settings.contactIntro"),
  hoursText: text(document.settings?.hoursText, "settings.hoursText"), reviewUrl: text(document.settings?.reviewUrl, "settings.reviewUrl"),
};
const pages = list(document.pages, "pages").map((item, index) => { const slug = text(item.slug, `pages[${index}].slug`, true); if (!SLUG.test(slug)) throw new Error(`pages[${index}].slug is invalid.`); return { slug, eyebrow: text(item.eyebrow, `pages[${index}].eyebrow`), title: text(item.title, `pages[${index}].title`, true), description: text(item.description, `pages[${index}].description`, true), body: text(item.body, `pages[${index}].body`), active: item.active !== false }; });
const services = list(document.services, "services").map((item, index) => { const slug = text(item.slug, `services[${index}].slug`, true); if (!SLUG.test(slug)) throw new Error(`services[${index}].slug is invalid.`); return { slug, name: text(item.name, `services[${index}].name`, true), summary: text(item.summary, `services[${index}].summary`, true), detail: text(item.detail, `services[${index}].detail`, true), active: item.active !== false, sortOrder: order(item.sortOrder) }; });
const coupons = list(document.coupons, "coupons").map((item, index) => ({ title: text(item.title, `coupons[${index}].title`, true), body: text(item.body, `coupons[${index}].body`, true), terms: text(item.terms, `coupons[${index}].terms`), active: item.active !== false, sortOrder: order(item.sortOrder) }));
const testimonials = list(document.testimonials, "testimonials").map((item, index) => { const rating = item.rating == null ? null : Number(item.rating); if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error(`testimonials[${index}].rating must be 1-5.`); return { quote: text(item.quote, `testimonials[${index}].quote`, true), attribution: text(item.attribution, `testimonials[${index}].attribution`), rating, active: item.active !== false, sortOrder: order(item.sortOrder) }; });
const gallery = list(document.gallery, "gallery").map((item, index) => { const imageUrl = text(item.imageUrl, `gallery[${index}].imageUrl`); if (imageUrl && !imageUrl.startsWith("https://")) throw new Error(`gallery[${index}].imageUrl must use HTTPS.`); return { title: text(item.title, `gallery[${index}].title`, true), caption: text(item.caption, `gallery[${index}].caption`), imageUrl, active: item.active !== false, sortOrder: order(item.sortOrder) }; });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
  if (shops.length !== 1) throw new Error("Marketing import requires exactly one configured shop.");
  console.log(`mode dry run: ${Number(dryRun)}`);
  console.log(`settings rows planned: 1`); console.log(`page rows planned: ${pages.length}`); console.log(`service rows planned: ${services.length}`);
  console.log(`coupon rows planned: ${coupons.length}`); console.log(`testimonial rows planned: ${testimonials.length}`); console.log(`gallery rows planned: ${gallery.length}`);
  if (dryRun) { console.log("database writes performed: 0"); }
  else {
    await prisma.$transaction(async (transaction) => {
      const shopId = shops[0].id;
      await transaction.marketingSetting.upsert({ where: { shopId }, create: { shopId, ...settings }, update: settings });
      for (const page of pages) await transaction.marketingPage.upsert({ where: { shopId_slug: { shopId, slug: page.slug } }, create: { shopId, ...page }, update: page });
      for (const service of services) await transaction.marketingService.upsert({ where: { shopId_slug: { shopId, slug: service.slug } }, create: { shopId, ...service }, update: service });
      await transaction.marketingCoupon.deleteMany({ where: { shopId } }); if (coupons.length) await transaction.marketingCoupon.createMany({ data: coupons.map((item) => ({ shopId, ...item })) });
      await transaction.marketingTestimonial.deleteMany({ where: { shopId } }); if (testimonials.length) await transaction.marketingTestimonial.createMany({ data: testimonials.map((item) => ({ shopId, ...item })) });
      await transaction.marketingGalleryItem.deleteMany({ where: { shopId } }); if (gallery.length) await transaction.marketingGalleryItem.createMany({ data: gallery.map((item) => ({ shopId, ...item })) });
    });
    console.log(`database write groups performed: ${3 + pages.length + services.length}`);
  }
} finally { await prisma.$disconnect(); }
