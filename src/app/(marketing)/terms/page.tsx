import type { Metadata } from "next";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { getPublicSeoShop, marketingMetadata } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
  const shop = await getPublicSeoShop();
  return marketingMetadata({
    title: `Website Terms of Service | ${shop.name}`,
    description: `Terms governing use of the ${shop.name} website and online service-request features.`,
    path: "/terms",
    siteName: shop.name,
  });
}

export default function TermsPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Terms"
        title="Website terms of service"
        description="Terms for using this website and submitting online service requests."
      />
      <section className="mx-auto max-w-3xl space-y-8 px-4 py-16 text-sm leading-7 text-slate-700 sm:px-6">
        <div>
          <h2 className="text-xl font-black text-slate-950">Website use</h2>
          <p className="mt-3">
            This website is provided to share information about the shop and to make it easier to contact the shop, request service, request an appointment, or provide drop-off details. By using the website, you agree to use it only for lawful purposes and to provide accurate information when submitting a request.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Service and appointment requests</h2>
          <p className="mt-3">
            Information submitted through the website is a request for follow-up and does not by itself create a confirmed appointment, repair order, estimate, authorization, or agreement to perform repairs. The shop may contact you to confirm availability, scope, timing, pricing, and any required authorization before work begins.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Estimates and repair authorization</h2>
          <p className="mt-3">
            Any estimate, diagnosis, repair recommendation, authorization, warranty, payment obligation, or other vehicle-service term is governed by the documents and communications provided for the specific repair order or invoice. Website content is general information and does not replace those transaction-specific terms.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Website information</h2>
          <p className="mt-3">
            The shop works to keep website information current and useful, but service descriptions, availability, hours, pricing references, offers, and other content may change. Contact the shop to confirm information that is important to your service decision.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Third-party services and links</h2>
          <p className="mt-3">
            The website may link to or use services operated by third parties, such as maps, reviews, email, or other online tools. Those third-party services are governed by their own terms and privacy practices.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Privacy</h2>
          <p className="mt-3">
            Information submitted through this website is handled as described in the Website Privacy page. Do not submit payment-card details, Social Security numbers, or other highly sensitive information through general website forms.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Availability of the website</h2>
          <p className="mt-3">
            The website may occasionally be unavailable or contain errors. To the extent permitted by law, the shop is not responsible for losses caused solely by temporary website unavailability, transmission problems, or reliance on general website content. This does not limit rights or obligations that apply to an actual vehicle repair transaction.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Changes to these terms</h2>
          <p className="mt-3">
            These website terms may be updated from time to time. The version posted on this page applies to use of the website after it is posted.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-950">Questions</h2>
          <p className="mt-3">
            Use the Contact page or call the shop if you have questions about these website terms or about a service request.
          </p>
        </div>
      </section>
    </>
  );
}
