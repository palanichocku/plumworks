import { HelpNavigation } from "@/components/help/help-navigation";

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Retaining the original navigation component to keep all tabs intact */}
      <HelpNavigation />
      <main>{children}</main>
    </div>
  );
}
