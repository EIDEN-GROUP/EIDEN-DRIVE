import { Card } from "@/components/ui/primitives";
import { StorageBar } from "@/components/ui/primitives";

export default function StoragePage() {
  return (
    <section className="px-1 pt-1">
      <h1 className="page-title mb-4">Storage & Backups</h1>
      <div className="grid md:grid-cols-2 gap-4">
        <Card label="Capacity (alerts at 80 / 95%)">
          <div className="mt-1 flex flex-col gap-3">
            <StorageBar label="Google Drive 1.42 / 5 TB" used={1.42} total={5} />
            <StorageBar label="Local USB 2.1 / 4 TB" used={2.1} total={4} />
            <StorageBar label="Backup 1.88 TB · Verified" used={1.88} total={4} />
          </div>
        </Card>
        <Card label="Jobs">
          <p className="text-sm">Last backup 2 min ago · Last restore yesterday · Integrity ✓. Queue lives in `jobs` table, fed by Local Agent.</p>
        </Card>
      </div>
    </section>
  );
}
