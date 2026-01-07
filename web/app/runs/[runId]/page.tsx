"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type RunItem = {
  id: string;
  media_id: string;
  media_title?: string;
  media_path?: string;
  stage?: string;
  outputs?: {
    raw?: { id: string; path: string };
    zh?: { id: string; path: string };
    bi?: { id: string; path: string };
    other?: { id: string; path: string; lang?: string }[];
  };
  type: string;
  status: string;
  started_at: number;
  finished_at?: number;
  error?: string;
  log_ref?: string;
};

type StageEvent = { ts: number; message: string; level?: string };

export default function RunDetailPage({ params }: { params: { runId: string } }) {
  const [run, setRun] = useState<RunItem | null>(null);
  const [log, setLog] = useState("");
  const [message, setMessage] = useState("");
  const [pipeline, setPipeline] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [preview, setPreview] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { t } = useI18n();
  const sourceHint = stages.find((stage) => stage.message.includes("强制 ASR"))
    ? "强制 ASR"
    : stages.find((stage) => stage.message.includes("使用已生成字幕"))
      ? "复用字幕"
      : stages.find((stage) => stage.message.includes("识别完成"))
        ? "ASR"
        : "-";
  const stageLabel = (message: string) => {
    const mapping: Record<string, string> = {
      "开始处理": "开始处理",
      "选择音轨": "选择音轨",
      "选择字幕轨": "选择字幕轨",
      "发现现有字幕": "发现现有字幕",
      "已保存现有字幕": "保存现有字幕",
      "检测到简体中文字幕，跳过识别与翻译": "跳过简体字幕",
      "评估模式：跳过覆盖主 SRT": "评估模式跳过主 SRT",
      "忽略现有字幕，继续语音识别": "忽略现有字幕",
      "使用已生成字幕进行简体生成": "复用现有字幕",
      "强制 ASR，忽略已生成字幕": "强制 ASR",
      "ASR 热词启用": "ASR 热词启用",
      "热词词表创建": "热词词表创建",
      "强制翻译": "强制翻译",
      "识别完成并保存字幕": "ASR 完成",
      "已保存简体字幕": "保存简体字幕",
      "开始翻译": "开始翻译",
      "翻译完成": "翻译完成",
      "翻译失败": "翻译失败",
      "翻译初始化失败": "翻译初始化失败",
      "处理完成": "处理完成",
      "处理失败": "处理失败",
    };
    return mapping[message] || message;
  };
  const stageKeyLabel = (key?: string) => {
    if (!key) return "-";
    const mapping: Record<string, string> = {
      init: "初始化",
      probe: "媒体探测",
      subtitle_select: "字幕选择",
      asr_prepare: "ASR 准备",
      asr_call: "ASR 识别",
      translate: "翻译",
    };
    return mapping[key] || key;
  };

  const fetchRun = async () => {
    const res = await fetch(`/api/v3/runs/${params.runId}`);
    const data = await res.json();
    if (data.ok) {
      setRun(data.run);
      setPipeline(data.pipeline || {});
      setStages(data.stages || []);
    }
  };

  const fetchLog = async () => {
    const res = await fetch(`/api/v3/runs/${params.runId}/log`);
    const data = await res.json();
    if (data.ok) {
      setLog(data.log || "");
    }
  };

  const fetchPreview = async (sid: string) => {
    if (!run?.media_id) return;
    if (previewId === sid) {
      setPreviewId(null);
      setPreview("");
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const res = await fetch(`/api/v3/media/${run.media_id}/subtitles/${sid}`);
    const data = await res.json();
    if (data.ok) {
      setPreview(data.content || "");
      setPreviewId(sid);
    }
    setPreviewLoading(false);
  };

  const retryRun = async () => {
    setMessage("");
    const res = await fetch(`/api/v3/runs/${params.runId}/retry`, { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || t("common.failed"));
      return;
    }
    fetchRun();
  };

  useEffect(() => {
    fetchRun();
    fetchLog();
  }, [params.runId]);

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">{t("run.title")}</h1>
        {run ? (
          <div className="glass-panel rounded-2xl p-4 space-y-2 text-sm">
            <div>
              {t("run.field.id")}: {run.id}
            </div>
            <div>
              {t("run.field.media")}: {run.media_title || run.media_id}
            </div>
            {run.media_path ? (
              <div className="text-xs text-neutral-500" title={run.media_path}>
                {run.media_path}
              </div>
            ) : null}
            {run.media_id ? (
              <div>
                <Button size="sm" variant="outline" onClick={() => (window.location.href = `/media/${run.media_id}`)}>
                  {t("activity.mediaLink")}
                </Button>
              </div>
            ) : null}
            <div>
              {t("run.field.type")}: {run.type}
            </div>
            <div>
              {t("run.field.status")}: {run.status}
            </div>
            <div>
              {t("run.field.started")}: {new Date(run.started_at * 1000).toLocaleString()}
            </div>
            {run.finished_at ? (
              <div>
                {t("run.field.finished")}: {new Date(run.finished_at * 1000).toLocaleString()}
              </div>
            ) : null}
            {run.finished_at ? (
              <div>
                {t("run.field.duration")}: {run.finished_at - run.started_at}s
              </div>
            ) : null}
            {run.error ? <div className="text-rose-600">Error: {run.error}</div> : null}
            {run.status === "failed" && run.stage ? (
              <div className="text-rose-600">失败阶段: {stageKeyLabel(run.stage)}</div>
            ) : null}
            {run.log_ref ? <div>Log: {run.log_ref}</div> : null}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t("common.loading")}</p>
        )}
        {run ? (
          <div className="glass-panel rounded-2xl p-4 text-sm text-neutral-600 space-y-2">
            <div className="font-medium text-neutral-900">链路信息</div>
            <div>ASR 模式: {pipeline.asr_mode || "-"}</div>
            <div>切片模式: {pipeline.segment_mode || "-"}</div>
            <div>字幕模式: {pipeline.subtitle_mode || "-"}</div>
            <div>复用字幕: {pipeline.use_existing_subtitle || "-"}</div>
            <div>忽略简体: {pipeline.ignore_simplified_subtitle || "-"}</div>
            <div>字幕来源: {sourceHint}</div>
          </div>
        ) : null}
        {stages.length ? (
          <div className="glass-panel rounded-2xl p-4 text-sm text-neutral-600">
            <div className="font-medium text-neutral-900">工作流记录</div>
            <div className="mt-3 space-y-3">
              {stages.map((stage, idx) => (
                <div key={`${stage.ts}-${idx}`} className="flex items-start gap-3">
                  <div className="mt-1 flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full bg-neutral-900" />
                    {idx < stages.length - 1 ? (
                      <div className="mt-2 h-full w-px flex-1 bg-neutral-200" />
                    ) : null}
                  </div>
                  <div className="flex-1">
                    <div className="text-neutral-900">{stageLabel(stage.message)}</div>
                    <div className="text-xs text-neutral-500">
                      {new Date(stage.ts * 1000).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {run?.outputs ? (
          <div className="glass-panel rounded-2xl p-4 text-sm text-neutral-600 space-y-2">
            <div className="font-medium text-neutral-900">产出物</div>
            {[
              run.outputs.raw ? { label: "raw", id: run.outputs.raw.id, path: run.outputs.raw.path } : null,
              run.outputs.zh ? { label: "zh", id: run.outputs.zh.id, path: run.outputs.zh.path } : null,
              run.outputs.bi ? { label: "bi", id: run.outputs.bi.id, path: run.outputs.bi.path } : null,
              ...(run.outputs.other || []).map((item) => ({
                label: "other",
                id: item.id,
                path: item.path,
              })),
            ]
              .filter(Boolean)
              .map((item) => (
                <div key={item?.path} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate">{item?.label}</div>
                    <div className="text-xs text-neutral-500 truncate">
                      {item?.path?.split("/").pop() || item?.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item?.id ? (
                      <Button size="sm" variant="outline" onClick={() => fetchPreview(item.id)}>
                        {t("common.preview")}
                      </Button>
                    ) : null}
                    {item?.id ? (
                      <a
                        className="text-xs text-neutral-500 hover:text-neutral-800"
                        href={`/api/v3/media/${run.media_id}/subtitles/${item.id}/download`}
                      >
                        {t("common.download")}
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            {previewId ? (
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white/70 p-3 text-xs">
                <div className="mb-2 flex items-center justify-between text-sm text-neutral-700">
                  <span>{t("common.preview")}</span>
                  <Button size="sm" variant="ghost" onClick={() => fetchPreview(previewId)}>
                    {t("common.close")}
                  </Button>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap">
                  {previewLoading ? t("common.loading") : preview || "-"}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
        {message ? <p className="text-sm text-rose-600">{message}</p> : null}
        <div className="glass-panel rounded-2xl p-4 text-sm text-neutral-600">
          <div className="mb-2 flex items-center justify-between">
            <span>{t("run.log")}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={fetchLog}>
                {t("common.refresh")}
              </Button>
              <Button size="sm" onClick={retryRun}>
                {t("common.retry")}
              </Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap">{log || t("run.noLog")}</pre>
        </div>
      </section>
    </main>
  );
}
