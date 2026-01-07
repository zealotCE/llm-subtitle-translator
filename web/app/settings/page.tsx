"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

export const dynamic = "force-dynamic";

function isSensitive(key: string) {
  const upper = key.toUpperCase();
  return ["KEY", "SECRET", "TOKEN", "PASSWORD"].some((part) => upper.includes(part));
}

type Field = {
  key: string;
  labelKey: string;
  type: "text" | "number" | "switch" | "select";
  wide?: boolean;
  options?: string[];
  allowCustom?: boolean;
};

type Group = {
  titleKey: string;
  fields: Field[];
};

const GROUPS: Group[] = [
  {
    titleKey: "settings.group.watch",
    fields: [
      { key: "WATCH_DIRS", labelKey: "settings.label.watchDirs", wide: true, type: "text" },
      { key: "WATCH_RECURSIVE", labelKey: "settings.label.watchRecursive", type: "switch" },
      { key: "SCAN_INTERVAL", labelKey: "settings.label.scanInterval", type: "number" },
      { key: "OUTPUT_TO_SOURCE_DIR", labelKey: "settings.label.outputToSource", type: "switch" },
      { key: "DELETE_SOURCE_AFTER_DONE", labelKey: "settings.label.deleteSourceAfterDone", type: "switch" },
    ],
  },
  {
    titleKey: "settings.group.asr",
    fields: [
      {
        key: "ASR_MODE",
        labelKey: "settings.label.asrMode",
        type: "select",
        options: ["offline", "realtime"],
      },
      {
        key: "ASR_MODEL",
        labelKey: "settings.label.asrModel",
        type: "select",
        options: ["paraformer-v2", "fun-asr-realtime"],
        allowCustom: true,
      },
      { key: "LANGUAGE_HINTS", labelKey: "settings.label.languageHints", wide: true, type: "text" },
    ],
  },
  {
    titleKey: "settings.group.translation",
    fields: [
      {
        key: "LLM_MODEL",
        labelKey: "settings.label.llmModel",
        wide: true,
        type: "select",
        options: ["deepseek-v3.2", "qwen3-max-preview", "glm-4.7", "kimi-k2-thinking"],
        allowCustom: true,
      },
      { key: "LLM_BASE_URL", labelKey: "settings.label.llmBaseUrl", wide: true, type: "text" },
      {
        key: "BATCH_LINES",
        labelKey: "settings.label.batchLines",
        type: "select",
        options: ["5", "10", "20", "40"],
      },
      {
        key: "MAX_CONCURRENT_TRANSLATIONS",
        labelKey: "settings.label.concurrency",
        type: "select",
        options: ["1", "2", "4", "8"],
      },
    ],
  },
  {
    titleKey: "settings.group.oss",
    fields: [
      { key: "OSS_ENDPOINT", labelKey: "settings.label.ossEndpoint", type: "text" },
      { key: "OSS_BUCKET", labelKey: "settings.label.ossBucket", type: "text" },
      {
        key: "OSS_URL_MODE",
        labelKey: "settings.label.ossUrlMode",
        type: "select",
        options: ["presign", "public"],
      },
    ],
  },
  {
    titleKey: "settings.group.web",
    fields: [
      { key: "WEB_AUTH_ENABLED", labelKey: "settings.label.webAuthEnabled", type: "switch" },
      { key: "WEB_AUTH_USER", labelKey: "settings.label.webAuthUser", type: "text" },
      { key: "WEB_AUTH_PASSWORD", labelKey: "settings.label.webAuthPassword", type: "text" },
    ],
  },
];

export default function SettingsPage() {
  const { t } = useI18n();
  const { pushToast } = useToast();
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
      pushToast(t("settings.saved"), "success");
    } catch {
      setMessage(t("settings.saveFailed"));
      pushToast(t("settings.saveFailed"), "error");
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
              {group.fields.map((field) => {
                const value = values[field.key] || "";
                const isSwitch = field.type === "switch";
                const isSelect = field.type === "select";
                const isNumber = field.type === "number";
                return (
                  <div key={field.key} className={`grid gap-2 ${field.wide ? "md:col-span-2" : ""}`}>
                    <label className="text-sm text-neutral-500">{t(field.labelKey)}</label>
                    {isSwitch ? (
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={value === "true"}
                          onCheckedChange={(checked) =>
                            setValues((prev) => ({
                              ...prev,
                              [field.key]: checked ? "true" : "false",
                            }))
                          }
                        />
                        <span className="text-xs text-neutral-500">
                          {value === "true" ? t("settings.option.on") : t("settings.option.off")}
                        </span>
                      </div>
                    ) : isSelect ? (
                      <div className="grid gap-2">
                        <Select
                          value={value}
                          onChange={(event) =>
                            setValues((prev) => ({
                              ...prev,
                              [field.key]: event.target.value,
                            }))
                          }
                        >
                          {(field.options || []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          {field.allowCustom ? <option value={value}>{value || t("settings.option.custom")}</option> : null}
                        </Select>
                        {field.allowCustom ? (
                          <Input
                            value={value}
                            placeholder={t("settings.option.custom")}
                            onChange={(event) =>
                              setValues((prev) => ({
                                ...prev,
                                [field.key]: event.target.value,
                              }))
                            }
                          />
                        ) : null}
                      </div>
                    ) : (
                      <Input
                        type={isNumber ? "number" : "text"}
                        value={value}
                        placeholder={isSensitive(field.key) ? t("settings.hidden") : ""}
                        onChange={(event) =>
                          setValues((prev) => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                );
              })}
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
