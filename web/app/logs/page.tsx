import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const logs = [
  "[INFO] 开始处理 {\"path\":\"/watch/onepiece.mkv\"}",
  "[INFO] 识别完成并保存字幕",
  "[WARN] 翻译 SRT 修复完成",
];

export default function LogsPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-5xl space-y-6">
        <h1 className="section-title">日志</h1>
        <div className="flex flex-wrap gap-3">
          <Input placeholder="关键词" className="max-w-xs" />
          <Input placeholder="条数" className="max-w-[120px]" />
          <Button>筛选</Button>
          <Button variant="ghost">导出 JSON</Button>
          <Button variant="ghost">导出 CSV</Button>
        </div>
        <div className="glass-panel rounded-2xl p-4 text-sm text-dune">
          {logs.map((line, idx) => (
            <p key={idx} className="border-b border-border py-2 last:border-none">
              {line}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}
