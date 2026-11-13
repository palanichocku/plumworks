/**
 * Public warranty display is explicitly opt-in for each deployed shop.
 * Do not set the flag before verifying current program participation,
 * eligibility rules, and approved public wording with the shop owner.
 *
 * Allowed: PLUMWORKS_PUBLIC_WARRANTY_PROGRAMS=both|protection-plus|provantage
 */
export type WarrantyProgram = {
  id: "protection-plus" | "provantage";
  title: string;
  duration: string;
  miles: string;
  url: string;
};

const programs: WarrantyProgram[] = [
  {
    id: "protection-plus",
    title: "Nationwide Protection Plus",
    duration: "3 years",
    miles: "36,000 miles",
    url: "https://www.nationwideprotectionplus.com/",
  },
  {
    id: "provantage",
    title: "ProVantage Nationwide Worry-Free Warranty",
    duration: "2 years",
    miles: "24,000 miles",
    url: "https://www.provantagenetwork.com/",
  },
];

export function getPublicWarrantyPrograms(): WarrantyProgram[] {
  const selection = process.env.PLUMWORKS_PUBLIC_WARRANTY_PROGRAMS?.trim().toLowerCase();
  if (selection === "both") return programs;
  if (selection === "protection-plus" || selection === "provantage") {
    return programs.filter((program) => program.id === selection);
  }
  return [];
}
