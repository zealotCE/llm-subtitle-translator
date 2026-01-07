"use client";

import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">Advanced</h1>
        <p className="text-sm text-dune">
          高级功能会暴露工程配置与底层路径。普通用户请使用 Settings 的分组配置。
        </p>
        <Link href="/settings" className={buttonVariants({ variant: "outline" })}>
          打开 Settings（含 Advanced）
        </Link>
      </section>
    </main>
  );
}
