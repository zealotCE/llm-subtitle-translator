"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Summary = {
  counts: {
    total: number;
    pending: number;
    running: number;
    failed: number;
    done: number;
    archived: number;
    missing_zh: number;
  };
  recent_failed: { id: string; title: string }[];
  recent_done: { id: string; title: string }[];
};

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    fetch("/api/v3/summary")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setSummary(data);
        }
      })
      .catch(() => {
        setSummary(null);
      });
  }, []);

  return (
    <main className="min-h-screen px-6 py-12">
      <AuthGuard />
      <section className="mx-auto max-w-6xl space-y-10">
        <div className="flex flex-col gap-4">
          <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">Auto Subtitle Studio</p>
          <h1 className="font-display text-4xl text-neutral-900 md:text-5xl">{t("dashboard.title")}</h1>
          <p className="max-w-2xl text-neutral-500">{t("dashboard.subtitle")}</p>
          <div className="flex gap-3">
            <Link href="/library" className={buttonVariants({ variant: "default" })}>
              {t("dashboard.openLibrary")}
            </Link>
            <Link href="/activity" className={buttonVariants({ variant: "outline" })}>
              {t("dashboard.viewActivity")}
            </Link>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.total")}</CardTitle>
              <CardDescription>{t("dashboard.totalDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl text-neutral-900">{summary?.counts.total ?? "-"}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.active")}</CardTitle>
              <CardDescription>{t("dashboard.activeDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl text-neutral-900">
              {summary ? summary.counts.pending + summary.counts.running : "-"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.missingZh")}</CardTitle>
              <CardDescription>{t("dashboard.missingZhDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl text-neutral-900">
              {summary?.counts.missing_zh ?? "-"}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.recentFailed")}</CardTitle>
              <CardDescription>{t("dashboard.recentFailedDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-neutral-500">
              {summary?.recent_failed?.length ? (
                summary.recent_failed.map((item) => (
                  <Link key={item.id} href={`/media/${item.id}`} className="block hover:text-neutral-900">
                    {item.title}
                  </Link>
                ))
              ) : (
                <p>{t("library.empty")}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.recentDone")}</CardTitle>
              <CardDescription>{t("dashboard.recentDoneDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-neutral-500">
              {summary?.recent_done?.length ? (
                summary.recent_done.map((item) => (
                  <Link key={item.id} href={`/media/${item.id}`} className="block hover:text-neutral-900">
                    {item.title}
                  </Link>
                ))
              ) : (
                <p>{t("library.empty")}</p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>{t("dashboard.footerHint")}</span>
          <Link href="/logs" className="hover:text-neutral-700">
            {t("activity.systemLogs")}
          </Link>
        </div>
      </section>
    </main>
  );
}
