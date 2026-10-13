import ActivityClient from "./ActivityClient";
import { getProfile } from "@/lib/roles";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity — Eiden Drive" };

// Admin-only: the feed names people and exposes IPs. Server gate (not just
// hidden nav) — direct navigation renders Restricted, never the feed.
export default async function ActivityPage() {
  const me = await getProfile();
  if (!me || me.role !== "admin") {
    return (
      <section className="px-0 sm:px-1 pt-1 max-w-[1600px] mx-auto">
        <h1 className="page-title mb-4">Activity</h1>
        <Card label="Restricted">
          <p className="text-sm text-muted">The activity feed is visible to admins only.</p>
        </Card>
      </section>
    );
  }
  return <ActivityClient />;
}
