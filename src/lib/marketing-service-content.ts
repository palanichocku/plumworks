export type ServiceContent = {
  version: 1;
  heading: string;
  intro: string;
  signs: { heading: string; intro?: string; items: string[] };
  services: { heading: string; intro?: string; items: string[] };
  helpful: { heading: string; paragraphs: string[] };
  expectations: { heading: string; intro: string; items: string[] };
  faqs: Array<{ question: string; answer: string }>;
  related: Array<{ slug: string; label: string }>;
  cta: { heading: string; body: string; requestLabel: string; callLabel: string };
};

type UnknownRecord = Record<string, unknown>;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function record(value: unknown, name: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as UnknownRecord;
}

function text(value: unknown, name: string, maximum = 2000) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  if (value.trim().length > maximum) throw new Error(`${name} is too long.`);
  return value.trim();
}

function textList(value: unknown, name: string, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`${name} must contain at least ${minimum} item(s).`);
  return value.map((item, index) => text(item, `${name}[${index}]`));
}

export function parseServiceContent(value: unknown, name = "service content"): ServiceContent {
  const content = record(value, name);
  if (content.version !== 1) throw new Error(`${name}.version must be 1.`);
  const signs = record(content.signs, `${name}.signs`);
  const services = record(content.services, `${name}.services`);
  const helpful = record(content.helpful, `${name}.helpful`);
  const expectations = record(content.expectations, `${name}.expectations`);
  const cta = record(content.cta, `${name}.cta`);
  if (!Array.isArray(content.faqs) || content.faqs.length < 2 || content.faqs.length > 6) throw new Error(`${name}.faqs must contain 2-6 questions.`);
  if (!Array.isArray(content.related) || content.related.length > 4) throw new Error(`${name}.related must contain no more than 4 links.`);
  return {
    version: 1,
    heading: text(content.heading, `${name}.heading`, 160),
    intro: text(content.intro, `${name}.intro`),
    signs: { heading: text(signs.heading, `${name}.signs.heading`, 160), intro: typeof signs.intro === "string" && signs.intro.trim() ? text(signs.intro, `${name}.signs.intro`) : undefined, items: textList(signs.items, `${name}.signs.items`, 3) },
    services: { heading: text(services.heading, `${name}.services.heading`, 160), intro: typeof services.intro === "string" && services.intro.trim() ? text(services.intro, `${name}.services.intro`) : undefined, items: textList(services.items, `${name}.services.items`, 3) },
    helpful: { heading: text(helpful.heading, `${name}.helpful.heading`, 160), paragraphs: textList(helpful.paragraphs, `${name}.helpful.paragraphs`, 1) },
    expectations: { heading: text(expectations.heading, `${name}.expectations.heading`, 160), intro: text(expectations.intro, `${name}.expectations.intro`), items: textList(expectations.items, `${name}.expectations.items`, 3) },
    faqs: content.faqs.map((item, index) => { const faq = record(item, `${name}.faqs[${index}]`); return { question: text(faq.question, `${name}.faqs[${index}].question`, 240), answer: text(faq.answer, `${name}.faqs[${index}].answer`) }; }),
    related: content.related.map((item, index) => { const link = record(item, `${name}.related[${index}]`); const slug = text(link.slug, `${name}.related[${index}].slug`, 100); if (!SLUG.test(slug)) throw new Error(`${name}.related[${index}].slug is invalid.`); return { slug, label: text(link.label, `${name}.related[${index}].label`, 160) }; }),
    cta: { heading: text(cta.heading, `${name}.cta.heading`, 160), body: text(cta.body, `${name}.cta.body`), requestLabel: text(cta.requestLabel, `${name}.cta.requestLabel`, 80), callLabel: text(cta.callLabel, `${name}.cta.callLabel`, 80) },
  };
}

export function decodeServiceDetail(detail: string): { detail: string; content: ServiceContent | null } {
  try {
    const value = JSON.parse(detail) as unknown;
    const content = parseServiceContent(value);
    return { detail: content.intro, content };
  } catch {
    return { detail, content: null };
  }
}

export function encodeServiceContent(value: unknown, name?: string) {
  return JSON.stringify(parseServiceContent(value, name));
}
