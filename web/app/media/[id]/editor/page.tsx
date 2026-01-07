"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type OutputItem = {
  id: string;
  kind: string;
  path: string;
};

type Block = {
  index: string;
  time: string;
  text: string;
};

function parseSrt(content: string): Block[] {
  const blocks = content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return blocks.map((chunk) => {
    const lines = chunk.split(/\n/);
    const index = lines[0] || "";
    const time = lines[1] || "";
    const text = lines.slice(2).join("\n");
    return { index, time, text };
  });
}

function composeSrt(blocks: Block[]) {
  return blocks
    .map((block) => [block.index, block.time, block.text].filter(Boolean).join("\n"))
    .join("\n\n");
}

export default function SubtitleEditor({ params }: { params: { id: string } }) {
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [selected, setSelected] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [current, setCurrent] = useState(0);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const { t } = useI18n();

  const loadOutputs = async () => {
    const res = await fetch(`/api/v3/media/${params.id}/subtitles`);
    const data = await res.json();
    if (data.ok) {
      setOutputs(data.outputs || []);
      if (data.outputs?.[0]?.id) {
        setSelected(data.outputs[0].id);
      }
    }
  };

  const loadContent = async (sid: string) => {
    const res = await fetch(`/api/v3/media/${params.id}/subtitles/${sid}`);
    const data = await res.json();
    if (data.ok) {
      const parsed = parseSrt(data.content || "");
      setBlocks(parsed);
      setCurrent(0);
    }
  };

  useEffect(() => {
    loadOutputs();
  }, [params.id]);

  useEffect(() => {
    if (selected) {
      loadContent(selected);
    }
  }, [selected]);

  const currentBlock = blocks[current];
  const currentText = currentBlock?.text || "";

  const updateCurrent = (value: string) => {
    setBlocks((prev) =>
      prev.map((block, idx) => (idx === current ? { ...block, text: value } : block))
    );
  };

  const handleSave = async (mode: "save" | "save_as") => {
    setMessage("");
    const content = composeSrt(blocks);
    const res = await fetch(`/api/v3/media/${params.id}/subtitles/${selected}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, mode }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || t("common.saveFailed"));
      return;
    }
    setMessage(t("editor.saved"));
    if (mode === "save_as") {
      await loadOutputs();
    }
  };

  const fileName = (value: string) => value.split("/").pop() || value;

  const options = useMemo(
    () => outputs.map((item) => ({ id: item.id, label: `${item.kind} · ${fileName(item.path)}` })),
    [outputs]
  );

  const filteredIndices = useMemo(() => {
    if (!query) return blocks.map((_block, idx) => idx);
    const q = query.toLowerCase();
    return blocks
      .map((block, idx) => ({ block, idx }))
      .filter(({ block }) => block.text.toLowerCase().includes(q) || block.index.includes(q))
      .map(({ idx }) => idx);
  }, [blocks, query]);

  useEffect(() => {
    if (filteredIndices.length) {
      setCurrent(filteredIndices[0]);
    }
  }, [filteredIndices]);

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-6xl space-y-6">
        <h1 className="section-title">{t("editor.title")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="h-10 rounded-xl border border-border bg-white px-3 text-sm"
            placeholder={t("editor.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          <Button onClick={() => handleSave("save")}>{t("editor.save")}</Button>
          <Button variant="outline" onClick={() => handleSave("save_as")}>
            {t("editor.saveAs")}
          </Button>
          {message ? <span className="text-sm text-rose-600">{message}</span> : null}
        </div>
        <div className="grid gap-6 md:grid-cols-[280px,1fr]">
          <div className="glass-panel rounded-2xl p-3 text-sm text-neutral-600">
            {filteredIndices.length ? (
              filteredIndices.map((idx: number) => {
                const block = blocks[idx];
                return (
                <button
                  key={`${block.index}-${idx}`}
                  onClick={() => setCurrent(idx)}
                  className={`mb-2 w-full rounded-xl border px-3 py-2 text-left ${
                    idx === current ? "border-neutral-900 bg-neutral-900/5 text-neutral-900" : "border-transparent hover:border-border"
                  }`}
                >
                  <div className="text-xs text-neutral-500">#{block.index}</div>
                  <div className="truncate text-sm text-neutral-900">{block.text || "(空)"}</div>
                </button>
                );
              })
            ) : (
              <p>{t("editor.empty")}</p>
            )}
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-2 text-xs text-neutral-500">
              {currentBlock ? `${currentBlock.index} · ${currentBlock.time}` : t("editor.selectHint")}
            </div>
            <Textarea
              className="min-h-[420px]"
              value={currentText}
              onChange={(event) => updateCurrent(event.target.value)}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
