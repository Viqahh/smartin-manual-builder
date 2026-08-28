import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smartin Manual Builder",
  description: "Workspace dokumentasi Expert Advisor PT Smartin Advisor Sistem",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
