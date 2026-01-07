"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export const dynamic = "force-dynamic";

type ActivityItem = {
  id: string;
  media_id?: string;
  run_id?: string;
  type: string;
  status: string;
  message: string;
  created_at: number;
};

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchActivity = async () => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    params.set("page", String(page));
    const res = await fetch(`/api/v3/activity?${params.toString()}`);
    const data = await res.json();
    if (data.ok) {
      setItems(data.items || []);
      setTotal(data.total || 0);
    }
  };

  useEffect(() => {
    fetchActivity();
  }, []);

  useEffect(() => {
    fetchActivity();
  }, [page]);

  useEffect(() => {
    if (page !== 1) {
      setPage(1);
      return;
    }
    fetchActivity();
  }, [type, status]);

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-5xl space-y-6">
        <h1 className="section-title">Activity</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">全部类型</option>
            <option value="media_added">Media added</option>
            <option value="status_change">Status change</option>
            <option value="retry">Retry</option>
            <option value="translate">Translate</option>
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">全部状态</option>
            <option value="pending">pending</option>
            <option value="running">running</option>
            <option value="failed">failed</option>
            <option value="done">done</option>
            <option value="info">info</option>
          </Select>
          <Button onClick={fetchActivity}>筛选</Button>
        </div>
        <div className="space-y-3">
          {items.length ? (
            items.map((item) => (
              <div key={item.id} className="glass-panel rounded-2xl px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-ink">{item.message}</div>
                  <div className="text-xs text-dune">{new Date(item.created_at * 1000).toLocaleString()}</div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-dune">
                  <span>type: {item.type}</span>
                  <span>status: {item.status}</span>
                  {item.media_id ? (
                    <Link href={`/media/${item.media_id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                      查看媒体
                    </Link>
                  ) : null}
                  {item.run_id ? (
                    <Link href={`/runs/${item.run_id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                      查看运行
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-dune">暂无活动记录</p>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-dune">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
          <span>第 {page} 页 · 共 {total} 条</span>
        </div>
      </section>
    </main>
  );
}
