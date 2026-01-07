"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";

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
      setMessage(data.message || "重试失败");
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
        <h1 className="section-title">Run Detail</h1>
        {run ? (
          <div className="glass-panel rounded-2xl p-4 space-y-2 text-sm">
            <div>ID: {run.id}</div>
            <div>Media: {run.media_id}</div>
            <div>Type: {run.type}</div>
            <div>Status: {run.status}</div>
            <div>Started: {new Date(run.started_at * 1000).toLocaleString()}</div>
            {run.finished_at ? <div>Finished: {new Date(run.finished_at * 1000).toLocaleString()}</div> : null}
            {run.error ? <div className="text-rose-600">Error: {run.error}</div> : null}
          </div>
        ) : (
          <p className="text-sm text-dune">加载中…</p>
        )}
        {message ? <p className="text-sm text-ember">{message}</p> : null}
        <div className="glass-panel rounded-2xl p-4 text-sm text-dune">
          <div className="mb-2 flex items-center justify-between">
            <span>日志</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={fetchLog}>
                刷新
              </Button>
              <Button size="sm" onClick={retryRun}>
                Retry
              </Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap">{log || "暂无日志"}</pre>
        </div>
      </section>
    </main>
  );
}
