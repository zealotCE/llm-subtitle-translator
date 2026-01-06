import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function SubtitlePage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">字幕编辑</h1>
        <div className="glass-panel rounded-2xl p-4">
          <p className="text-sm text-dune">/media/onepiece.mkv → onepiece.srt</p>
          <Textarea className="mt-4 min-h-[420px]" defaultValue="1\n00:00:01,000 --> 00:00:02,000\n示例字幕" />
          <div className="mt-4 flex gap-3">
            <Button>保存</Button>
            <Button variant="outline">另存版本</Button>
          </div>
        </div>
      </section>
    </main>
  );
}
