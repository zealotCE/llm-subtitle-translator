"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
    other?: { id: string; path: string; lang?: string }[];
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

function labelFromPath(pathValue: string) {
  const lower = pathValue.toLowerCase();
  if (lower.includes(".llm.zh") || lower.endsWith(".zh.srt") || lower.includes(".zh-hans")) return "简";
  if (lower.includes(".zh-hant") || lower.includes(".zh-tw") || lower.includes(".cht") || lower.includes(".tc")) {
    return "繁";
  }
  if (lower.includes(".ja.") || lower.includes(".jpn") || lower.includes(".jp")) return "日";
  if (lower.includes(".en.") || lower.includes(".eng")) return "英";
  return "其";
}

function subtitleBadges(item: MediaItem) {
  const badges: string[] = [];
  if (item.outputs?.raw) badges.push("raw");
  if (item.outputs?.zh) badges.push(labelFromPath(item.outputs.zh.path));
  if (item.outputs?.bi) badges.push("双");
  if (item.outputs?.other?.length) {
    const extras = item.outputs.other.map((output) => labelFromPath(output.path));
    badges.push(...extras);
  }
  return badges;
}

export default function LibraryPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("updated_desc");
  const [pageSize, setPageSize] = useState(50);
  const { pushToast } = useToast();
  const suspendOrderUntilRef = useRef(0);

  const filters = [
    { key: "missing_zh", label: t("library.filter.missingZh") },
    { key: "failed", label: t("library.filter.failed") },
    { key: "running", label: t("library.filter.running") },
    { key: "archived", label: t("library.filter.archived") },
  ];

  const fetchMedia = async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (selectedFilters.length) params.set("filter", selectedFilters.join(","));
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
    const incoming = (data.items || []) as MediaItem[];
    setItems((prev) => {
      const allowMerge = !query && selectedFilters.length === 0;
      if (allowMerge && Date.now() < suspendOrderUntilRef.current && prev.length) {
        const map = new Map(incoming.map((item: MediaItem) => [item.id, item]));
        const merged: MediaItem[] = prev.map((item) => map.get(item.id) || item);
        const seen = new Set(merged.map((item) => item.id));
        for (const item of incoming) {
          if (!seen.has(item.id)) {
            merged.push(item);
          }
        }
        return merged;
      }
      return incoming;
    });
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
  }, [query, selectedFilters]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      fetchMedia();
    }, 10000);
    return () => window.clearInterval(handle);
  }, [query, selectedFilters, page, sort, pageSize]);

  const toggleFilter = (key: string) => {
    setSelectedFilters((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
    setPage(1);
  };

  const toggleSort = (field: "title" | "status" | "updated") => {
    setSort((prev) => {
      const asc = `${field}_asc`;
      const desc = `${field}_desc`;
      if (prev === asc) return desc;
      if (prev === desc) return asc;
      return desc;
    });
  };

  const sortMark = (field: "title" | "status" | "updated") => {
    if (sort === `${field}_asc`) return "↑";
    if (sort === `${field}_desc`) return "↓";
    return "";
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((item) => item.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
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
    if (data.warning) {
      pushToast(data.warning, "info");
    }
    suspendOrderUntilRef.current = Date.now() + 15000;
    if (data.media) {
      setItems((prev) => prev.map((item) => (item.id === id ? data.media : item)));
    }
    pushToast(t("toast.actionTriggered"), "success");
  };

  const handleBulkAction = async (action: "archive" | "unarchive" | "retry" | "translate") => {
    if (!selectedIds.length) return;
    let done = 0;
    setMessage(`${t("library.bulkRunning")} 0/${selectedIds.length}`);
    for (const id of selectedIds) {
      await handleAction(id, action);
      done += 1;
      setMessage(`${t("library.bulkRunning")} ${done}/${selectedIds.length}`);
    }
    setMessage(`${t("library.bulkDone")} ${selectedIds.length}`);
    setSelectedIds([]);
  };

  const filteredCount = items.length;
  const missingZhCount = useMemo(
    () => items.filter((item) => !item.outputs?.zh).length,
    [items]
  );
  const triggerScan = async () => {
    const res = await fetch("/api/v3/scan", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      const msg = data.message || t("common.actionFailed");
      pushToast(msg, "error");
      return;
    }
    pushToast(t("toast.scanTriggered"), "success");
    fetchMedia();
  };

  const formatTime = (value: number) => {
    if (!value) return "-";
    return new Date(value * 1000).toLocaleString();
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
          <Select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="updated_desc">{t("library.sort.updated")}</option>
            <option value="created_desc">{t("library.sort.created")}</option>
            <option value="failed_first">{t("library.sort.failed")}</option>
          </Select>
          <Select value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value="20">20/{t("library.pageSize")}</option>
            <option value="50">50/{t("library.pageSize")}</option>
            <option value="100">100/{t("library.pageSize")}</option>
          </Select>
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
              variant={selectedFilters.includes(filter.key) ? "default" : "outline"}
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
        {selectedIds.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <span>{`${t("library.bulkSelected")} ${selectedIds.length}`}</span>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("retry")}>
              {t("library.bulkRetry")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("translate")}>
              {t("library.bulkTranslate")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("archive")}>
              {t("library.bulkArchive")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
              {t("library.bulkClear")}
            </Button>
          </div>
        ) : null}
        {message ? <p className="text-sm text-neutral-600">{message}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selectedIds.length === items.length}
                  onChange={toggleSelectAll}
                  onClick={(event) => event.stopPropagation()}
                />
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="inline-flex items-center gap-2"
                  onClick={() => toggleSort("title")}
                >
                  {t("library.table.title")}
                  <span className="text-xs text-neutral-400">{sortMark("title")}</span>
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="inline-flex items-center gap-2"
                  onClick={() => toggleSort("status")}
                >
                  {t("library.table.status")}
                  <span className="text-xs text-neutral-400">{sortMark("status")}</span>
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="inline-flex items-center gap-2"
                  onClick={() => toggleSort("updated")}
                >
                  {t("library.table.updated")}
                  <span className="text-xs text-neutral-400">{sortMark("updated")}</span>
                </button>
              </TableHead>
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
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                    />
                  </TableCell>
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
                  <TableCell className="text-xs text-neutral-500">{formatTime(item.updated_at)}</TableCell>
                  <TableCell className="text-xs">
                    <span
                      className="inline-block max-w-[160px] truncate text-neutral-700"
                      title={subtitleBadges(item).join(" / ")}
                    >
                      {subtitleBadges(item).join(" / ") || "-"}
                    </span>
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
                <TableCell colSpan={6}>{t("library.empty")}</TableCell>
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
