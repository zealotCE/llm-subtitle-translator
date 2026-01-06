import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const tiles = [
  { href: "/settings", title: "设置", desc: "环境变量与运行参数" },
  { href: "/upload", title: "上传", desc: "提交媒体与选择 ASR 模式" },
  { href: "/jobs", title: "任务", desc: "任务队列与状态" },
  { href: "/logs", title: "日志", desc: "运行日志与筛选导出" },
  { href: "/media", title: "媒体库", desc: "媒体归档与元数据" },
  { href: "/subtitle", title: "字幕", desc: "字幕预览与编辑" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-12">
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4">
          <p className="text-sm uppercase tracking-[0.3em] text-dune">Auto Subtitle Studio</p>
          <h1 className="font-display text-4xl text-ember md:text-5xl">本地字幕工厂控制台</h1>
          <p className="max-w-2xl text-dune">
            聚合任务、媒体与翻译流程，统一管理字幕生成与质量评估。
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {tiles.map((tile) => (
            <Link key={tile.href} href={tile.href}>
              <Card className="transition hover:-translate-y-1 hover:shadow-xl">
                <CardHeader>
                  <CardTitle>{tile.title}</CardTitle>
                  <CardDescription>{tile.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="text-sm text-dune">进入模块 →</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
