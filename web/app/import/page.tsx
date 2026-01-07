"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const [asrMode, setAsrMode] = useState("offline");
  const [segmentMode, setSegmentMode] = useState("post");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const handleUpload = async () => {
    if (!file) {
      setMessage(t("import.fileRequired"));
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
        throw new Error(data?.message || t("import.failed"));
      }
      setMessage(`${t("import.done")}: ${data.path}`);
    } catch (err) {
      setMessage((err as Error).message || t("import.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-3xl space-y-6">
        <h1 className="section-title">{t("import.title")}</h1>
        <Card>
          <CardHeader>
            <CardTitle>{t("import.subtitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm text-neutral-500">{t("import.asrMode")}</label>
              <Select value={asrMode} onChange={(event) => setAsrMode(event.target.value)}>
                <option value="offline">offline</option>
                <option value="realtime">realtime</option>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-neutral-500">{t("import.segmentMode")}</label>
              <Select value={segmentMode} onChange={(event) => setSegmentMode(event.target.value)}>
                <option value="post">post</option>
                <option value="auto">auto</option>
              </Select>
            </div>
            <div className="grid gap-2 md:col-span-2">
              <label className="text-sm text-neutral-500">{t("import.fileLabel")}</label>
              <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            {message ? <p className="text-sm text-rose-600 md:col-span-2">{message}</p> : null}
            <Button onClick={handleUpload} disabled={loading} className="md:col-span-2">
              {loading ? t("import.loading") : t("import.submit")}
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
