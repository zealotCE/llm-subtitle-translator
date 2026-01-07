"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

export default function MetadataPage() {
  const [path, setPath] = useState("");
  const [rawJson, setRawJson] = useState("{}");
  const [message, setMessage] = useState("");

  const loadMeta = async (videoPath: string) => {
    setMessage("");
    const res = await fetch(`/api/metadata?path=${encodeURIComponent(videoPath)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "加载失败");
      return;
    }
    setRawJson(JSON.stringify(data.data || {}, null, 2));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("path") || "";
    if (initial) {
      setPath(initial);
      loadMeta(initial);
    }
  }, []);

  const handleSave = async () => {
    setMessage("");
    let data = {};
    try {
      data = JSON.parse(rawJson || "{}");
    } catch {
      setMessage("JSON 格式错误");
      return;
    }
    const res = await fetch("/api/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, data }),
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) {
      setMessage(payload.message || "保存失败");
      return;
    }
    setMessage("已保存");
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">元数据补全</h1>
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <div className="grid gap-2">
            <label className="text-sm text-dune">媒体路径</label>
            <div className="flex gap-3">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/media/onepiece.mkv" />
              <Button variant="outline" onClick={() => loadMeta(path)}>
                加载
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-dune">元数据 JSON</label>
            <Textarea className="min-h-[320px]" value={rawJson} onChange={(e) => setRawJson(e.target.value)} />
          </div>
          {message ? <p className="text-sm text-ember">{message}</p> : null}
          <Button onClick={handleSave}>保存元数据</Button>
        </div>
      </section>
    </main>
  );
}
