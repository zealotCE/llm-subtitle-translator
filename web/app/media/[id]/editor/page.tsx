"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
      setMessage(data.message || "保存失败");
      return;
    }
    setMessage("已保存");
    if (mode === "save_as") {
      await loadOutputs();
    }
  };

  const options = useMemo(
    () => outputs.map((item) => ({ id: item.id, label: `${item.kind} · ${item.path}` })),
    [outputs]
  );

  return (
    <main className="min-h-screen px-6 py-10">
      <AuthGuard />
      <section className="mx-auto max-w-6xl space-y-6">
        <h1 className="section-title">Subtitle Editor</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          <Button onClick={() => handleSave("save")}>保存覆盖</Button>
          <Button variant="outline" onClick={() => handleSave("save_as")}>
            另存版本
          </Button>
          {message ? <span className="text-sm text-ember">{message}</span> : null}
        </div>
        <div className="grid gap-6 md:grid-cols-[280px,1fr]">
          <div className="glass-panel rounded-2xl p-3 text-sm text-dune">
            {blocks.length ? (
              blocks.map((block, idx) => (
                <button
                  key={`${block.index}-${idx}`}
                  onClick={() => setCurrent(idx)}
                  className={`mb-2 w-full rounded-xl border px-3 py-2 text-left ${
                    idx === current ? "border-ember bg-ember/10 text-ink" : "border-transparent hover:border-border"
                  }`}
                >
                  <div className="text-xs text-dune">#{block.index}</div>
                  <div className="truncate text-sm text-ink">{block.text || "(空)"}</div>
                </button>
              ))
            ) : (
              <p>暂无字幕内容</p>
            )}
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-2 text-xs text-dune">
              {currentBlock ? `${currentBlock.index} · ${currentBlock.time}` : "选择字幕条目"}
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
