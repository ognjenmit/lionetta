import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lionetta · Intelligence connects everything",
  description: "One conversation. Every system. Explore Lionetta's client-branded assistant with connected inventory, pricing, and CRM.",
  icons: { icon: "/brand/lionetta-lion.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
