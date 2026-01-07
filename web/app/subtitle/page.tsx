"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default function SubtitlePage() {
  const [video, setVideo] = useState("");
  const [path, setPath] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSubtitle = async (videoPath?: string, subtitlePath?: string) => {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    if (videoPath) params.set("video", videoPath);
    if (subtitlePath) params.set("path", subtitlePath);
    const res = await fetch(`/api/subtitle?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "加载失败");
      setLoading(false);
      return;
    }
    setVideo(videoPath || data.video || "");
    setPath(data.path || "");
    setCandidates(data.candidates || []);
    setContent(data.content || "");
    setLoading(false);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialVideo = params.get("video") || "";
    if (initialVideo) {
      loadSubtitle(initialVideo);
    }
  }, []);

  const handleSave = async (mode: "save" | "save_as") => {
    setMessage("");
    const res = await fetch("/api/subtitle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: mode, video, path, content }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "保存失败");
      return;
    }
    if (mode === "save_as") {
      setPath(data.path || path);
    }
    setMessage("已保存");
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">字幕编辑</h1>
        <div className="glass-panel rounded-2xl p-4 space-y-4">
          <div className="grid gap-2">
            <label className="text-sm text-dune">媒体路径</label>
            <div className="flex gap-3">
              <Input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="/media/onepiece.mkv" />
              <Button variant="outline" onClick={() => loadSubtitle(video)}>
                加载
              </Button>
            </div>
          </div>
          {candidates.length ? (
            <div className="grid gap-2">
              <label className="text-sm text-dune">字幕文件</label>
              <Select value={path} onChange={(e) => loadSubtitle(video, e.target.value)}>
                {candidates.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <p className="text-sm text-dune">{path ? `当前字幕：${path}` : "暂无字幕文件"}</p>
          <Textarea
            className="min-h-[420px]"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={loading ? "加载中…" : "请输入字幕内容"}
          />
          {message ? <p className="text-sm text-ember">{message}</p> : null}
          <div className="flex gap-3">
            <Button onClick={() => handleSave("save")} disabled={!path}>
              保存
            </Button>
            <Button variant="outline" onClick={() => handleSave("save_as")} disabled={!content}>
              另存版本
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
