import type { Metadata } from "next";
import { resolveShare } from "@/lib/share";
import ShareView from "./ShareView";

export const dynamic = "force-dynamic";

const ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "https://drive.eiden-group.com").replace(/\/$/, "");

function kindLabel(mime: string, name: string): string {
  const e = (name.split(".").pop() ?? "").toUpperCase();
  if (mime.startsWith("image/")) return `${e} Image`;
  if (mime.startsWith("video/")) return `${e} Video`;
  if (mime.startsWith("audio/")) return `${e} Audio`;
  if (mime === "application/pdf") return "PDF Document";
  return `${e || "File"}`;
}

function fmtSize(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${u[i]}`;
}

// Rich unfurls (Slack, WhatsApp, X…): title + type/size description + cover
// image where one exists. All URLs absolute — scrapers don't do relative.
export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const s = await resolveShare(params.token).catch(() => null);
  if (!s) return { title: "Shared item — Eiden Drive" };
  const name = s.kind === "file" ? s.file.name : s.folder.name;
  const desc = s.kind === "file"
    ? `${kindLabel(s.file.mime, s.file.name)} · ${fmtSize(s.file.size)} · shared via Eiden Drive`
    : `Shared folder · ${name}`;
  const images = s.kind === "file" && (s.file.google_file_id || s.file.mime.startsWith("image/") || s.file.mime.startsWith("video/"))
    ? [{ url: `${ORIGIN}/api/share/${params.token}/thumb` }]
    : [];
  return {
    title: `${name} — Eiden Drive`,
    description: desc,
    openGraph: { title: name, description: desc, siteName: "Eiden Drive", type: "website", images },
    twitter: { card: images.length ? "summary_large_image" : "summary", title: name, description: desc, images: images.map((i) => i.url) }
  };
}

export default async function SharePage({ params }: { params: { token: string } }) {
  const s = await resolveShare(params.token).catch(() => null);
  const initial = s && s.kind === "file" ? { name: s.file.name, mime: s.file.mime, size: s.file.size } : null;
  return <ShareView token={params.token} initial={initial} />;
}
