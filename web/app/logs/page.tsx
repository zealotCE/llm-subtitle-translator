"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function downloadFile(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function LogsPage() {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [limit, setLimit] = useState("200");
  const [logs, setLogs] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const fetchLogs = async () => {
    setMessage("");
    const params = new URLSearchParams();
    if (keyword) params.set("q", keyword);
    if (limit) params.set("limit", limit);
    const res = await fetch(`/api/logs?${params.toString()}`);
    const data = await res.json();
    setLogs(data.logs || []);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const csv = useMemo(() => logs.map((line) => `"${line.replace(/\"/g, '""')}"`).join("\n"), [logs]);

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-5xl space-y-6">
        <h1 className="section-title">{t("logs.title")}</h1>
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder={t("logs.keyword")}
            className="max-w-xs"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Input
            placeholder={t("logs.limit")}
            className="max-w-[120px]"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <Button onClick={fetchLogs}>{t("common.search")}</Button>
          <Button variant="ghost" onClick={() => downloadFile("logs.json", JSON.stringify(logs, null, 2))}>
            {t("logs.exportJson")}
          </Button>
          <Button variant="ghost" onClick={() => downloadFile("logs.csv", csv)}>
            {t("logs.exportCsv")}
          </Button>
        </div>
        {message ? <p className="text-sm text-rose-600">{message}</p> : null}
        <div className="glass-panel rounded-2xl p-4 text-sm text-neutral-600">
          {logs.length ? (
            logs.map((line, idx) => (
              <p key={idx} className="border-b border-border py-2 last:border-none">
                {line}
              </p>
            ))
          ) : (
            <div className="space-y-2">
              <p>{t("logs.empty")}</p>
              <p className="text-xs text-neutral-500">{t("logs.emptyHint")}</p>
              <p className="text-xs text-neutral-500">{t("logs.emptyHint2")}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
