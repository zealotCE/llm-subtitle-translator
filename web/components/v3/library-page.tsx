"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

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

function statusBadge(status: string) {
  const base = "rounded-full px-2 py-1 text-xs font-semibold";
  switch (status) {
    case "running":
      return `${base} bg-amber-100 text-amber-900`;
    case "done":
      return `${base} bg-emerald-100 text-emerald-900`;
    case "failed":
      return `${base} bg-rose-100 text-rose-900`;
    case "archived":
      return `${base} bg-neutral-200 text-neutral-700`;
    default:
      return `${base} bg-neutral-100 text-neutral-700`;
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
  const router = useRouter();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("updated_desc");
  const [pageSize, setPageSize] = useState(50);
  const { pushToast } = useToast();

  const filters = [
    { key: "missing_zh", label: t("library.filter.missingZh") },
    { key: "failed", label: t("library.filter.failed") },
    { key: "running", label: t("library.filter.running") },
    { key: "archived", label: t("library.filter.archived") },
  ];

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
      const msg = data.message || t("common.loadFailed");
      setMessage(msg);
      pushToast(msg, "error");
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
      const msg = data.message || t("common.actionFailed");
      setMessage(msg);
      pushToast(msg, "error");
      return;
    }
    pushToast(t("toast.actionTriggered"), "success");
    fetchMedia();
  };

  const filteredCount = items.length;
  const missingZhCount = useMemo(
    () => items.filter((item) => !item.outputs?.zh).length,
    [items]
  );
  const triggerScan = async () => {
    await fetch("/api/v3/scan", { method: "POST" });
    pushToast(t("toast.scanTriggered"), "success");
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
        <h1 className="section-title">{t("library.title")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t("library.searchPlaceholder")}
            className="max-w-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button onClick={fetchMedia}>{t("common.search")}</Button>
          <select
            className="h-10 rounded-xl border border-border bg-white px-3 text-sm"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="updated_desc">{t("library.sort.updated")}</option>
            <option value="created_desc">{t("library.sort.created")}</option>
            <option value="failed_first">{t("library.sort.failed")}</option>
          </select>
          <select
            className="h-10 rounded-xl border border-border bg-white px-3 text-sm"
            value={String(pageSize)}
            onChange={(event) => setPageSize(Number(event.target.value))}
          >
            <option value="20">20/{t("library.pageSize")}</option>
            <option value="50">50/{t("library.pageSize")}</option>
            <option value="100">100/{t("library.pageSize")}</option>
          </select>
          <span className="text-sm text-neutral-500">
            {t("library.count")} {total} · {t("library.filtered")} {filteredCount} · {t("library.missing")}{" "}
            {missingZhCount}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-neutral-400">{t("library.filterTitle")}</span>
          {filters.map((filter) => (
            <Button
              key={filter.key}
              variant={selected.includes(filter.key) ? "default" : "outline"}
              onClick={() => toggleFilter(filter.key)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-neutral-400">{t("library.actionsTitle")}</span>
          <Button variant="outline" onClick={triggerScan}>
            {t("library.rescan")}
          </Button>
          <Link className={buttonVariants({ variant: "outline" })} href="/import">
            {t("library.import")}
          </Link>
          <Button variant="ghost" onClick={() => downloadFile("media.json", JSON.stringify(items, null, 2))}>
            {t("library.exportJson")}
          </Button>
          <Button variant="ghost" onClick={() => downloadFile("media.csv", csv)}>
            {t("library.exportCsv")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadFile("missing_zh.json", JSON.stringify(missingItems, null, 2))}
          >
            {t("library.exportMissingJson")}
          </Button>
          <Button variant="ghost" onClick={() => downloadFile("missing_zh.csv", csvMissing)}>
            {t("library.exportMissingCsv")}
          </Button>
        </div>
        {message ? <p className="text-sm text-rose-600">{message}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("library.table.title")}</TableHead>
              <TableHead>{t("library.table.status")}</TableHead>
              <TableHead>{t("library.table.subtitles")}</TableHead>
              <TableHead>{t("library.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length ? (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer transition hover:bg-neutral-50"
                  onClick={() => router.push(`/media/${item.id}`)}
                >
                  <TableCell className="max-w-md truncate">
                    <div className="font-medium text-neutral-900">{item.title}</div>
                    <div className="text-xs text-neutral-500 truncate" title={item.path}>
                      {item.path}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={statusBadge(item.status)}>
                      {t(`status.${item.status}`) || item.status}
                    </span>
                  </TableCell>
                  <TableCell className="space-x-2 text-xs">
                    <span className={item.outputs?.raw ? "text-emerald-700" : "text-slate-400"}>raw</span>
                    <span className={item.outputs?.zh ? "text-emerald-700" : "text-slate-400"}>zh</span>
                    <span className={item.outputs?.bi ? "text-emerald-700" : "text-slate-400"}>bi</span>
                  </TableCell>
                  <TableCell className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                    {item.status === "failed" ? (
                      <Button size="sm" onClick={() => handleAction(item.id, "retry")}>
                        {t("common.retry")}
                      </Button>
                    ) : null}
                    {!item.outputs?.zh ? (
                      <Button size="sm" variant="outline" onClick={() => handleAction(item.id, "translate")}>
                        {t("common.translate")}
                      </Button>
                    ) : null}
                    {item.archived ? (
                      <Button size="sm" variant="ghost" onClick={() => handleAction(item.id, "unarchive")}>
                        {t("common.unarchive")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => handleAction(item.id, "archive")}>
                        {t("common.archive")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4}>{t("library.empty")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {t("common.prev")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => (items.length === 0 ? p : p + 1))}
          >
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
