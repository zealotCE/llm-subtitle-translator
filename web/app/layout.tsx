import "./globals.css";
import type { Metadata } from "next";
import { Space_Grotesk, Source_Sans_3 } from "next/font/google";
import { LocaleProvider } from "@/lib/i18n";
import { TopNav } from "@/components/top-nav";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Auto Subtitle Studio",
  description: "Local subtitle factory control room",
};

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const bodyFont = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-body",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className={`app-shell ${displayFont.variable} ${bodyFont.variable}`}>
        <LocaleProvider>
          <ToastProvider>
            <TopNav />
            {children}
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
