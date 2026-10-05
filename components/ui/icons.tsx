type P = { size?: number; className?: string };

// Single-weight (2px) Lucide-style stroke set. No emojis as icons.
function base(size: number, className: string | undefined, path: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {path}
    </svg>
  );
}

export const FolderIcon = ({ size = 20, className }: P) => base(size, className,
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />);
export const FileIcon = ({ size = 20, className }: P) => base(size, className,
  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4" />);
export const PdfIcon = ({ size = 20, className }: P) => base(size, className,
  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M9 13h6 M9 17h4" />);
export const ImageIcon = ({ size = 20, className }: P) => base(size, className,
  <><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>);
export const VideoIcon = ({ size = 20, className }: P) => base(size, className,
  <><path d="m16 13 5.2 3.1a1 1 0 0 0 1.5-.9V8.8a1 1 0 0 0-1.5-.9L16 11Z" /><rect width="14" height="12" x="2" y="6" rx="2" /></>);
export const ZipIcon = ({ size = 20, className }: P) => base(size, className,
  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M10 12v6 M12 10v8 M14 12v6" />);
export const CodeIcon = ({ size = 20, className }: P) => base(size, className, <path d="m16 18 6-6-6-6 M8 6l-6 6 6 6" />);
export const UploadIcon = ({ size = 20, className }: P) => base(size, className, <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12" />);
export const PlusIcon = ({ size = 20, className }: P) => base(size, className, <path d="M5 12h14 M12 5v14" />);
export const GridIcon = ({ size = 20, className }: P) => base(size, className,
  <><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>);
export const ListIcon = ({ size = 20, className }: P) => base(size, className, <path d="M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" />);
export const SearchIcon = ({ size = 20, className }: P) => base(size, className, <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>);
export const TrashIcon = ({ size = 20, className }: P) => base(size, className,
  <path d="M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />);
export const RestoreIcon = ({ size = 20, className }: P) => base(size, className, <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5" />);
export const ChevronRight = ({ size = 20, className }: P) => base(size, className, <path d="m9 18 6-6-6-6" />);
export const ChevronDown = ({ size = 20, className }: P) => base(size, className, <path d="m6 9 6 6 6-6" />);
export const XIcon = ({ size = 20, className }: P) => base(size, className, <path d="M18 6 6 18 M6 6l12 12" />);
export const AlertIcon = ({ size = 20, className }: P) => base(size, className,
  <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4 M12 17h.01" /></>);
export const DownloadIcon = ({ size = 20, className }: P) => base(size, className, <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />);
export const EyeIcon = ({ size = 20, className }: P) => base(size, className,
  <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>);
export const LockIcon = ({ size = 20, className }: P) => base(size, className,
  <><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>);
export const BackIcon = ({ size = 20, className }: P) => base(size, className, <path d="m12 19-7-7 7-7 M19 12H5" />);
export const LogoutIcon = ({ size = 20, className }: P) => base(size, className,
  <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5 M21 12H9" /></>);

export function TypeIcon({ kind, size = 20 }: { kind: string; size?: number }) {
  switch (kind) {
    case "PDF": return <PdfIcon size={size} />;
    case "IMAGE": return <ImageIcon size={size} />;
    case "VIDEO": return <VideoIcon size={size} />;
    case "ARCHIVE": return <ZipIcon size={size} />;
    case "HTML": return <CodeIcon size={size} />;
    default: return <FileIcon size={size} />;
  }
}
