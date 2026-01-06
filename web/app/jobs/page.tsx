import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const rows = [
  { id: "job-001", path: "/watch/onepiece.mkv", status: "running", asr: "realtime" },
  { id: "job-002", path: "/watch/ep02.mkv", status: "done", asr: "offline" },
];

export default function JobsPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-5xl space-y-6">
        <h1 className="section-title">任务</h1>
        <div className="flex items-center gap-3">
          <Button variant="outline">触发扫描</Button>
          <Button variant="ghost">导出 JSON</Button>
          <Button variant="ghost">导出 CSV</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>路径</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>ASR</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.id}</TableCell>
                <TableCell>{row.path}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>{row.asr}</TableCell>
                <TableCell>
                  <Button size="sm">字幕</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}
