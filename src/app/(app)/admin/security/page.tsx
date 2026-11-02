import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getShopSecuritySettings } from "@/lib/auth/shop-security-settings";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { updateSecuritySettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ membership }, { saved }] = await Promise.all([
    getCurrentMembership(),
    searchParams,
  ]);

  if (!membership) return null;
  if (!hasPermission(membership.role, "edit_shop_settings")) return <PermissionDenied />;

  const settings = await getShopSecuritySettings(membership.shopId);
  const canChangeSecurity = membership.role === "OWNER";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Admin"
        title="Security"
        description="Control sign-in protections for this shop."
      />

      {saved === "1" ? (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Security settings saved.
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="max-w-2xl">
          <h2 className="text-base font-bold text-slate-900">Authenticator app MFA</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            When enabled, every shop user must verify a 6-digit code from a TOTP authenticator app after entering their password. Google Authenticator is supported, along with other standard authenticator apps.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            This setting is off by default. Turning it on will require users who have not enrolled yet to complete authenticator setup before they can enter the workspace.
          </p>

          <form action={updateSecuritySettings} className="mt-6">
            <label className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4 ${canChangeSecurity ? "cursor-pointer" : "opacity-70"}`}>
              <input
                name="mfaRequired"
                type="checkbox"
                defaultChecked={settings.mfaRequired}
                disabled={!canChangeSecurity}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Require authenticator app MFA</span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">
                  Require an AAL2 session before allowing access to PlumWorks.
                </span>
              </span>
            </label>

            {!canChangeSecurity ? (
              <p className="mt-3 text-sm text-slate-600">Only an OWNER can change login security requirements.</p>
            ) : null}

            <button
              type="submit"
              disabled={!canChangeSecurity}
              className="mt-5 rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Security Settings
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
