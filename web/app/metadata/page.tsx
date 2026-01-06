import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function MetadataPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">元数据补全</h1>
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <div className="grid gap-2">
            <label className="text-sm text-dune">原始标题</label>
            <Input placeholder="ワンピース" />
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-dune">简体标题</label>
            <Input placeholder="海贼王" />
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-dune">季 / 集</label>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Season" />
              <Input placeholder="Episode" />
            </div>
          </div>
          <Button>保存元数据</Button>
        </div>
      </section>
    </main>
  );
}
