"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { Select } from "@/components/ui/select";

const NAV_ITEMS = [
  { href: "/", key: "nav.dashboard" },
  { href: "/library", key: "nav.library" },
  { href: "/import", key: "nav.import" },
  { href: "/activity", key: "nav.activity" },
  { href: "/settings", key: "nav.settings" },
];

export function TopNav() {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-800">
          Auto Subtitle Studio
        </div>
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-3 py-1.5 transition ${
                  active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <span>{t("nav.language")}</span>
          <Select
            value={locale}
            onChange={(event) => setLocale(event.target.value as "zh" | "en")}
            className="h-9 w-24 rounded-full border-neutral-300 bg-white text-xs"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </Select>
        </div>
      </div>
    </header>
  );
}
