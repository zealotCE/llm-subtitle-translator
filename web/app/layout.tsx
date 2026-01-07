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
        <header className="border-b border-border/60 bg-white/70 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="text-sm font-semibold text-ink">Auto Subtitle Studio</div>
            <nav className="flex flex-wrap gap-4 text-sm text-dune">
              <a href="/">Dashboard</a>
              <a href="/library">Library</a>
              <a href="/import">Import</a>
              <a href="/activity">Activity</a>
              <a href="/settings">Settings</a>
              <a href="/admin">Advanced</a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
