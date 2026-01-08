"use client";

import { useEffect, useMemo, useState } from "react";
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
  media_title?: string;
  media_path?: string;
  type: string;
  status: string;
  message: string;
  created_at: number;
  progress?: number | null;
  stage?: string;
};

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [counts, setCounts] = useState<{
    total: number;
    type: Record<string, number>;
    status: Record<string, number>;
    processing: number;
  }>({ total: 0, type: {}, status: {}, processing: 0 });
  const { t } = useI18n();

  const formatMessage = (item: ActivityItem) => {
    if (item.type === "media_added") return t("activity.msg.media_added");
    if (item.type === "retry") return t("activity.msg.retry");
    if (item.type === "translate") return t("activity.msg.translate");
    if (item.type === "stage_asr_done") return t("activity.msg.stage_asr");
    if (item.type === "stage_translate_done") return t("activity.msg.stage_translate");
    if (item.type === "force") return t("activity.msg.force");
    if (item.type === "status_change") {
      return `${t("activity.msg.status_change")}: ${t(`status.${item.status}`) || item.status}`;
    }
    return item.message;
  };

  const formatProgress = (item: ActivityItem) => {
    if (item.status !== "running" || typeof item.progress !== "number") return "";
    const percent = Math.max(0, Math.min(100, Math.round(item.progress)));
    if (item.stage?.startsWith("asr")) return `${t("activity.progress.asr")} ${percent}%`;
    if (item.stage?.startsWith("translate")) return `${t("activity.progress.translate")} ${percent}%`;
    return `${t("activity.progress.running")} ${percent}%`;
  };

  const progressValue = (item: ActivityItem) => {
    if (item.status !== "running" || typeof item.progress !== "number") return null;
    return Math.max(0, Math.min(100, Math.round(item.progress)));
  };

  const formatStage = (value?: string) => {
    if (!value) return "";
    if (value.startsWith("asr")) return t("activity.stage.asr");
    if (value.startsWith("translate")) return t("activity.stage.translate");
    if (value === "probe") return t("activity.stage.probe");
    if (value === "subtitle_select") return t("activity.stage.subtitle");
    return value;
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
      setCounts(data.counts || { total: 0, type: {}, status: {}, processing: 0 });
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

  useEffect(() => {
    const handle = window.setInterval(() => {
      fetchActivity();
    }, 2000);
    return () => window.clearInterval(handle);
  }, [type, status, page, pageSize]);

  const typeCards = useMemo(
    () => [
      { key: "", label: t("activity.filterAll"), count: counts.total },
      { key: "media_added", label: t("activity.type.media_added"), count: counts.type.media_added || 0 },
      { key: "status_change", label: t("activity.type.status_change"), count: counts.type.status_change || 0 },
      { key: "retry", label: t("activity.type.retry"), count: counts.type.retry || 0 },
      { key: "translate", label: t("activity.type.translate"), count: counts.type.translate || 0 },
      { key: "force", label: t("activity.type.force"), count: counts.type.force || 0 },
      { key: "stage_asr_done", label: t("activity.type.stage_asr"), count: counts.type.stage_asr_done || 0 },
      {
        key: "stage_translate_done",
        label: t("activity.type.stage_translate"),
        count: counts.type.stage_translate_done || 0,
      },
    ],
    [counts, t]
  );

  const statusChips = useMemo(
    () => [
      { key: "", label: t("activity.filterAll"), count: counts.total },
      { key: "processing", label: t("activity.filter.processing"), count: counts.processing || 0 },
      { key: "failed", label: t("status.failed"), count: counts.status.failed || 0 },
      { key: "done", label: t("status.done"), count: counts.status.done || 0 },
      { key: "info", label: t("status.info"), count: counts.status.info || 0 },
    ],
    [counts, t]
  );

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-5xl space-y-6">
        <h1 className="section-title">{t("activity.title")}</h1>
        <div className="grid gap-3 md:grid-cols-4">
          {typeCards.map((card) => (
            <button
              key={card.key || "all"}
              type="button"
              onClick={() => setType(card.key)}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                type === card.key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white/70"
              }`}
            >
              <div className="text-xs uppercase tracking-[0.2em] opacity-70">{card.label}</div>
              <div className="mt-2 text-2xl font-semibold">{card.count}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {statusChips.map((chip) => (
            <Button
              key={chip.key || "all"}
              variant={status === chip.key ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus(chip.key)}
            >
              {chip.label} · {chip.count}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">{t("activity.filterAll")}</option>
            <option value="media_added">{t("activity.type.media_added")}</option>
            <option value="status_change">{t("activity.type.status_change")}</option>
            <option value="retry">{t("activity.type.retry")}</option>
            <option value="translate">{t("activity.type.translate")}</option>
            <option value="force">{t("activity.type.force")}</option>
            <option value="stage_asr_done">{t("activity.type.stage_asr")}</option>
            <option value="stage_translate_done">{t("activity.type.stage_translate")}</option>
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t("activity.filterAll")}</option>
            <option value="processing">{t("activity.filter.processing")}</option>
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
        </div>
        <div className="space-y-3">
          {items.length ? (
            items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-neutral-900">{formatMessage(item)}</div>
                    {item.media_title ? (
                      <div className="text-xs text-neutral-500">{item.media_title}</div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-500">
                      <span>
                        {t("activity.type")}: {t(`activity.type.${item.type}`) || item.type}
                      </span>
                      <span>
                        {t("activity.status")}: {t(`status.${item.status}`) || item.status}
                      </span>
                      {formatStage(item.stage) ? (
                        <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500">
                          {formatStage(item.stage)}
                        </span>
                      ) : null}
                      {formatProgress(item) ? <span>{formatProgress(item)}</span> : null}
                      <span>{new Date(item.created_at * 1000).toLocaleString()}</span>
                    </div>
                    {progressValue(item) !== null ? (
                      <div className="mt-2 h-2 w-full max-w-xs rounded-full bg-neutral-100">
                        <div
                          className="h-2 rounded-full bg-neutral-900 transition-all"
                          style={{ width: `${progressValue(item)}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
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
        <div className="text-xs text-neutral-400">
          <Link href="/logs" className="hover:text-neutral-700">
            {t("activity.systemLogs")}
          </Link>
        </div>
      </section>
    </main>
  );
}
