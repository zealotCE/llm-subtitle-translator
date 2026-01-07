"use client";

import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">{t("nav.advanced")}</h1>
        <p className="text-sm text-neutral-500">{t("admin.notice")}</p>
        <Link href="/settings" className={buttonVariants({ variant: "outline" })}>
          {t("admin.openSettings")}
        </Link>
      </section>
    </main>
  );
}
