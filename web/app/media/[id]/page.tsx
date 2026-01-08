"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

export const dynamic = "force-dynamic";

type MediaItem = {
  id: string;
  title: string;
  path: string;
  status: string;
  outputs: {
    raw?: { path: string };
    zh?: { path: string };
    bi?: { path: string };
    other: { path: string }[];
  };
};

type SubtitleHints = {
  external_count: number;
  embedded_count: number;
  has_subtitle: boolean;
};

type RunItem = {
  id: string;
  type: string;
  status: string;
  started_at: number;
  finished_at?: number;
  error?: string;
};

type MetadataForm = {
  title_original: string;
  title_zh: string;
  title_en: string;
  episode_title_ja: string;
  episode_title_zh: string;
  episode_title_en: string;
  season: string;
  episode: string;
  type: string;
  year: string;
  language_hints: string;
  glossary: string;
  characters: string;
  external_tmdb: string;
  external_bangumi: string;
  external_wmdb: string;
  external_imdb: string;
  notes: string;
};

export default function MediaDetailPage({ params }: { params: { id: string } }) {
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [tab, setTab] = useState<"subtitles" | "runs" | "metadata" | "files">("subtitles");
  const [subtitleList, setSubtitleList] = useState<
    { id: string; kind: string; path: string; lang?: string; updated_at?: number; size?: number }[]
  >([]);
  const [preview, setPreview] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [subtitleHints, setSubtitleHints] = useState<SubtitleHints | null>(null);
  const [showForceDialog, setShowForceDialog] = useState(false);
  const [forceIgnoreSimplified, setForceIgnoreSimplified] = useState(true);
  const [forceTranslate, setForceTranslate] = useState(false);
  const [forceAsr, setForceAsr] = useState(false);
  const [forceUseExisting, setForceUseExisting] = useState(true);
  const [meta, setMeta] = useState<MetadataForm>({
    title_original: "",
    title_zh: "",
    title_en: "",
    episode_title_ja: "",
    episode_title_zh: "",
    episode_title_en: "",
    season: "",
    episode: "",
    type: "",
    year: "",
    language_hints: "",
    glossary: "",
    characters: "",
    external_tmdb: "",
    external_bangumi: "",
    external_wmdb: "",
    external_imdb: "",
    notes: "",
  });
  const [metaAdvanced, setMetaAdvanced] = useState(false);
  const [metaJson, setMetaJson] = useState("{}");
  const [metaMessage, setMetaMessage] = useState("");
  const { t } = useI18n();
  const { pushToast } = useToast();

  const fetchDetail = async () => {
    const res = await fetch(`/api/v3/media/${params.id}`);
    const data = await res.json();
    if (data.ok) {
      setMedia(data.media);
      setRuns(data.runs || []);
      setSubtitleHints(data.subtitle_hints || null);
    }
  };

  const fetchSubtitles = async () => {
    const res = await fetch(`/api/v3/media/${params.id}/subtitles`);
    const data = await res.json();
    if (data.ok) {
      setSubtitleList(data.outputs || []);
    }
  };
  const fetchMetadata = async () => {
    const res = await fetch(`/api/v3/media/${params.id}/metadata`);
    const data = await res.json();
    if (!data.ok) return;
    const value = data.data || {};
    setMeta({
      title_original: value.title_original || "",
      title_zh: value.title_localized?.["zh-CN"] || value.title_localized?.zh || "",
      title_en: value.title_localized?.["en"] || value.title_localized?.["en-US"] || "",
      episode_title_ja: value.episode_title?.["ja"] || value.episode_title?.["ja-JP"] || "",
      episode_title_zh: value.episode_title?.["zh-CN"] || value.episode_title?.zh || "",
      episode_title_en: value.episode_title?.["en"] || value.episode_title?.["en-US"] || "",
      season: value.season != null ? String(value.season) : "",
      episode: value.episode != null ? String(value.episode) : "",
      type: value.type || "",
      year: value.year != null ? String(value.year) : "",
      language_hints: value.language_hints || "",
      glossary: value.glossary ? JSON.stringify(value.glossary, null, 2) : "",
      characters: value.characters ? JSON.stringify(value.characters, null, 2) : "",
      external_tmdb: value.external_ids?.tmdb ? String(value.external_ids.tmdb) : "",
      external_bangumi: value.external_ids?.bangumi ? String(value.external_ids.bangumi) : "",
      external_wmdb: value.external_ids?.wmdb ? String(value.external_ids.wmdb) : "",
      external_imdb: value.external_ids?.imdb ? String(value.external_ids.imdb) : "",
      notes: value.notes || "",
    });
    setMetaJson(JSON.stringify(value, null, 2));
  };
  const fetchPreview = async (sid: string) => {
    if (previewId === sid) {
      setPreviewId(null);
      setPreview("");
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const res = await fetch(`/api/v3/media/${params.id}/subtitles/${sid}`);
    const data = await res.json();
    if (data.ok) {
      setPreview(data.content || "");
      setPreviewId(sid);
    } else {
      pushToast(data.message || t("common.loadFailed"), "error");
    }
    setPreviewLoading(false);
  };

  const triggerAction = async (action: "retry" | "translate" | "archive" | "unarchive") => {
    const res = await fetch(`/api/v3/media/${params.id}/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      pushToast(data.message || t("common.actionFailed"), "error");
      return;
    }
    if (data.warning) {
      pushToast(data.warning, "info");
    }
    pushToast(t("toast.actionTriggered"), "success");
    fetchDetail();
  };

  const triggerForceRun = async () => {
    const res = await fetch(`/api/v3/media/${params.id}/force`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ignore_simplified_subtitle: forceIgnoreSimplified,
        force_translate: forceTranslate,
        force_asr: forceAsr,
        use_existing_subtitle: forceAsr ? false : forceUseExisting,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      pushToast(data.message || t("common.actionFailed"), "error");
      return;
    }
    if (data.warning) {
      pushToast(data.warning, "info");
    }
    pushToast(t("toast.actionTriggered"), "success");
    setShowForceDialog(false);
    fetchDetail();
  };

  useEffect(() => {
    fetchDetail();
    fetchSubtitles();
    fetchMetadata();
  }, [params.id]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      fetchDetail();
      fetchSubtitles();
    }, 10000);
    return () => window.clearInterval(handle);
  }, [params.id]);

  if (!media) {
    return (
      <main className="min-h-screen px-6 py-10">
        <AuthGuard />
        <p className="text-sm text-neutral-500">{t("common.loading")}</p>
      </main>
    );
  }

  const fileName = (value: string) => value.split("/").pop() || value;
  const kindLabel = (kind: string) => {
    if (kind === "raw") return t("media.subtitle.kind.raw");
    if (kind === "zh") return t("media.subtitle.kind.zh");
    if (kind === "bi") return t("media.subtitle.kind.bi");
    return t("media.subtitle.kind.other");
  };
  const formatSize = (size?: number) => {
    if (!size && size !== 0) return "-";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const outputItems = [
    media.outputs.raw ? { label: "raw", path: media.outputs.raw.path } : null,
    media.outputs.zh ? { label: "zh", path: media.outputs.zh.path } : null,
    media.outputs.bi ? { label: "bi", path: media.outputs.bi.path } : null,
    ...(media.outputs.other || []).map((item) => ({ label: "other", path: item.path })),
  ]
    .filter((item): item is { label: string; path: string } => Boolean(item))
    .map((item) => ({ label: kindLabel(item.label), path: item.path }));

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-5xl space-y-6">
        {showForceDialog ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm shadow-xl">
              <div className="text-base font-semibold text-neutral-900">{t("media.force.title")}</div>
              <p className="mt-2 text-sm text-neutral-500">{t("media.force.desc")}</p>
              {subtitleList.length ? (
                <p className="mt-2 text-xs text-neutral-500">{t("media.force.subtitleHint")}</p>
              ) : null}
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={forceIgnoreSimplified}
                    onChange={(e) => setForceIgnoreSimplified(e.target.checked)}
                  />
                  {t("media.force.ignoreSimplified")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={forceTranslate}
                    onChange={(e) => setForceTranslate(e.target.checked)}
                  />
                  {t("media.force.forceTranslate")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={forceUseExisting}
                    disabled={forceAsr}
                    onChange={(e) => setForceUseExisting(e.target.checked)}
                  />
                  {t("media.force.useExisting")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={forceAsr}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setForceAsr(next);
                      if (next) {
                        setForceUseExisting(false);
                      }
                    }}
                  />
                  {t("media.force.forceAsr")}
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowForceDialog(false)}>
                  {t("common.close")}
                </Button>
                <Button onClick={triggerForceRun}>{t("common.confirm")}</Button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="section-title">{media.title}</h1>
            <p className="text-sm text-neutral-500" title={media.path}>
              {media.path}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {media.status === "failed" ? (
              <Button onClick={() => triggerAction("retry")}>{t("common.retry")}</Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                if (subtitleHints?.has_subtitle) {
                  setForceIgnoreSimplified(true);
                  setForceTranslate(false);
                  setForceAsr(false);
                  setForceUseExisting(true);
                  setShowForceDialog(true);
                } else {
                  triggerForceRun();
                }
              }}
            >
              {t("common.forceRun")}
            </Button>
            {!media.outputs.zh ? (
              <Button variant="outline" onClick={() => triggerAction("translate")}>
                {t("common.translate")}
              </Button>
            ) : null}
            {media.status === "archived" ? (
              <Button variant="ghost" onClick={() => triggerAction("unarchive")}>
                {t("common.unarchive")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => triggerAction("archive")}>
                {t("common.archive")}
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-neutral-500">{t("media.force.help")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { key: "subtitles", label: t("media.subtitles") },
            { key: "runs", label: t("media.runs") },
            { key: "metadata", label: t("media.metadata") },
            { key: "files", label: t("media.files") },
          ].map((item) => (
            <Button
              key={item.key}
              variant={tab === item.key ? "default" : "outline"}
              onClick={() => setTab(item.key as typeof tab)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {tab === "subtitles" ? (
          <div className="glass-panel rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-neutral-900">{t("media.subtitles")}</h2>
            <div className="mt-3 space-y-2 text-sm text-neutral-600">
              {subtitleList.length ? (
                subtitleList.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-neutral-900" title={item.path}>
                          {fileName(item.path)}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {kindLabel(item.kind)}
                          {item.lang ? ` · ${item.lang}` : ""}
                          {item.updated_at ? ` · ${new Date(item.updated_at * 1000).toLocaleString()}` : ""}
                          {item.size ? ` · ${formatSize(item.size)}` : ""}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <a
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={`/api/v3/media/${media.id}/subtitles/${item.id}/download`}
                        >
                          {t("common.download")}
                        </a>
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={`/media/${media.id}/editor`}
                        >
                          {t("common.edit")}
                        </Link>
                        <Button size="sm" variant="ghost" onClick={() => fetchPreview(item.id)}>
                          {previewId === item.id ? t("common.close") : t("common.preview")}
                        </Button>
                      </div>
                    </div>
                    {previewId === item.id ? (
                      <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                        {previewLoading ? (
                          <p>{t("common.loading")}</p>
                        ) : (
                          <pre className="whitespace-pre-wrap">{preview}</pre>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <p>{t("media.subtitles.empty")}</p>
              )}
            </div>
          </div>
        ) : null}

        {tab === "runs" ? (
          <div className="glass-panel rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-neutral-900">{t("media.runs")}</h2>
            <div className="mt-3 space-y-2 text-sm text-neutral-600">
              {runs.length ? (
                runs.map((run) => (
                  <div key={run.id} className="rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-neutral-900">
                          {run.type} · {t(`status.${run.status}`) || run.status}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {new Date(run.started_at * 1000).toLocaleString()}
                          {run.finished_at ? ` → ${new Date(run.finished_at * 1000).toLocaleString()}` : ""}
                        </div>
                        {run.error ? <div className="text-xs text-rose-600">Error: {run.error}</div> : null}
                      </div>
                      <div className="flex gap-2">
                        <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/runs/${run.id}`}>
                          {t("run.log")}
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const res = await fetch(`/api/v3/runs/${run.id}/retry`, { method: "POST" });
                            const data = await res.json();
                            if (!res.ok || !data.ok) {
                              pushToast(data.message || t("common.actionFailed"), "error");
                              return;
                            }
                            if (data.warning) {
                              pushToast(data.warning, "info");
                            }
                            pushToast(t("toast.actionTriggered"), "success");
                            fetchDetail();
                          }}
                        >
                          {t("common.retry")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p>{t("media.runs.empty")}</p>
              )}
            </div>
          </div>
        ) : null}

        {tab === "metadata" ? (
          <div className="glass-panel rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-neutral-900">{t("media.metadata")}</h2>
            <p className="mt-2 text-sm text-neutral-500">{t("media.metadata.desc")}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.titleOriginal")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.title_original}
                  onChange={(e) => setMeta((prev) => ({ ...prev, title_original: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.titleZh")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.title_zh}
                  onChange={(e) => setMeta((prev) => ({ ...prev, title_zh: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.titleEn")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.title_en}
                  onChange={(e) => setMeta((prev) => ({ ...prev, title_en: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.languageHints")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.language_hints}
                  onChange={(e) => setMeta((prev) => ({ ...prev, language_hints: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.type")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.type}
                  onChange={(e) => setMeta((prev) => ({ ...prev, type: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.year")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.year}
                  onChange={(e) => setMeta((prev) => ({ ...prev, year: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.season")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.season}
                  onChange={(e) => setMeta((prev) => ({ ...prev, season: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.episode")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.episode}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.episodeTitleJa")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.episode_title_ja}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode_title_ja: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.episodeTitleZh")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.episode_title_zh}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode_title_zh: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.episodeTitleEn")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.episode_title_en}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode_title_en: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.tmdbId")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.external_tmdb}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_tmdb: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.bangumiId")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.external_bangumi}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_bangumi: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.wmdbId")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.external_wmdb}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_wmdb: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">{t("media.meta.imdbId")}</label>
                <input
                  className="h-10 rounded-full border border-border bg-white px-4 text-sm"
                  value={meta.external_imdb}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_imdb: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <label className="text-sm text-neutral-500">{t("media.meta.glossary")}</label>
              <textarea
                className="min-h-[120px] rounded-xl border border-border bg-white p-3 text-sm"
                value={meta.glossary}
                onChange={(e) => setMeta((prev) => ({ ...prev, glossary: e.target.value }))}
              />
            </div>
            <div className="mt-4 grid gap-2">
              <label className="text-sm text-neutral-500">{t("media.meta.characters")}</label>
              <textarea
                className="min-h-[120px] rounded-xl border border-border bg-white p-3 text-sm"
                value={meta.characters}
                onChange={(e) => setMeta((prev) => ({ ...prev, characters: e.target.value }))}
              />
            </div>
            <div className="mt-4 grid gap-2">
              <label className="text-sm text-neutral-500">{t("media.meta.notes")}</label>
              <textarea
                className="min-h-[80px] rounded-xl border border-border bg-white p-3 text-sm"
                value={meta.notes}
                onChange={(e) => setMeta((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                onClick={async () => {
                  setMetaMessage("");
                  let glossary = undefined;
                  if (meta.glossary.trim()) {
                    try {
                      glossary = JSON.parse(meta.glossary);
                    } catch {
                      setMetaMessage(t("media.metadata.glossaryError"));
                      return;
                    }
                  }
                  let characters = undefined;
                  if (meta.characters.trim()) {
                    try {
                      characters = JSON.parse(meta.characters);
                    } catch {
                      setMetaMessage(t("media.metadata.charactersError"));
                      return;
                    }
                  }
                  const payload = {
                    title_original: meta.title_original || undefined,
                    title_localized: {
                      ...(meta.title_zh ? { "zh-CN": meta.title_zh } : {}),
                      ...(meta.title_en ? { en: meta.title_en } : {}),
                    },
                    episode_title: {
                      ...(meta.episode_title_ja ? { ja: meta.episode_title_ja } : {}),
                      ...(meta.episode_title_zh ? { "zh-CN": meta.episode_title_zh } : {}),
                      ...(meta.episode_title_en ? { en: meta.episode_title_en } : {}),
                    },
                    season: meta.season ? Number(meta.season) : undefined,
                    episode: meta.episode ? Number(meta.episode) : undefined,
                    type: meta.type || undefined,
                    year: meta.year ? Number(meta.year) : undefined,
                    language_hints: meta.language_hints || undefined,
                    glossary,
                    characters,
                    external_ids: {
                      ...(meta.external_tmdb ? { tmdb: meta.external_tmdb } : {}),
                      ...(meta.external_bangumi ? { bangumi: meta.external_bangumi } : {}),
                      ...(meta.external_wmdb ? { wmdb: meta.external_wmdb } : {}),
                      ...(meta.external_imdb ? { imdb: meta.external_imdb } : {}),
                    },
                    notes: meta.notes || undefined,
                  };
                  const res = await fetch(`/api/v3/media/${params.id}/metadata`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ data: payload }),
                  });
                  const data = await res.json();
                  if (!res.ok || !data.ok) {
                    setMetaMessage(data.message || t("common.saveFailed"));
                    return;
                  }
                  setMetaMessage(t("media.metadata.saved"));
                }}
              >
                {t("media.metadata.save")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setMetaAdvanced((prev) => !prev);
                }}
              >
                {metaAdvanced ? t("media.metadata.advancedClose") : t("media.metadata.advancedOpen")}
              </Button>
            </div>
            {metaMessage ? <p className="mt-2 text-sm text-rose-600">{metaMessage}</p> : null}
            {metaAdvanced ? (
              <div className="mt-4">
                <textarea
                  className="min-h-[200px] w-full rounded-xl border border-border bg-white p-3 text-sm"
                  value={metaJson}
                  onChange={(e) => setMetaJson(e.target.value)}
                />
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={async () => {
                    setMetaMessage("");
                    let parsed = {};
                    try {
                      parsed = JSON.parse(metaJson);
                    } catch {
                      setMetaMessage(t("media.metadata.jsonError"));
                      return;
                    }
                    const res = await fetch(`/api/v3/media/${params.id}/metadata`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ data: parsed }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                      setMetaMessage(data.message || t("common.saveFailed"));
                      return;
                    }
                    setMetaMessage(t("media.metadata.saved"));
                  }}
                >
                  {t("media.metadata.saveAdvanced")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "files" ? (
          <div className="glass-panel rounded-2xl p-4 text-sm text-neutral-600">
            <h2 className="text-sm font-semibold text-neutral-900">{t("media.files")}</h2>
            <div className="mt-2 space-y-1">
              <div>video: {media.path}</div>
              {outputItems.map((item) => (
                <div key={item.path}>
                  {item.label}: {item.path}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
