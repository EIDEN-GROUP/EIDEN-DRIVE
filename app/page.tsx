import type { Metadata } from "next";
import Link from "next/link";
import {
  FolderClosed, Users, ScrollText, KeyRound, MessageSquare, WifiOff,
  ArrowRight, Check, Search, ShieldCheck, HardDrive,
} from "lucide-react";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import AccessForm from "@/components/site/AccessForm";
import Reveal from "@/components/site/Reveal";

export const metadata: Metadata = {
  title: "EIDEN-DRIVE — Company FileOS for Google Drive",
  description: "One company workspace over your Google Shared Drives: department-scoped access, audit trails, secure vault, and offline-ready workflows.",
};

const STEPS = [
  {
    n: "01",
    title: "Connect your drives",
    body: "Admins connect each Google Shared Drive once. Every file row remembers its drive, so view, download, trash, and copy always use the right account.",
  },
  {
    n: "02",
    title: "Organize by department",
    body: "Folders carry departments. Members see their department's content, managers keep the full picture, and confidential material stays excluded.",
  },
  {
    n: "03",
    title: "Work with proof",
    body: "Uploads, shares, renames, moves, and restores are logged with who and when. Approvals and retention rules apply where they matter.",
  },
];

const FEATURES = [
  { icon: FolderClosed, title: "One unified drive", body: "Workspace folders and every connected Google Drive in a single browser — no more asking which drive holds the file." },
  { icon: Users, title: "Departments and roles", body: "Admin, manager, and member roles with department tags, so each team sees its own work and nothing else." },
  { icon: ScrollText, title: "Audit trail", body: "Activity and security views record the events that matter, from uploads and shares to permission changes." },
  { icon: KeyRound, title: "Secure vault", body: "Encrypted storage for credentials and sensitive notes, with enrollment and per-user access." },
  { icon: MessageSquare, title: "Slack where you work", body: "Upload notifications and file sharing from Slack, with per-user account linking." },
  { icon: WifiOff, title: "Offline and office ready", body: "Resumable uploads, USB copy queues through the local agent, and backups that verify." },
];

const FAQS = [
  {
    q: "Does EIDEN-DRIVE move my files into another system?",
    a: "No. Files stay in your connected Google Drives. EIDEN-DRIVE indexes them, records which drive each file belongs to, and performs operations against the right account — it does not silently relocate your data into a separate silo.",
  },
  {
    q: "What does it access in Google Drive?",
    a: "With your administrator's consent, it lists, reads, creates, updates, and organizes files and folders in the connected drives. That access exists only to run workspace operations such as browsing, search, upload, move, share, sync, and backup. See the Privacy Policy for the full statement.",
  },
  {
    q: "Who can see my department's files?",
    a: "Members see their department's folders, files they own, and items explicitly shared with them. Confidential folders stay excluded, and every mutation re-checks permissions on the server.",
  },
  {
    q: "How do I get an account?",
    a: "Request access below with your work email. A manager reviews the request and invites you by email. If your team is already onboard, sign in directly.",
  },
  {
    q: "What happens if our internet or a drive goes down?",
    a: "Uploads are resumable, the app keeps working from its index where possible, and sync plus backup verification catch up when the drive is reachable again.",
  },
];

