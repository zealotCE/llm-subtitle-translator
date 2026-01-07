"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

function isSensitive(key: string) {
  const upper = key.toUpperCase();
  return ["KEY", "SECRET", "TOKEN", "PASSWORD"].some((part) => upper.includes(part));
}

const GROUPS = [
  {
    title: "Watch & Scan",
    fields: [
      { key: "WATCH_DIRS", label: "Watch Dirs" },
      { key: "WATCH_RECURSIVE", label: "递归扫描" },
      { key: "SCAN_INTERVAL", label: "扫描间隔（秒）" },
      { key: "OUTPUT_TO_SOURCE_DIR", label: "输出到源目录" },
    ],
  },
  {
    title: "ASR",
    fields: [
      { key: "ASR_MODE", label: "ASR 模式" },
      { key: "ASR_MODEL", label: "ASR 模型" },
      { key: "LANGUAGE_HINTS", label: "语言提示" },
    ],
  },
  {
    title: "Translation",
    fields: [
      { key: "LLM_MODEL", label: "翻译模型" },
      { key: "LLM_BASE_URL", label: "Base URL" },
      { key: "BATCH_LINES", label: "Batch Lines" },
      { key: "MAX_CONCURRENT_TRANSLATIONS", label: "并发数" },
    ],
  },
  {
    title: "OSS",
    fields: [
      { key: "OSS_ENDPOINT", label: "Endpoint" },
      { key: "OSS_BUCKET", label: "Bucket" },
      { key: "OSS_URL_MODE", label: "URL Mode" },
    ],
  },
  {
    title: "Web/Auth",
    fields: [
      { key: "WEB_AUTH_ENABLED", label: "启用登录" },
      { key: "WEB_AUTH_USER", label: "登录用户" },
      { key: "WEB_AUTH_PASSWORD", label: "登录密码" },
    ],
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v3/settings")
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setValues(data.values || {});
      })
      .catch(() => {
        if (!active) return;
        setMessage("加载配置失败");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const entries = useMemo(() => Object.entries(values).sort(([a], [b]) => a.localeCompare(b)), [values]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const endpoint = advanced ? "/api/config" : "/api/v3/settings";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: values }),
      });
      if (!res.ok) {
        throw new Error("保存失败");
      }
      setMessage("已保存配置");
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">设置</h1>
        {GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {group.fields.map((field) => (
                <div key={field.key} className="grid gap-2">
                  <label className="text-sm text-dune">{field.label}</label>
                  <Input
                    value={values[field.key] || ""}
                    placeholder={isSensitive(field.key) ? "已隐藏，留空不修改" : ""}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Advanced</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" onClick={() => setAdvanced((prev) => !prev)}>
              {advanced ? "收起 .env 编辑器" : "展开 .env 编辑器"}
            </Button>
            {advanced ? (
              <div className="space-y-4">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const res = await fetch("/api/config");
                    const data = await res.json();
                    if (data.values) {
                      setValues(data.values);
                    }
                  }}
                >
                  加载完整 .env
                </Button>
                {loading ? (
                  <p className="text-sm text-dune">正在加载配置…</p>
                ) : (
                  entries.map(([key, value]) => (
                    <div key={key} className="grid gap-2">
                      <label className="text-sm text-dune">{key}</label>
                      <Input
                        value={value}
                        placeholder={isSensitive(key) ? "已隐藏，留空不修改" : ""}
                        onChange={(event) =>
                          setValues((prev) => ({
                            ...prev,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
        {message ? <p className="text-sm text-ember">{message}</p> : null}
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? "保存中…" : "保存配置"}
        </Button>
      </section>
    </main>
  );
}
