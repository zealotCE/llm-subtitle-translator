"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";

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
          <p className="text-sm uppercase tracking-[0.3em] text-dune">Auto Subtitle Studio</p>
          <h1 className="font-display text-4xl text-ember md:text-5xl">Dashboard</h1>
          <p className="max-w-2xl text-dune">关注媒体处理进度与失败项，快速进入 Library 处理。</p>
          <div className="flex gap-3">
            <Link href="/library" className={buttonVariants({ variant: "default" })}>
              打开 Library
            </Link>
            <Link href="/activity" className={buttonVariants({ variant: "outline" })}>
              查看 Activity
            </Link>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>总媒体数</CardTitle>
              <CardDescription>所有已发现的媒体</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl text-ember">{summary?.counts.total ?? "-"}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>处理中</CardTitle>
              <CardDescription>pending / running</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl text-ember">
              {summary ? summary.counts.pending + summary.counts.running : "-"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>缺简中</CardTitle>
              <CardDescription>需要翻译的条目</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl text-ember">{summary?.counts.missing_zh ?? "-"}</CardContent>
          </Card>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>最近失败</CardTitle>
              <CardDescription>需要关注的媒体</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-dune">
              {summary?.recent_failed?.length ? (
                summary.recent_failed.map((item) => (
                  <Link key={item.id} href={`/media/${item.id}`} className="block hover:text-ember">
                    {item.title}
                  </Link>
                ))
              ) : (
                <p>暂无失败记录</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>最近完成</CardTitle>
              <CardDescription>最新完成的字幕</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-dune">
              {summary?.recent_done?.length ? (
                summary.recent_done.map((item) => (
                  <Link key={item.id} href={`/media/${item.id}`} className="block hover:text-ember">
                    {item.title}
                  </Link>
                ))
              ) : (
                <p>暂无完成记录</p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
