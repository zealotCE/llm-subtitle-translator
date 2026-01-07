"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type MediaItem = {
  id: string;
  title: string;
  path: string;
  status: string;
  outputs: {
    raw?: { id: string; path: string };
    zh?: { id: string; path: string };
    bi?: { id: string; path: string };
  };
  updated_at: number;
  archived: boolean;
};

const filters = [
  { key: "missing_zh", label: "缺简中" },
  { key: "failed", label: "失败" },
  { key: "running", label: "处理中" },
  { key: "archived", label: "已归档" },
];

function statusBadge(status: string) {
  const base = "rounded-full px-2 py-1 text-xs font-semibold";
  switch (status) {
    case "running":
      return `${base} bg-amber-100 text-amber-800`;
    case "done":
      return `${base} bg-emerald-100 text-emerald-800`;
    case "failed":
      return `${base} bg-rose-100 text-rose-800`;
    case "archived":
      return `${base} bg-slate-200 text-slate-700`;
    default:
      return `${base} bg-slate-100 text-slate-700`;
  }
}

function downloadFile(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function LibraryPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("updated_desc");
  const [pageSize, setPageSize] = useState(50);

  const fetchMedia = async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (selected.length) params.set("filter", selected.join(","));
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    params.set("sort", sort);
    const res = await fetch(`/api/v3/media?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "加载失败");
      return;
    }
    setItems(data.items || []);
    setTotal(data.total || 0);
  };

  useEffect(() => {
    fetchMedia();
  }, [page, sort, pageSize]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(1);
      fetchMedia();
    }, 200);
    return () => clearTimeout(handle);
  }, [query, selected]);

  const toggleFilter = (key: string) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
    setPage(1);
  };

  const handleAction = async (id: string, action: "archive" | "unarchive" | "retry" | "translate") => {
    const res = await fetch(`/api/v3/media/${id}/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "操作失败");
      return;
    }
    fetchMedia();
  };

  const filteredCount = items.length;
  const missingZhCount = useMemo(
    () => items.filter((item) => !item.outputs?.zh).length,
    [items]
  );
  const triggerScan = async () => {
    await fetch("/api/v3/scan", { method: "POST" });
    fetchMedia();
  };
  const csv = useMemo(() => {
    const header = ["id", "title", "path", "status", "has_raw", "has_zh", "has_bi"];
    const lines = items.map((item) =>
      [
        item.id,
        item.title,
        item.path,
        item.status,
        item.outputs?.raw ? "yes" : "no",
        item.outputs?.zh ? "yes" : "no",
        item.outputs?.bi ? "yes" : "no",
      ]
        .map((cell) => `"${String(cell).replace(/\"/g, '""')}"`)
        .join(",")
    );
    return [header.join(","), ...lines].join("\n");
  }, [items]);
  const missingItems = useMemo(() => items.filter((item) => !item.outputs?.zh), [items]);
  const csvMissing = useMemo(() => {
    const header = ["id", "title", "path", "status"];
    const lines = missingItems.map((item) =>
      [item.id, item.title, item.path, item.status]
        .map((cell) => `"${String(cell).replace(/\"/g, '""')}"`)
        .join(",")
    );
    return [header.join(","), ...lines].join("\n");
  }, [missingItems]);

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-6xl space-y-6">
        <h1 className="section-title">Library</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="搜索文件名或标题"
            className="max-w-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button onClick={fetchMedia}>搜索</Button>
          <select
            className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="updated_desc">最近更新</option>
            <option value="created_desc">最近创建</option>
            <option value="failed_first">失败优先</option>
          </select>
          <select
            className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
            value={String(pageSize)}
            onChange={(event) => setPageSize(Number(event.target.value))}
          >
            <option value="20">20/页</option>
            <option value="50">50/页</option>
            <option value="100">100/页</option>
          </select>
          <Button variant="outline" onClick={triggerScan}>
            Rescan
          </Button>
          <Link className={buttonVariants({ variant: "outline" })} href="/import">
            Import Media
          </Link>
          {filters.map((filter) => (
            <Button
              key={filter.key}
              variant={selected.includes(filter.key) ? "default" : "outline"}
              onClick={() => toggleFilter(filter.key)}
            >
              {filter.label}
            </Button>
          ))}
          <span className="text-sm text-dune">总数 {total} · 当前 {filteredCount} · 缺简中 {missingZhCount}</span>
          <Button variant="ghost" onClick={() => downloadFile("media.json", JSON.stringify(items, null, 2))}>
            导出 JSON
          </Button>
          <Button variant="ghost" onClick={() => downloadFile("media.csv", csv)}>
            导出 CSV
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadFile("missing_zh.json", JSON.stringify(missingItems, null, 2))}
          >
            导出缺简中 JSON
          </Button>
          <Button variant="ghost" onClick={() => downloadFile("missing_zh.csv", csvMissing)}>
            导出缺简中 CSV
          </Button>
        </div>
        {message ? <p className="text-sm text-ember">{message}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>标题</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>字幕</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length ? (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-md truncate">
                    <div className="font-medium text-ink">{item.title}</div>
                    <div className="text-xs text-dune truncate">{item.path}</div>
                  </TableCell>
                  <TableCell>
                    <span className={statusBadge(item.status)}>{item.status}</span>
                  </TableCell>
                  <TableCell className="space-x-2 text-xs">
                    <span className={item.outputs?.raw ? "text-emerald-700" : "text-slate-400"}>raw</span>
                    <span className={item.outputs?.zh ? "text-emerald-700" : "text-slate-400"}>zh</span>
                    <span className={item.outputs?.bi ? "text-emerald-700" : "text-slate-400"}>bi</span>
                  </TableCell>
                  <TableCell className="flex flex-wrap gap-2">
                    <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/media/${item.id}`}>
                      Open
                    </Link>
                    {item.outputs?.raw || item.outputs?.zh || item.outputs?.bi ? (
                      <Link
                        className={buttonVariants({ size: "sm", variant: "ghost" })}
                        href={`/media/${item.id}/editor`}
                      >
                        Edit
                      </Link>
                    ) : null}
                    {item.status === "failed" ? (
                      <Button size="sm" onClick={() => handleAction(item.id, "retry")}>
                        Retry
                      </Button>
                    ) : null}
                    {!item.outputs?.zh ? (
                      <Button size="sm" variant="outline" onClick={() => handleAction(item.id, "translate")}>
                        Translate
                      </Button>
                    ) : null}
                    {item.outputs?.zh || item.outputs?.raw || item.outputs?.bi ? (
                      <a
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={`/api/v3/media/${item.id}/subtitles/${
                          item.outputs?.zh?.id || item.outputs?.bi?.id || item.outputs?.raw?.id
                        }/download`}
                      >
                        Export
                      </a>
                    ) : null}
                    {item.archived ? (
                      <Button size="sm" variant="ghost" onClick={() => handleAction(item.id, "unarchive")}>
                        Unarchive
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => handleAction(item.id, "archive")}>
                        Archive
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4}>暂无媒体</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center gap-3 text-sm text-dune">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => (items.length === 0 ? p : p + 1))}
          >
            下一页
          </Button>
          <span>第 {page} 页 · 共 {total} 条</span>
        </div>
      </section>
    </main>
  );
}
