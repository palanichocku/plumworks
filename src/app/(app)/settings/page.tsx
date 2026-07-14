import { PageHeading } from "@/components/page-heading";

export default function SettingsPage() {
  return (
    <>
      <PageHeading
        eyebrow="Workspace"
        title="Settings"
        description="Manage general application and shop preferences."
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Shop profile</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Configuration controls will be added after the application foundation
          is established.
        </p>
      </section>
    </>
  );
}
