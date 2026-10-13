import type { SupabaseClient } from "@supabase/supabase-js";
import { postSlack, slackDisplayName } from "@/lib/slack";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

// Upload fan-out (never blocks the response): in-app notifications for
// managers/admins + Slack channel post, both with who/where/what details.
// Shared by the Supabase-intake upload and the direct-to-Google upload so
// both paths announce identically.
export async function notifyUpload(db: Db, req: Request, args: {
  fileId: string; name: string; size?: number | null; folderId?: string | null;
  userId: string; username: string; origin?: string;
}) {
  try {
    const origin = args.origin ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    let where = "Workspace";
    if (args.folderId) {
      const { data: fol } = await db.from("folders").select("name").eq("id", args.folderId).maybeSingle();
      if ((fol as { name?: string } | null)?.name) where = `folder “${(fol as { name: string }).name}”`;
    }
    const sizeTxt = args.size ? ` · ${formatBytes(args.size)}` : "";
    const link = `${origin}/drive/${args.fileId}`;
    const ext = (args.name.split(".").pop() ?? "").toUpperCase() || "FILE";
    const typeTxt = /^(PDF|DOCX|XLSX|PPTX)$/.test(ext) ? `${ext} Document`
      : /^(MP4|MOV|AVI|MKV|WEBM)$/.test(ext) ? `${ext} Video`
      : /^(PNG|JPG|JPEG|GIF|WEBP|SVG|HEIC|TIFF?)$/.test(ext) ? `${ext === "JPG" ? "JPG" : ext} Image`
      : /^(MP3|WAV|FLAC|OGG)$/.test(ext) ? `${ext} Audio`
      : `${ext} File`;
    // Uploader identity: `Slack display` / eiden_username. The Slack label is
    // literal inline code (`@name`) — deliberately NOT <@USER_ID>, so it never
    // pings anyone. Missing/invalid/unresolvable IDs fall back to the Eiden
    // username; a failed lookup never fails the upload (diagnostics go to
    // server logs inside slackDisplayName).
    let byline = args.username;
    try {
      const { data: prof } = await db.from("profiles").select("slack_user_id").eq("id", args.userId).maybeSingle();
      const sid = ((prof ?? {}) as { slack_user_id?: string | null }).slack_user_id;
      if (sid) {
        const display = await slackDisplayName(sid);
        if (display) byline = `\`@${display}\` / ${args.username}`;
      }
    } catch (e) {
      console.warn(`[upload-notify] identity lookup failed, using Eiden username: ${e instanceof Error ? e.message : e}`);
    }
    const { data: staff } = await db.from("profiles").select("id").in("role", ["admin", "manager"]).limit(20);
    for (const s of (staff ?? []) as { id: string }[]) {
      if (s.id === args.userId) continue; // uploader doesn't notify themselves
      await db.from("notifications").insert({
        user_id: s.id, kind: "upload",
        title: `${args.username} uploaded ${args.name}`,
        body: `${where}${sizeTxt} · ${link}`
      });
    }
    postSlack(`:outbox_tray: File uploaded\n\n${args.name}\nUploaded by ${byline}\n\n:file_folder: Location: ${where} :page_facing_up: Type: ${typeTxt} :floppy_disk: Size: ${args.size ? formatBytes(args.size) : "unknown"}\n:link: <${link}|View file in Drive>`).then((r) => {
      if (!r.ok) console.error("[slack-upload]", r.error);
    });
  } catch { /* fan-out never fails the upload */ }
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${u[i]}`;
}
