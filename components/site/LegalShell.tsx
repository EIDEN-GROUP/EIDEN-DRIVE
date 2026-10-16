import Link from "next/link";
import SiteNav from "./SiteNav";
import SiteFooter from "./SiteFooter";

export default function LegalShell({ title, updated, intro, children }: {
  title: string;
  updated: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div id="top" className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-28 pb-16">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">EIDEN-DRIVE · Legal</p>
        <h1 className="mt-2 text-[30px] sm:text-[36px] font-semibold tracking-tight text-balance">{title}</h1>
        <p className="mt-2 text-[13px] text-muted">Last updated: {updated}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/85">{intro}</p>
        <div className="md-body mt-8">{children}</div>
        <div className="mt-10 flex flex-col sm:flex-row gap-2">
          <Link href="/terms" className="min-h-[44px] px-4 inline-flex items-center justify-center rounded-lg border border-line text-[14px] font-medium hover:bg-tint">
            Terms of Service
          </Link>
          <Link href="/privacy" className="min-h-[44px] px-4 inline-flex items-center justify-center rounded-lg border border-line text-[14px] font-medium hover:bg-tint">
            Privacy Policy
          </Link>
          <Link href="/#access" className="min-h-[44px] px-4 inline-flex items-center justify-center rounded-lg bg-brand text-white text-[14px] font-medium hover:brightness-110">
            Request access
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
