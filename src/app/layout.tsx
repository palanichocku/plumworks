import type { Metadata } from "next";
import "./globals.css";
import { softwareBrandName } from "@/lib/branding";

export const metadata: Metadata = {
  title: `${softwareBrandName} Shop Management`,
  description: "A cloud-first workspace for auto repair shops.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
