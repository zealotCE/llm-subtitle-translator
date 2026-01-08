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
  helpKey?: string;
  type: "text" | "number" | "switch" | "select";
  wide?: boolean;
  options?: Array<string | { labelKey: string; options: string[] }>;
  allowCustom?: boolean;
  advancedOnly?: boolean;
};

type Group = {
  titleKey: string;
  fields: Field[];
};

const GROUPS: Group[] = [
  {
    titleKey: "settings.group.watch",
    fields: [
      {
        key: "WATCH_DIRS",
        labelKey: "settings.label.watchDirs",
        helpKey: "settings.help.watchDirs",
        wide: true,
        type: "text",
      },
      {
        key: "WATCH_RECURSIVE",
        labelKey: "settings.label.watchRecursive",
        helpKey: "settings.help.watchRecursive",
        type: "switch",
      },
      {
        key: "SCAN_INTERVAL",
        labelKey: "settings.label.scanInterval",
        helpKey: "settings.help.scanInterval",
        type: "number",
      },
      {
        key: "OUTPUT_TO_SOURCE_DIR",
        labelKey: "settings.label.outputToSource",
        helpKey: "settings.help.outputToSource",
        type: "switch",
      },
      {
        key: "DELETE_SOURCE_AFTER_DONE",
        labelKey: "settings.label.deleteSourceAfterDone",
        helpKey: "settings.help.deleteSourceAfterDone",
        type: "switch",
      },
    ],
  },
  {
    titleKey: "settings.group.asr",
    fields: [
      {
        key: "ASR_MODE",
        labelKey: "settings.label.asrMode",
        helpKey: "settings.help.asrMode",
        type: "select",
        options: ["auto", "offline", "realtime"],
      },
      {
        key: "ASR_MODEL",
        labelKey: "settings.label.asrModel",
        helpKey: "settings.help.asrModel",
        type: "select",
        options: [
          {
            labelKey: "settings.option.asrGroupOffline",
            options: ["paraformer-8k-v2", "paraformer-v2", "fun-asr-2025-11-07"],
          },
          {
            labelKey: "settings.option.asrGroupRealtime",
            options: ["fun-asr-realtime-2025-11-07", "paraformer-realtime-8k-v2", "paraformer-realtime-v2"],
          },
        ],
        allowCustom: true,
      },
      {
        key: "LANGUAGE_HINTS",
        labelKey: "settings.label.languageHints",
        helpKey: "settings.help.languageHints",
        wide: true,
        type: "text",
      },
      {
        key: "ASR_REALTIME_MODELS",
        labelKey: "settings.label.asrRealtimeModels",
        helpKey: "settings.help.asrRealtimeModels",
        wide: true,
        type: "text",
        advancedOnly: true,
      },
      {
        key: "ASR_OFFLINE_MODELS",
        labelKey: "settings.label.asrOfflineModels",
        helpKey: "settings.help.asrOfflineModels",
        wide: true,
        type: "text",
        advancedOnly: true,
      },
    ],
  },
  {
    titleKey: "settings.group.translation",
    fields: [
      {
        key: "LLM_MODEL",
        labelKey: "settings.label.llmModel",
        helpKey: "settings.help.llmModel",
        wide: true,
        type: "select",
        options: ["deepseek-v3.2", "qwen3-max-preview", "glm-4.7", "kimi-k2-thinking"],
        allowCustom: true,
      },
      { key: "LLM_API_KEY", labelKey: "settings.label.llmApiKey", helpKey: "settings.help.llmApiKey", wide: true, type: "text" },
      { key: "LLM_BASE_URL", labelKey: "settings.label.llmBaseUrl", helpKey: "settings.help.llmBaseUrl", wide: true, type: "text" },
      {
        key: "BATCH_LINES",
        labelKey: "settings.label.batchLines",
        helpKey: "settings.help.batchLines",
        type: "select",
        options: ["5", "10", "20", "40"],
      },
      {
        key: "MAX_CONCURRENT_TRANSLATIONS",
        labelKey: "settings.label.concurrency",
        helpKey: "settings.help.concurrency",
        type: "select",
        options: ["1", "2", "4", "8"],
      },
    ],
  },
  {
    titleKey: "settings.group.oss",
    fields: [
      { key: "OSS_ENDPOINT", labelKey: "settings.label.ossEndpoint", type: "text" },
      { key: "OSS_BUCKET", labelKey: "settings.label.ossBucket", helpKey: "settings.help.ossBucket", type: "text" },
      { key: "OSS_ACCESS_KEY_ID", labelKey: "settings.label.ossAccessKeyId", helpKey: "settings.help.ossAccessKeyId", wide: true, type: "text" },
      {
        key: "OSS_ACCESS_KEY_SECRET",
        labelKey: "settings.label.ossAccessKeySecret",
        helpKey: "settings.help.ossAccessKeySecret",
        wide: true,
        type: "text",
      },
      {
        key: "OSS_URL_MODE",
        labelKey: "settings.label.ossUrlMode",
        helpKey: "settings.help.ossUrlMode",
        type: "select",
        options: ["presign", "public"],
      },
    ],
  },
  {
    titleKey: "settings.group.web",
    fields: [
      { key: "WEB_AUTH_ENABLED", labelKey: "settings.label.webAuthEnabled", helpKey: "settings.help.webAuthEnabled", type: "switch" },
      { key: "WEB_AUTH_USER", labelKey: "settings.label.webAuthUser", helpKey: "settings.help.webAuthUser", type: "text" },
      {
        key: "WEB_AUTH_PASSWORD",
        labelKey: "settings.label.webAuthPassword",
        helpKey: "settings.help.webAuthPassword",
        type: "text",
      },
    ],
  },
  {
    titleKey: "settings.group.metadata",
    fields: [
      { key: "TMDB_API_KEY", labelKey: "settings.label.tmdbApiKey", helpKey: "settings.help.tmdbApiKey", wide: true, type: "text" },
      {
        key: "BANGUMI_ACCESS_TOKEN",
        labelKey: "settings.label.bangumiToken",
        helpKey: "settings.help.bangumiToken",
        wide: true,
        type: "text",
      },
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
  const [versions, setVersions] = useState<{ name: string; created_at: number }[]>([]);
  const [versionName, setVersionName] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [importing, setImporting] = useState(false);

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

  const loadVersions = async () => {
    const res = await fetch("/api/v3/settings/versions");
    const data = await res.json();
    if (data.ok) {
      setVersions(data.versions || []);
    }
  };

  useEffect(() => {
    loadVersions();
  }, []);

  const entries = useMemo(() => Object.entries(values).sort(([a], [b]) => a.localeCompare(b)), [values]);

  const flattenOptions = (options: Field["options"]) => {
    if (!options) return [];
    return options.flatMap((option) =>
      typeof option === "string" ? [option] : option.options
    );
  };

  const renderOptions = (options: Field["options"]) => {
    if (!options) return null;
    return options.map((option) => {
      if (typeof option === "string") {
        return (
          <option key={option} value={option}>
            {option}
          </option>
        );
      }
      return (
        <optgroup key={option.labelKey} label={t(option.labelKey)}>
          {option.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </optgroup>
      );
    });
  };

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

  const handleSaveVersion = async () => {
    if (!versionName.trim()) {
      pushToast(t("settings.versionNameRequired"), "error");
      return;
    }
    const res = await fetch("/api/v3/settings/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", name: versionName.trim(), values }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      pushToast(data.message || t("settings.saveFailed"), "error");
      return;
    }
    pushToast(t("settings.versionSaved"), "success");
    setSelectedVersion(versionName.trim());
    setVersionName("");
    loadVersions();
  };

  const handleLoadVersion = async () => {
    if (!selectedVersion) return;
    const res = await fetch("/api/v3/settings/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", name: selectedVersion }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      pushToast(data.message || t("settings.loadFailed"), "error");
      return;
    }
    setValues(data.values || {});
    pushToast(t("settings.versionLoaded"), "success");
  };

  const handleDeleteVersion = async () => {
    if (!selectedVersion) return;
    const res = await fetch("/api/v3/settings/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", name: selectedVersion }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      pushToast(data.message || t("settings.saveFailed"), "error");
      return;
    }
    setSelectedVersion("");
    loadVersions();
    pushToast(t("settings.versionDeleted"), "success");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(values, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const content = await file.text();
      const data = JSON.parse(content);
      if (data && typeof data === "object") {
        setValues(data as Record<string, string>);
        pushToast(t("settings.imported"), "success");
      }
    } catch {
      pushToast(t("settings.importFailed"), "error");
    } finally {
      setImporting(false);
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
                if (field.advancedOnly && !advanced) {
                  return null;
                }
                const value = values[field.key] || "";
                const isSwitch = field.type === "switch";
                const isSelect = field.type === "select";
                const isNumber = field.type === "number";
                const flatOptions = flattenOptions(field.options);
                const options = flatOptions.filter((option, index, arr) => arr.indexOf(option) === index);
                const isCustomValue = field.allowCustom && value && !options.includes(value);
                const selectValue =
                  isSelect && field.allowCustom
                    ? isCustomValue
                      ? "__custom__"
                      : value || options[0] || ""
                    : value || options[0] || "";
                return (
                  <div key={field.key} className={`grid gap-2 ${field.wide ? "md:col-span-2" : ""}`}>
                    <label className="text-sm text-neutral-500">{t(field.labelKey)}</label>
                    {isSwitch ? (
                      <div className="grid gap-2">
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
                        {field.helpKey ? (
                          <p className="text-xs text-neutral-500">{t(field.helpKey)}</p>
                        ) : null}
                      </div>
                    ) : isSelect ? (
                      <div className="grid gap-2">
                        <Select
                          value={selectValue}
                          onChange={(event) =>
                            setValues((prev) => ({
                              ...prev,
                              [field.key]:
                                event.target.value === "__custom__"
                                  ? prev[field.key] || ""
                                  : event.target.value,
                            }))
                          }
                        >
                          {renderOptions(field.options)}
                          {field.allowCustom ? (
                            <option value="__custom__">{t("settings.option.custom")}</option>
                          ) : null}
                        </Select>
                        {field.allowCustom && selectValue === "__custom__" ? (
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
                        {field.helpKey ? (
                          <p className="text-xs text-neutral-500">{t(field.helpKey)}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="grid gap-2">
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
                        {field.helpKey ? (
                          <p className="text-xs text-neutral-500">{t(field.helpKey)}</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.versionTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                value={versionName}
                placeholder={t("settings.versionName")}
                onChange={(event) => setVersionName(event.target.value)}
              />
              <Button variant="outline" onClick={handleSaveVersion}>
                {t("settings.versionSave")}
              </Button>
              <Button variant="outline" onClick={exportJson}>
                {t("settings.exportJson")}
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Select
                value={selectedVersion}
                onChange={(event) => setSelectedVersion(event.target.value)}
              >
                <option value="">{t("settings.versionSelect")}</option>
                {versions.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleLoadVersion}>
                  {t("settings.versionApply")}
                </Button>
                <Button variant="ghost" onClick={handleDeleteVersion}>
                  {t("settings.versionDelete")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-full border border-border bg-white px-4 py-2 text-sm">
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(event) => importJson(event.target.files?.[0] || null)}
                  />
                  {importing ? t("settings.importing") : t("settings.importJson")}
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
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
