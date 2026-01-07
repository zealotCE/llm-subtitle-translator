"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { Button, buttonVariants } from "@/components/ui/button";

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
    { id: string; kind: string; path: string; lang?: string }[]
  >([]);
  const [preview, setPreview] = useState("");
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

  const fetchDetail = async () => {
    const res = await fetch(`/api/v3/media/${params.id}`);
    const data = await res.json();
    if (data.ok) {
      setMedia(data.media);
      setRuns(data.runs || []);
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
    const res = await fetch(`/api/v3/media/${params.id}/subtitles/${sid}`);
    const data = await res.json();
    if (data.ok) {
      setPreview(data.content || "");
    }
  };

  const triggerAction = async (action: "retry" | "translate" | "archive" | "unarchive") => {
    await fetch(`/api/v3/media/${params.id}/${action}`, { method: "POST" });
    fetchDetail();
  };

  useEffect(() => {
    fetchDetail();
    fetchSubtitles();
    fetchMetadata();
  }, [params.id]);

  if (!media) {
    return (
      <main className="min-h-screen px-6 py-10">
        <AuthGuard />
        <p className="text-sm text-dune">加载中…</p>
      </main>
    );
  }

  const outputItems = [
    media.outputs.raw ? { label: "raw", path: media.outputs.raw.path } : null,
    media.outputs.zh ? { label: "zh", path: media.outputs.zh.path } : null,
    media.outputs.bi ? { label: "bi", path: media.outputs.bi.path } : null,
    ...(media.outputs.other || []).map((item) => ({ label: "other", path: item.path })),
  ].filter(Boolean) as { label: string; path: string }[];

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="section-title">{media.title}</h1>
            <p className="text-sm text-dune">{media.path}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {media.status === "failed" ? (
              <Button onClick={() => triggerAction("retry")}>Retry</Button>
            ) : null}
            {!media.outputs.zh ? (
              <Button variant="outline" onClick={() => triggerAction("translate")}>
                Translate
              </Button>
            ) : null}
            {media.status === "archived" ? (
              <Button variant="ghost" onClick={() => triggerAction("unarchive")}>
                Unarchive
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => triggerAction("archive")}>
                Archive
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { key: "subtitles", label: "Subtitles" },
            { key: "runs", label: "Runs" },
            { key: "metadata", label: "Metadata" },
            { key: "files", label: "Files" },
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
            <h2 className="text-sm font-semibold text-ink">Subtitles</h2>
            <div className="mt-3 space-y-2 text-sm text-dune">
              {subtitleList.length ? (
                subtitleList.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <span>
                      {item.kind}
                      {item.lang ? ` (${item.lang})` : ""}
                    </span>
                    <div className="flex gap-2">
                      <a
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={`/api/v3/media/${media.id}/subtitles/${item.id}/download`}
                      >
                        下载
                      </a>
                      <Link
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={`/media/${media.id}/editor`}
                      >
                        编辑
                      </Link>
                      <Button size="sm" variant="ghost" onClick={() => fetchPreview(item.id)}>
                        预览
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p>暂无字幕输出</p>
              )}
            </div>
            <div className="mt-4 rounded-xl border border-border/60 bg-white/80 p-3 text-xs text-dune">
              {preview ? <pre className="whitespace-pre-wrap">{preview}</pre> : <p>点击“预览”查看字幕内容</p>}
            </div>
          </div>
        ) : null}

        {tab === "runs" ? (
          <div className="glass-panel rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-ink">Runs</h2>
            <div className="mt-3 space-y-2 text-sm text-dune">
              {runs.length ? (
                runs.map((run) => (
                  <div key={run.id} className="flex items-center justify-between gap-3">
                    <div>
                      <div>
                        {run.type} · {run.status}
                      </div>
                      <div className="text-xs text-dune">
                        {new Date(run.started_at * 1000).toLocaleString()}
                        {run.finished_at ? ` → ${new Date(run.finished_at * 1000).toLocaleString()}` : ""}
                      </div>
                      {run.error ? <div className="text-xs text-rose-600">Error: {run.error}</div> : null}
                    </div>
                    <div className="flex gap-2">
                      <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href={`/runs/${run.id}`}>
                        日志
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          fetch(`/api/v3/runs/${run.id}/retry`, { method: "POST" }).then(fetchDetail)
                        }
                      >
                        Retry
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p>暂无运行记录</p>
              )}
            </div>
          </div>
        ) : null}

        {tab === "metadata" ? (
          <div className="glass-panel rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-ink">Metadata</h2>
            <p className="mt-2 text-sm text-dune">通过表单补全作品信息。</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm text-dune">原始标题</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.title_original}
                  onChange={(e) => setMeta((prev) => ({ ...prev, title_original: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">简体标题</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.title_zh}
                  onChange={(e) => setMeta((prev) => ({ ...prev, title_zh: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">英文标题</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.title_en}
                  onChange={(e) => setMeta((prev) => ({ ...prev, title_en: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">语言提示</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.language_hints}
                  onChange={(e) => setMeta((prev) => ({ ...prev, language_hints: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">类型</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.type}
                  onChange={(e) => setMeta((prev) => ({ ...prev, type: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">年份</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.year}
                  onChange={(e) => setMeta((prev) => ({ ...prev, year: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">季</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.season}
                  onChange={(e) => setMeta((prev) => ({ ...prev, season: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">集</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.episode}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">本集标题（日）</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.episode_title_ja}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode_title_ja: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">本集标题（简中）</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.episode_title_zh}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode_title_zh: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">本集标题（英文）</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.episode_title_en}
                  onChange={(e) => setMeta((prev) => ({ ...prev, episode_title_en: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">TMDb ID</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.external_tmdb}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_tmdb: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">Bangumi ID</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.external_bangumi}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_bangumi: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">WMDB ID</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.external_wmdb}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_wmdb: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-dune">IMDb ID</label>
                <input
                  className="h-10 rounded-xl border border-border bg-white/90 px-3 text-sm"
                  value={meta.external_imdb}
                  onChange={(e) => setMeta((prev) => ({ ...prev, external_imdb: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <label className="text-sm text-dune">术语表（JSON）</label>
              <textarea
                className="min-h-[120px] rounded-xl border border-border bg-white/90 p-3 text-sm"
                value={meta.glossary}
                onChange={(e) => setMeta((prev) => ({ ...prev, glossary: e.target.value }))}
              />
            </div>
            <div className="mt-4 grid gap-2">
              <label className="text-sm text-dune">角色列表（JSON）</label>
              <textarea
                className="min-h-[120px] rounded-xl border border-border bg-white/90 p-3 text-sm"
                value={meta.characters}
                onChange={(e) => setMeta((prev) => ({ ...prev, characters: e.target.value }))}
              />
            </div>
            <div className="mt-4 grid gap-2">
              <label className="text-sm text-dune">备注</label>
              <textarea
                className="min-h-[80px] rounded-xl border border-border bg-white/90 p-3 text-sm"
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
                      setMetaMessage("术语表 JSON 格式错误");
                      return;
                    }
                  }
                  let characters = undefined;
                  if (meta.characters.trim()) {
                    try {
                      characters = JSON.parse(meta.characters);
                    } catch {
                      setMetaMessage("角色列表 JSON 格式错误");
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
                    setMetaMessage(data.message || "保存失败");
                    return;
                  }
                  setMetaMessage("已保存");
                }}
              >
                保存元数据
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setMetaAdvanced((prev) => !prev);
                }}
              >
                {metaAdvanced ? "收起高级 JSON" : "展开高级 JSON"}
              </Button>
            </div>
            {metaMessage ? <p className="mt-2 text-sm text-ember">{metaMessage}</p> : null}
            {metaAdvanced ? (
              <div className="mt-4">
                <textarea
                  className="min-h-[200px] w-full rounded-xl border border-border bg-white/90 p-3 text-sm"
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
                      setMetaMessage("JSON 格式错误");
                      return;
                    }
                    const res = await fetch(`/api/v3/media/${params.id}/metadata`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ data: parsed }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                      setMetaMessage(data.message || "保存失败");
                      return;
                    }
                    setMetaMessage("已保存");
                  }}
                >
                  保存高级 JSON
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "files" ? (
          <div className="glass-panel rounded-2xl p-4 text-sm text-dune">
            <h2 className="text-sm font-semibold text-ink">Files</h2>
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
