import "./globals.css";
import type { Metadata } from "next";
import { LocaleProvider } from "@/lib/i18n";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Auto Subtitle Studio",
  description: "Local subtitle factory control room",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="app-shell">
        <LocaleProvider>
          <TopNav />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