export default function LandingPage() {
  return (
    <div id="top" className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main>
        {/* ── Hero ── */}
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-28 sm:pt-32 pb-12 sm:pb-16 grid gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <div>
              <p className="hero-in inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink/80">
                <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
                Company FileOS · Built on Google Drive
              </p>
              <h1 className="hero-in mt-5 text-[34px] leading-[1.08] sm:text-[46px] font-semibold tracking-tight text-balance" style={{ animationDelay: "90ms" }}>
                Every company file. One drive. Zero guesswork.
              </h1>
              <p className="hero-in mt-5 text-[16px] sm:text-[17px] leading-relaxed text-ink/75 max-w-xl" style={{ animationDelay: "180ms" }}>
                EIDEN-DRIVE unifies your Google Shared Drives into one workspace with department-scoped
                access, a full audit trail, and a secure vault — without moving your files into another silo.
              </p>
              <div className="hero-in mt-7 flex flex-col sm:flex-row gap-2.5" style={{ animationDelay: "270ms" }}>
                <Link href="#access" className="min-h-[52px] px-6 inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-white text-[15.5px] font-medium hover:brightness-110 active:brightness-95 transition">
                  Request access <ArrowRight size={17} />
                </Link>
                <Link href="/login" className="min-h-[52px] px-6 inline-flex items-center justify-center rounded-lg border border-line bg-surface text-[15.5px] font-medium hover:bg-tint transition">
                  Sign in
                </Link>
              </div>
              <ul className="hero-in mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-muted" style={{ animationDelay: "340ms" }}>
                <li className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand" /> Admin-approved accounts</li>
                <li className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand" /> Department-scoped access</li>
                <li className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand" /> Audit on everything</li>
              </ul>
            </div>

            {/* Product composition (static mock, no fake data claims) */}
            <Reveal variant="scale" className="card shadow-win overflow-hidden" >
            <div aria-hidden="true">
              <div className="flex items-center gap-1.5 px-4 h-11 border-b border-line bg-soft">
                <span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" />
                <span className="ml-3 text-[12px] text-muted">EIDEN-DRIVE · Workspace</span>
              </div>
              <div className="grid sm:grid-cols-[1fr_220px]">
                <div className="p-3 space-y-1.5">
                  {[
                    ["Clients", "12 files · Finance"],
                    ["Contracts", "8 files · Legal"],
                    ["Site photos", "46 files · Operations"],
                    ["Invoices 2026", "31 files · Finance"],
                  ].map(([name, meta]) => (
                    <div key={name} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
                      <FolderClosed size={17} className="text-brand shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium truncate">{name}</p>
                        <p className="text-[11.5px] text-muted">{meta}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t sm:border-t-0 sm:border-l border-line bg-soft p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Audit trail</p>
                  <ul className="mt-2.5 space-y-2.5 text-[12px] leading-snug">
                    <li><span className="font-medium">Amina</span> shared <span className="font-medium">Contracts</span> <span className="text-muted">· 2m</span></li>
                    <li><span className="font-medium">Yusuf</span> uploaded <span className="font-medium">Invoice 1042</span> <span className="text-muted">· 18m</span></li>
                    <li><span className="font-medium">Admin</span> restored <span className="font-medium">Site photos</span> <span className="text-muted">· 1h</span></li>
                  </ul>
                  <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px]">
                    <p className="font-medium">Storage</p>
                    <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full w-2/3 rounded-full bg-brand" /></div>
                    <p className="mt-1.5 text-muted">2 drives connected</p>
                  </div>
                </div>
              </div>
            </div>
            </Reveal>
          </div>
        </section>

        {/* ── Problem ── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">The problem</p>
          <h2 className="mt-2 text-[24px] sm:text-[30px] font-semibold tracking-tight text-balance max-w-2xl">
            Shared drives sprawl. Permissions blur. Nobody can prove what happened.
          </h2>
          <div className="mt-7 grid gap-3 md:grid-cols-3">
            {[
              { icon: Search, title: "Files scattered everywhere", body: "Nobody remembers which drive holds the contract, the photos, or last month's invoices — so work stalls while people hunt." },
              { icon: Users, title: "Access is guesswork", body: "Folders get shared ad hoc, departments overlap, and confidential material sits one wrong click away." },
              { icon: ScrollText, title: "No record of change", body: "When something moves, disappears, or leaks, there is no reliable who-and-when to answer for it." },
            ].map((c, i) => (
              <Reveal key={c.title} delay={Math.min(i, 2) * 90}>
              <div className="card lift p-6 h-full">
                <c.icon size={20} className="text-brand" />
                <h3 className="mt-3 text-[16px] font-semibold">{c.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink/75">{c.body}</p>
              </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="product" className="border-y border-line bg-surface scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">How it works</p>
            <h2 className="mt-2 text-[24px] sm:text-[30px] font-semibold tracking-tight text-balance max-w-2xl">
              Three steps from scattered drives to one company workspace.
            </h2>
            <ol className="mt-8 grid gap-3 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={Math.min(i, 2) * 90}>
                <li className="rounded-xl border border-line bg-canvas p-6 h-full">
                  <p className="font-brand text-[26px] font-semibold text-brand">{s.n}</p>
                  <h3 className="mt-2 text-[16.5px] font-semibold">{s.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink/75">{s.body}</p>
                </li>
                </Reveal>
              ))}
            </ol>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={(i % 3) * 80}>
                <div className="lift flex gap-3.5 rounded-xl border border-line bg-surface p-5 h-full">
                  <span className="size-10 shrink-0 grid place-items-center rounded-lg bg-tint text-brand"><f.icon size={19} /></span>
                  <div>
                    <h3 className="text-[15px] font-semibold">{f.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink/75">{f.body}</p>
                  </div>
                </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Security ── */}
        <section id="security" className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16 scroll-mt-20">
          <div className="rounded-2xl bg-ink text-white overflow-hidden">
            <div className="grid gap-8 lg:grid-cols-[1fr_1fr] p-7 sm:p-10">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-white/60">Security</p>
                <h2 className="mt-2 text-[24px] sm:text-[30px] font-semibold tracking-tight text-balance">
                  Built like infrastructure, not a file viewer.
                </h2>
                <p className="mt-3 text-[14.5px] leading-relaxed text-white/75 max-w-lg">
                  Every byte and every permission change passes server-side checks. Google Drive access
                  exists only to run the workspace operations you ask for — browsing, upload, move, share,
                  sync, and backup.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
                  <Link href="/privacy" className="min-h-[48px] px-5 inline-flex items-center justify-center rounded-lg bg-white text-ink text-[14.5px] font-medium hover:bg-white/90">
                    Read the Privacy Policy
                  </Link>
                  <Link href="/terms" className="min-h-[48px] px-5 inline-flex items-center justify-center rounded-lg border border-white/25 text-[14.5px] font-medium hover:bg-white/10">
                    Read the Terms
                  </Link>
                </div>
              </div>
              <ul className="space-y-3">
                {[
                  { icon: ShieldCheck, title: "Least-privilege access", body: "Roles, departments, and folder permissions are enforced on the server for every read and every write." },
                  { icon: ScrollText, title: "Audit everything", body: "Sign-ins, uploads, shares, renames, moves, restores, and admin changes land in the audit trail." },
                  { icon: HardDrive, title: "Your drives stay yours", body: "Files remain in your connected Google Drives; each record remembers its drive and account." },
                ].map((c, i) => (
                  <Reveal key={c.title} delay={Math.min(i, 2) * 90}>
                  <li className="flex gap-3.5 rounded-xl border border-white/15 bg-white/5 p-5">
                    <span className="size-10 shrink-0 grid place-items-center rounded-lg bg-white/10"><c.icon size={19} /></span>
                    <div>
                      <h3 className="text-[15px] font-semibold">{c.title}</h3>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-white/70">{c.body}</p>
                    </div>
                  </li>
                  </Reveal>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Access ── */}
        <section id="access" className="border-t border-line bg-surface scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-start">
            <Reveal>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Get access</p>
              <h2 className="mt-2 text-[24px] sm:text-[30px] font-semibold tracking-tight text-balance">
                Accounts are issued by your team, not sold at a checkout.
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink/75 max-w-lg">
                EIDEN-DRIVE is a company workspace. Tell us who you are and a manager reviews the request.
                Already onboard? Sign in and you land straight in your drive.
              </p>
              <ol className="mt-6 space-y-3">
                {["Request with your work email.", "A manager reviews and approves.", "You get an invite and sign in."].map((t, i) => (
                  <li key={t} className="flex items-center gap-3 text-[14.5px]">
                    <span className="size-8 shrink-0 grid place-items-center rounded-full bg-tint text-brand text-[13.5px] font-semibold">{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-[14px] text-muted">
                Existing member? <Link className="underline text-ink" href="/login">Sign in</Link>
              </p>
            </div>
            </Reveal>
            <Reveal delay={120}>
            <AccessForm />
            </Reveal>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16 scroll-mt-20">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">FAQ</p>
          <h2 className="mt-2 text-[24px] sm:text-[30px] font-semibold tracking-tight">Straight answers, before you ask.</h2>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {FAQS.map((f, i) => (
              <Reveal key={f.q} delay={Math.min(i, 4) * 60}>
              <details className="group py-1">
                <summary className="min-h-[56px] flex items-center justify-between gap-4 cursor-pointer list-none py-3 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="shrink-0 size-8 grid place-items-center rounded-full border border-line text-muted group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
                </summary>
                <p className="pb-5 pr-10 text-[14px] leading-relaxed text-ink/75">{f.a}</p>
              </details>
              </Reveal>
            ))}
          </div>
          <Reveal>
          <div className="mt-8 card lift p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <p className="text-[16.5px] font-semibold">Ready when your team is.</p>
              <p className="mt-1 text-[14px] text-muted">One request. A manager reviews it. You get to work.</p>
            </div>
            <Link href="#access" className="min-h-[52px] px-6 inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-white text-[15px] font-medium hover:brightness-110 shrink-0">
              Request access <ArrowRight size={17} />
            </Link>
          </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
