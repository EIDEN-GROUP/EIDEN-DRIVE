// Filled indigo file/folder glyphs from the reference design (not stroke icons).
type Kind = "folder" | "image" | "doc" | "video" | "file";

export function kindOf(classified: string, isFolder = false): Kind {
  if (isFolder) return "folder";
  if (classified === "IMAGE" || classified === "DESIGN") return "image";
  if (classified === "VIDEO") return "video";
  if (["PDF", "DOCX", "XLSX", "PPTX", "HTML"].includes(classified)) return "doc";
  return "file";
}

export function FileGlyph({ kind, size = 22, className = "" }: { kind: Kind; size?: number; className?: string }) {
  const c = "var(--icon)";
  if (kind === "folder") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path d="M2 6.2A2.2 2.2 0 0 1 4.2 4h4.6c.6 0 1.2.25 1.6.7L11.6 6H19.8A2.2 2.2 0 0 1 22 8.2v9.6a2.2 2.2 0 0 1-2.2 2.2H4.2A2.2 2.2 0 0 1 2 17.8z" fill={c} />
        <path d="M2 9.2A2.2 2.2 0 0 1 4.2 7h15.6A2.2 2.2 0 0 1 22 9.2V10H2z" fill="#fff" opacity=".18" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill={c} />
      <path d="M14 2l6 6h-4a2 2 0 0 1-2-2z" fill="#fff" opacity=".4" />
      {kind === "image" && (<><circle cx="9.4" cy="12.2" r="1.3" fill="#fff" /><path d="m6.6 18.6 3.4-4.4 2.2 2.6 1.9-2.1 3.3 3.9z" fill="#fff" /></>)}
      {kind === "doc" && (<><rect x="7.2" y="11.2" width="9.6" height="1.5" rx=".75" fill="#fff" /><rect x="7.2" y="14.2" width="9.6" height="1.5" rx=".75" fill="#fff" /><rect x="7.2" y="17.2" width="6" height="1.5" rx=".75" fill="#fff" /></>)}
      {kind === "video" && (<><rect x="7" y="12" width="6.6" height="6" rx="1.2" fill="#fff" /><path d="m14.4 14.2 2.8-1.5v4.6l-2.8-1.5z" fill="#fff" /></>)}
    </svg>
  );
}
