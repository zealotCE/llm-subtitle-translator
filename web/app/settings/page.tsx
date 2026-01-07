"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function isSensitive(key: string) {
  const upper = key.toUpperCase();
  return ["KEY", "SECRET", "TOKEN", "PASSWORD"].some((part) => upper.includes(part));
}

const GROUPS = [
  {
    titleKey: "settings.group.watch",
    fields: [
      { key: "WATCH_DIRS", labelKey: "settings.label.watchDirs", wide: true },
      { key: "WATCH_RECURSIVE", labelKey: "settings.label.watchRecursive" },
      { key: "SCAN_INTERVAL", labelKey: "settings.label.scanInterval" },
      { key: "OUTPUT_TO_SOURCE_DIR", labelKey: "settings.label.outputToSource" },
    ],
  },
  {
    titleKey: "settings.group.asr",
    fields: [
      { key: "ASR_MODE", labelKey: "settings.label.asrMode" },
      { key: "ASR_MODEL", labelKey: "settings.label.asrModel" },
      { key: "LANGUAGE_HINTS", labelKey: "settings.label.languageHints", wide: true },
    ],
  },
  {
    titleKey: "settings.group.translation",
    fields: [
      { key: "LLM_MODEL", labelKey: "settings.label.llmModel", wide: true },
      { key: "LLM_BASE_URL", labelKey: "settings.label.llmBaseUrl", wide: true },
      { key: "BATCH_LINES", labelKey: "settings.label.batchLines" },
      { key: "MAX_CONCURRENT_TRANSLATIONS", labelKey: "settings.label.concurrency" },
    ],
  },
  {
    titleKey: "settings.group.oss",
    fields: [
      { key: "OSS_ENDPOINT", labelKey: "settings.label.ossEndpoint" },
      { key: "OSS_BUCKET", labelKey: "settings.label.ossBucket" },
      { key: "OSS_URL_MODE", labelKey: "settings.label.ossUrlMode" },
    ],
  },
  {
    titleKey: "settings.group.web",
    fields: [
      { key: "WEB_AUTH_ENABLED", labelKey: "settings.label.webAuthEnabled" },
      { key: "WEB_AUTH_USER", labelKey: "settings.label.webAuthUser" },
      { key: "WEB_AUTH_PASSWORD", labelKey: "settings.label.webAuthPassword" },
    ],
  },
];

export default function SettingsPage() {
  const { t } = useI18n();
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
        setMessage(t("settings.loadFailed"));
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
        throw new Error(t("settings.saveFailed"));
      }
      setMessage(t("settings.saved"));
    } catch {
      setMessage(t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">{t("settings.title")}</h1>
        {GROUPS.map((group) => (
          <Card key={group.titleKey}>
            <CardHeader>
              <CardTitle>{t(group.titleKey)}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field.key} className={`grid gap-2 ${field.wide ? "md:col-span-2" : ""}`}>
                  <label className="text-sm text-neutral-500">{t(field.labelKey)}</label>
                  <Input
                    value={values[field.key] || ""}
                    placeholder={isSensitive(field.key) ? t("settings.hidden") : ""}
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
            <CardTitle>{t("settings.advanced")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" onClick={() => setAdvanced((prev) => !prev)}>
              {advanced ? t("settings.advancedClose") : t("settings.advancedOpen")}
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
                  {t("settings.loadEnv")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(values, null, 2)], {
                      type: "application/json;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = "settings.json";
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {t("settings.exportJson")}
                </Button>
                {loading ? (
                  <p className="text-sm text-neutral-500">{t("settings.loading")}</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {entries.map(([key, value]) => (
                      <div key={key} className="grid gap-2">
                        <label className="text-sm text-neutral-500">{key}</label>
                        <Input
                          value={value}
                          placeholder={isSensitive(key) ? t("settings.hidden") : ""}
                          onChange={(event) =>
                            setValues((prev) => ({
                              ...prev,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
        {message ? <p className="text-sm text-rose-600">{message}</p> : null}
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? t("settings.saving") : t("settings.save")}
        </Button>
      </section>
    </main>
  );
}
