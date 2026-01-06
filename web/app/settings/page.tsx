import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const fields = [
  { label: "DASHSCOPE_API_KEY", placeholder: "sk-..." },
  { label: "ASR_MODE", placeholder: "offline / realtime" },
  { label: "WATCH_DIRS", placeholder: "/watch,/media" },
  { label: "LLM_MODEL", placeholder: "deepseek-v3.2" },
];

export default function SettingsPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-4xl space-y-6">
        <h1 className="section-title">设置</h1>
        <Card>
          <CardHeader>
            <CardTitle>运行配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field) => (
              <div key={field.label} className="grid gap-2">
                <label className="text-sm text-dune">{field.label}</label>
                <Input placeholder={field.placeholder} />
              </div>
            ))}
            <Button>保存配置</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
