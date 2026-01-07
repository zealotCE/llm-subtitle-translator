"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

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
  const [pageSize, setPageSize] = useState(50);
  const { t } = useI18n();

  const formatMessage = (item: ActivityItem) => {
    if (item.type === "media_added") return t("activity.msg.media_added");
    if (item.type === "retry") return t("activity.msg.retry");
    if (item.type === "translate") return t("activity.msg.translate");
    if (item.type === "status_change") {
      return `${t("activity.msg.status_change")}: ${t(`status.${item.status}`) || item.status}`;
    }
    return item.message;
  };

  const fetchActivity = async () => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
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
  }, [page, pageSize]);

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
        <h1 className="section-title">{t("activity.title")}</h1>
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">{t("activity.filterAll")}</option>
            <option value="media_added">{t("activity.type.media_added")}</option>
            <option value="status_change">{t("activity.type.status_change")}</option>
            <option value="retry">{t("activity.type.retry")}</option>
            <option value="translate">{t("activity.type.translate")}</option>
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t("activity.filterAll")}</option>
            <option value="pending">{t("status.pending")}</option>
            <option value="running">{t("status.running")}</option>
            <option value="failed">{t("status.failed")}</option>
            <option value="done">{t("status.done")}</option>
            <option value="info">{t("status.info")}</option>
          </Select>
          <Select value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value="20">20/页</option>
            <option value="50">50/页</option>
            <option value="100">100/页</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={fetchActivity}>{t("common.search")}</Button>
          <Link href="/logs" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("activity.systemLogs")}
          </Link>
        </div>
        <div className="space-y-3">
          {items.length ? (
            items.map((item) => (
              <div key={item.id} className="glass-panel rounded-2xl px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-neutral-900">{formatMessage(item)}</div>
                  <div className="text-xs text-neutral-500">
                    {new Date(item.created_at * 1000).toLocaleString()}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500">
                  <span>
                    {t("activity.type")}: {t(`activity.type.${item.type}`) || item.type}
                  </span>
                  <span>
                    {t("activity.status")}: {t(`status.${item.status}`) || item.status}
                  </span>
                  {item.media_id ? (
                    <Link
                      href={`/media/${item.media_id}`}
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                    >
                      {t("activity.mediaLink")}
                    </Link>
                  ) : null}
                  {item.run_id ? (
                    <Link
                      href={`/runs/${item.run_id}`}
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                    >
                      {t("activity.runLink")}
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-neutral-500">{t("activity.empty")}</p>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {t("common.prev")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
          </Button>
          <span>
            {t("common.page")} {page} · {t("common.of")} {total}
          </span>
        </div>
      </section>
    </main>
  );
}
