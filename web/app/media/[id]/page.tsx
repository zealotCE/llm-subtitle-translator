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

export default function MediaDetailPage({ params }: { params: { id: string } }) {
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [tab, setTab] = useState<"subtitles" | "runs" | "metadata" | "files">("subtitles");
  const [subtitleList, setSubtitleList] = useState<
    { id: string; kind: string; path: string; lang?: string }[]
  >([]);
  const [preview, setPreview] = useState("");

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
                    <span>
                      {run.type} · {run.status}
                    </span>
                    <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href={`/runs/${run.id}`}>
                      查看
                    </Link>
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
            <Link
              className={`${buttonVariants({ size: "sm", variant: "outline" })} mt-4 inline-flex`}
              href={`/metadata?path=${encodeURIComponent(media.path)}`}
            >
              打开元数据编辑
            </Link>
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
