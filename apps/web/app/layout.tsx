import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lionetta · Your next car starts with a conversation",
  description: "A local Lionetta demo for conversational vehicle search and confirmed CRM actions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
