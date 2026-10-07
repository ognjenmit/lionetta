import type { Metadata } from "next";
import { LIONETTA_LOGO_SRC } from "./brand";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lionetta · From Complexity to Conversations",
  description: "One conversation. Every system. Explore Lionetta's client-branded assistant with connected inventory, pricing, and CRM.",
  icons: { icon: LIONETTA_LOGO_SRC, apple: LIONETTA_LOGO_SRC },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
