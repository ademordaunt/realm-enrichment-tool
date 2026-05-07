import type { Metadata } from "next";
import { Golos_Text, Onest } from "next/font/google";
import "./globals.css";

const golosText = Golos_Text({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-golos-text",
});

const onest = Onest({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-onest",
});

export const metadata: Metadata = {
  title: "Realm Enrichment Tool",
  description: "Transform event lead lists into HubSpot-ready records",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${golosText.variable} ${onest.variable}`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
