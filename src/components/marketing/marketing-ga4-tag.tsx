import Script from "next/script";

// Only the public marketing layout renders this tag. The shop application does not.
// A valid measurement ID must be explicitly configured for each environment.
export function MarketingGa4Tag() {
  const id = process.env.GA4_MEASUREMENT_ID?.trim();
  if (!id || !/^G-[A-Z0-9]{5,15}$/.test(id)) return null;
  return <>
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`} strategy="afterInteractive" />
    <Script id="marketing-ga4-config" strategy="afterInteractive">
      {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(id)});`}
    </Script>
  </>;
}
