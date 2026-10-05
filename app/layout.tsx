import "./globals.css";
import type { Metadata, Viewport } from "next";
import Logo from "@/components/ui/Logo";
import SignOutButton from "@/components/ui/SignOutButton";
import { ToastHost } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Eiden-Drive — Eiden Group FileOS",
  description: "Unified Google Shared Drives + Router-USB dashboard with audit, vault, and AI MCP.",
  manifest: "/manifest.json",
  icons: { icon: "/logo.png" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

// Dashboard app: everything is per-user (auth cookies, Supabase RLS) — never prerender.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}` }} />
        <div className="app-shell min-h-screen md:grid md:grid-cols-[260px_1fr]">
          <aside className="hidden md:block p-5 border-r border-[var(--e-line)]">
            <div className="flex items-center gap-2 font-extrabold tracking-widest text-sm">
              <Logo />
              EIDEN-DRIVE
            </div>
            <nav className="mt-6 flex flex-col gap-1 text-sm" aria-label="Primary">
              {[["Drive","/drive"],["Activity","/activity"],["Security","/security"],["Vault","/vault"],["Users","/users"],["Storage","/storage"]].map(([label, href]) => (
                <a key={href} href={href} className="min-h-[44px] flex items-center px-3 rounded-xl hover:bg-white/10 transition-colors duration-200">{label}</a>
              ))}
              <div className="mt-4 pt-4 border-t border-[var(--e-line)]"><SignOutButton /></div>
            </nav>
          </aside>
          <main className="p-4 md:p-6 max-w-[1440px] w-full mx-auto pb-20 md:pb-6">{children}</main>
          <ToastHost />
          <nav className="md:hidden fixed bottom-0 inset-x-0 app-shell flex justify-around py-2 border-t border-[var(--e-line)]" aria-label="Mobile">
            {["Drive","Search","Add","Activity","Profile"].map((i) => (
              <a key={i} href="/drive" className="min-w-[44px] min-h-[44px] grid place-items-center text-xs">{i}</a>
            ))}
          </nav>
        </div>
      </body>
    </html>
  );
}
