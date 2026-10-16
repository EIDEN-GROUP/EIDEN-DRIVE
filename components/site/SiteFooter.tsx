import Link from "next/link";
import Logo from "../ui/Logo";

export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="font-brand leading-none">
              <span className="block text-[18px] font-bold tracking-tight text-brand">Eiden</span>
              <span className="block text-[11px] font-medium text-ink/70 tracking-wide">Drive</span>
            </span>
          </div>
          <p className="mt-4 text-[13.5px] text-muted leading-relaxed max-w-sm">
            Company FileOS for teams on Google Drive: one workspace, department-scoped access, and an audit trail on everything that matters.
          </p>
          <p className="mt-3 text-[13px] text-muted">Contact: <a className="underline" href="mailto:dev@eiden-group.com">dev@eiden-group.com</a></p>
        </div>
        <nav aria-label="Product">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Product</p>
          <ul className="mt-3 space-y-1 text-[14px]">
            <li><Link className="hover:underline min-h-[32px] inline-flex items-center" href="/#product">How it works</Link></li>
            <li><Link className="hover:underline min-h-[32px] inline-flex items-center" href="/#security">Security</Link></li>
            <li><Link className="hover:underline min-h-[32px] inline-flex items-center" href="/#access">Request access</Link></li>
            <li><Link className="hover:underline min-h-[32px] inline-flex items-center" href="/login">Sign in</Link></li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Legal</p>
          <ul className="mt-3 space-y-1 text-[14px]">
            <li><Link className="hover:underline min-h-[32px] inline-flex items-center" href="/privacy">Privacy Policy</Link></li>
            <li><Link className="hover:underline min-h-[32px] inline-flex items-center" href="/terms">Terms of Service</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row gap-1 sm:items-center sm:justify-between text-[12.5px] text-muted">
          <p>© {new Date().getFullYear()} EIDEN GROUP. All rights reserved.</p>
          <p>EIDEN-DRIVE · drive.eiden-group.com</p>
        </div>
      </div>
    </footer>
  );
}
