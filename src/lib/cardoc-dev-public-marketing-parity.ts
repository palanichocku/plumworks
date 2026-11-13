// Dev-only public-content parity gate. Never enabled on Production, local development,
// or arbitrary PR previews. No operational DB data or credentials are copied.
export function cardocDevPublicMarketingParityEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.VERCEL_ENV === "preview"
    && environment.VERCEL_GIT_COMMIT_REF === "dev"
    && environment.NEXT_PUBLIC_SITE_URL === "https://dev.subbuscardoc.com";
}

export const cardocDevPublicShopDetails = {
  name: "Car Doc",
  addressLine1: "42464 Mound Road",
  city: "Sterling Heights",
  state: "MI",
  postalCode: "48314",
  phone: "(586) 843-3347",
} as const;
