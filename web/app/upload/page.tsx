import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

export default function UploadPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-3xl space-y-6">
        <h1 className="section-title">上传</h1>
        <Card>
          <CardHeader>
            <CardTitle>创建任务</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm text-dune">ASR 模式</label>
              <Select>
                <option value="offline">offline</option>
                <option value="realtime">realtime</option>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-dune">切片模式</label>
              <Select>
                <option value="post">post</option>
                <option value="auto">auto</option>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-dune">媒体文件</label>
              <input type="file" />
            </div>
            <Button>上传并创建任务</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
