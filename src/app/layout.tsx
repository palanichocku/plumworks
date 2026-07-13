import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Car Doc",
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
