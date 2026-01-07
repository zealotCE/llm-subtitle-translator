"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const [asrMode, setAsrMode] = useState("offline");
  const [segmentMode, setSegmentMode] = useState("post");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      setMessage("请选择文件");
      return;
    }
    setLoading(true);
    setMessage("");
    const form = new FormData();
    form.append("file", file);
    form.append("asr_mode", asrMode);
    form.append("segment_mode", segmentMode);
    try {
      const res = await fetch("/api/v3/media/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "导入失败");
      }
      setMessage(`已导入：${data.path}`);
    } catch (err) {
      setMessage((err as Error).message || "导入失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-3xl space-y-6">
        <h1 className="section-title">Import Media</h1>
        <Card>
          <CardHeader>
            <CardTitle>导入媒体</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm text-dune">ASR 模式</label>
              <Select value={asrMode} onChange={(event) => setAsrMode(event.target.value)}>
                <option value="offline">offline</option>
                <option value="realtime">realtime</option>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-dune">切片模式</label>
              <Select value={segmentMode} onChange={(event) => setSegmentMode(event.target.value)}>
                <option value="post">post</option>
                <option value="auto">auto</option>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-dune">媒体文件</label>
              <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            {message ? <p className="text-sm text-ember">{message}</p> : null}
            <Button onClick={handleUpload} disabled={loading}>
              {loading ? "导入中…" : "导入媒体"}
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
