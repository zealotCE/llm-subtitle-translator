"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type RunItem = {
  id: string;
  media_id: string;
  type: string;
  status: string;
  started_at: number;
  finished_at?: number;
  error?: string;
  log_ref?: string;
};

export default function RunDetailPage({ params }: { params: { runId: string } }) {
  const [run, setRun] = useState<RunItem | null>(null);
  const [log, setLog] = useState("");
  const [message, setMessage] = useState("");
  const { t } = useI18n();

  const fetchRun = async () => {
    const res = await fetch(`/api/v3/runs/${params.runId}`);
    const data = await res.json();
    if (data.ok) {
      setRun(data.run);
    }
  };

  const fetchLog = async () => {
    const res = await fetch(`/api/v3/runs/${params.runId}/log`);
    const data = await res.json();
    if (data.ok) {
      setLog(data.log || "");
    }
  };

  const retryRun = async () => {
    setMessage("");
    const res = await fetch(`/api/v3/runs/${params.runId}/retry`, { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || t("common.failed"));
      return;
    }
    fetchRun();
  };

  useEffect(() => {
    fetchRun();
    fetchLog();
  }, [params.runId]);

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">{t("run.title")}</h1>
        {run ? (
          <div className="glass-panel rounded-2xl p-4 space-y-2 text-sm">
            <div>
              {t("run.field.id")}: {run.id}
            </div>
            <div>
              {t("run.field.media")}: {run.media_id}
            </div>
            <div>
              {t("run.field.type")}: {run.type}
            </div>
            <div>
              {t("run.field.status")}: {run.status}
            </div>
            <div>
              {t("run.field.started")}: {new Date(run.started_at * 1000).toLocaleString()}
            </div>
            {run.finished_at ? (
              <div>
                {t("run.field.finished")}: {new Date(run.finished_at * 1000).toLocaleString()}
              </div>
            ) : null}
            {run.finished_at ? (
              <div>
                {t("run.field.duration")}: {run.finished_at - run.started_at}s
              </div>
            ) : null}
            {run.error ? <div className="text-rose-600">Error: {run.error}</div> : null}
            {run.log_ref ? <div>Log: {run.log_ref}</div> : null}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t("common.loading")}</p>
        )}
        {message ? <p className="text-sm text-rose-600">{message}</p> : null}
        <div className="glass-panel rounded-2xl p-4 text-sm text-neutral-600">
          <div className="mb-2 flex items-center justify-between">
            <span>{t("run.log")}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={fetchLog}>
                {t("common.refresh")}
              </Button>
              <Button size="sm" onClick={retryRun}>
                {t("common.retry")}
              </Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap">{log || t("run.noLog")}</pre>
        </div>
      </section>
    </main>
  );
}
