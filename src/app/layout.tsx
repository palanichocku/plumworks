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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // If you used a different key in your theme switcher, update 'theme' here
                let theme = localStorage.getItem('theme');
                if (!theme) {
                  theme = 'classic';
                }
                document.documentElement.setAttribute('data-theme', theme);
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}