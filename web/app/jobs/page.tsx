"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type JobRow = {
  path: string;
  status: string;
  mtime: number;
  asr_mode?: string;
  segment_mode?: string;
};

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

export default function JobsPage() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setRows(data.jobs || []);
    } catch {
      setMessage("加载任务失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleTriggerScan = async () => {
    setMessage("");
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "trigger_scan" }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "触发失败");
      return;
    }
    setMessage("已触发扫描");
    fetchJobs();
  };

  const csv = useMemo(() => {
    const header = ["path", "status", "mtime", "asr_mode", "segment_mode"];
    const lines = rows.map((row) =>
      [row.path, row.status, row.mtime, row.asr_mode || "", row.segment_mode || ""]
        .map((cell) => `"${String(cell).replace(/\"/g, '""')}"`)
        .join(",")
    );
    return [header.join(","), ...lines].join("\n");
  }, [rows]);

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-5xl space-y-6">
        <h1 className="section-title">任务</h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleTriggerScan}>
            触发扫描
          </Button>
          <Button variant="ghost" onClick={() => downloadFile("jobs.json", JSON.stringify(rows, null, 2))}>
            导出 JSON
          </Button>
          <Button variant="ghost" onClick={() => downloadFile("jobs.csv", csv)}>
            导出 CSV
          </Button>
        </div>
        {message ? <p className="text-sm text-ember">{message}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>路径</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>ASR</TableHead>
              <TableHead>切片</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>加载中…</TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow key={row.path}>
                  <TableCell className="max-w-md truncate">{row.path}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>{row.asr_mode || "-"}</TableCell>
                  <TableCell>{row.segment_mode || "-"}</TableCell>
                  <TableCell>
                    <Link
                      href={`/subtitle?video=${encodeURIComponent(row.path)}`}
                      className={buttonVariants({ size: "sm" })}
                    >
                      字幕
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5}>暂无任务</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}
