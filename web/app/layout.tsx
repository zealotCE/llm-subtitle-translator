import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auto Subtitle Studio",
  description: "Local subtitle factory control room",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="gradient-bg">
        {children}
      </body>
    </html>
  );
}
