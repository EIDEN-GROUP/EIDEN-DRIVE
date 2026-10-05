import { Card, Pill, StorageBar } from "../ui/primitives";

export function SecurityOverview({ agent = "online", backupMin = 2 }: { agent?: string; backupMin?: number }) {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card label="Backends">
        <p className="text-sm mt-1">Google Workspace <Pill tone="green">Connected</Pill></p>
        <p className="text-sm mt-1">Local Agent <Pill tone={agent === "online" ? "green" : "red"}>{agent}</Pill></p>
        <p className="text-sm mt-1">Backup <Pill tone="green">Healthy · {backupMin}m ago</Pill></p>
      </Card>
      <Card label="Storage">
        <div className="mt-1 flex flex-col gap-2">
          <StorageBar label="Google Drive 1.42 / 5 TB" used={1.42} total={5} />
          <StorageBar label="Local USB 2.1 / 4 TB" used={2.1} total={4} />
        </div>
      </Card>
      <Card label="Recent security events">
        <ul className="text-sm mt-1">
          <li>⚠ Large download · Aya · 8.3 GB</li>
          <li>⚠ External share · Finance/Q4.xlsx</li>
          <li>✓ Backup completed</li>
        </ul>
      </Card>
    </div>
  );
}
