import { redirect } from "next/navigation";

// Next config redirects this URL before the Admin permission boundary.
export default function LegacyAdminLeadsPage() { redirect("/leads"); }
