"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [workerStatus, setWorkerStatus] = useState<"online" | "offline" | "unknown">("unknown");

  useEffect(() => {
    let active = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/v3/worker/health");
        if (!res.ok) {
          if (active) {
            setWorkerStatus("unknown");
          }
          return;
        }
        const data = await res.json();
        if (active && data?.status) {
          setWorkerStatus(data.status);
        }
      } catch {
        if (active) {
          setWorkerStatus("unknown");
        }
      }
    };
    fetchStatus();
    const handle = window.setInterval(fetchStatus, 15000);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, []);

  const workerBadge = () => {
    const base = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
    if (workerStatus === "online") return `${base} bg-emerald-100 text-emerald-700`;
    if (workerStatus === "offline") return `${base} bg-rose-100 text-rose-700`;
    return `${base} bg-neutral-100 text-neutral-500`;
  };

  const workerLabel =
    workerStatus === "online"
      ? t("nav.workerOnline")
      : workerStatus === "offline"
        ? t("nav.workerOffline")
        : t("nav.workerUnknown");

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
        <div className="flex items-center gap-3 text-xs text-neutral-600">
          <span className={workerBadge()}>
            {t("nav.workerStatus")}: {workerLabel}
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3.75c4.556 0 8.25 3.694 8.25 8.25S16.556 20.25 12 20.25 3.75 16.556 3.75 12 7.444 3.75 12 3.75Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 12h16.5M12 3.75c2.5 2.3 3.75 5.2 3.75 8.25S14.5 17.95 12 20.25M12 3.75c-2.5 2.3-3.75 5.2-3.75 8.25S9.5 17.95 12 20.25"
                />
              </svg>
            </span>
            <Select
              value={locale}
              onChange={(event) => setLocale(event.target.value as "zh" | "en")}
              className="h-9 w-24 rounded-full border-neutral-300 bg-white pl-9 text-xs"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </Select>
          </div>
        </div>
      </div>
    </header>
  );
}
