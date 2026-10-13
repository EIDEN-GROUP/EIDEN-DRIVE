import { getProfile } from "@/lib/roles";
import { Card } from "@/components/ui/primitives";
import StorageClient from "./StorageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage — Eiden Drive" };

// Admin-only: drive administration (connect, scope, resync, backup checks,
// safety settings). Server gate — direct navigation renders Restricted.
// (The sidebar health card + upload drive picker use the scrubbed
// /api/storage + /api/drive/accounts GETs, which stay available.)
export default async function StoragePage() {
  const me = await getProfile();
  if (!me || me.role !== "admin") {
    return (
      <section className="px-0 sm:px-1 pt-1 max-w-[1600px] mx-auto">
        <h1 className="page-title mb-4">Storage &amp; Backups</h1>
        <Card label="Restricted">
          <p className="text-sm text-muted">Storage administration is visible to admins only.</p>
        </Card>
      </section>
    );
  }
  return <StorageClient />;
}
