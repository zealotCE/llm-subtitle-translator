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
  { path: "/media/onepiece.mkv", size: "1.4 GB", status: "active" },
  { path: "/media/ep02.mkv", size: "980 MB", status: "archived" },
];

export default function MediaPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-5xl space-y-6">
        <h1 className="section-title">媒体库</h1>
        <div className="flex flex-wrap gap-3">
          <Button>扫描媒体</Button>
          <Button variant="ghost">导出 JSON</Button>
          <Button variant="ghost">导出 CSV</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>路径</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.path}>
                <TableCell>{row.path}</TableCell>
                <TableCell>{row.size}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell className="flex gap-2">
                  <Button size="sm" variant="outline">
                    元数据
                  </Button>
                  <Button size="sm" variant="ghost">
                    归档
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}
