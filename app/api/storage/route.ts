import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";
import { storageAlert } from "@/lib/alerts";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Stub capacities until Google quota + agent df wired (P1). Shape is final.
  const google = { used: 1.42, total: 5 };
  const usb = { used: 2.1, total: 4 };
  return Response.json({
    google: { ...google, alert: storageAlert(google.used, google.total) },
    usb: { ...usb, alert: storageAlert(usb.used, usb.total) },
    backup: { last_min_ago: 2, healthy: true }
  });
}
