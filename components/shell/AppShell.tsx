"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Pin, ChevronDown, Menu as MenuIcon, FolderClosed, Activity, ShieldCheck, KeyRound, Users, HardDrive,
  Moon, Sun, ChevronsRight, ChevronsLeft, Bell, CircleCheck, CalendarDays, Zap, LogOut, X
} from "lucide-react";
import Logo from "../ui/Logo";
import { browserClient } from "@/lib/supabase-client";

export interface ShellUser { username: string; role: string; dept: string | null }

const NAV = [
  { href: "/drive", label: "File Management", short: "Drive", icon: FolderClosed },
  { href: "/activity", label: "Activity", short: "Activity", icon: Activity },
  { href: "/security", label: "Security Center", short: "Security", icon: ShieldCheck },
  { href: "/vault", label: "Vault", short: "Vault", icon: KeyRound },
  { href: "/users", label: "Users & Departments", short: "Users", icon: Users },
  { href: "/storage", label: "Storage & Backups", short: "Storage", icon: HardDrive }
];

export default function AppShell({ user, children }: { user: ShellUser | null; children: ReactNode }) {
  const path = usePathname() ?? "/drive";
  const [drawer, setDrawer] = useState(false);       // mobile sidebar
  const [collapsed, setCollapsed] = useState(false); // desktop sidebar
  const [rail, setRail] = useState(true);
  const [dark, setDark] = useState(false);
  const [promo, setPromo] = useState(true);
  const [userMenu, setUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
      if (localStorage.getItem("eiden-promo") === "0") setPromo(false);
      if (localStorage.getItem("eiden-sidebar") === "0") setCollapsed(true);
    } catch { /* storage blocked */ }
  }, []);
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!userMenu) return;
    const d = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setUserMenu(false); };
    document.addEventListener("mousedown", d);
    return () => document.removeEventListener("mousedown", d);
  }, [userMenu]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try { localStorage.setItem("eiden-theme", next ? "dark" : "light"); } catch { /* ignore */ }
  }
  function toggleSidebar() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed((c) => { try { localStorage.setItem("eiden-sidebar", c ? "1" : "0"); } catch { /* ignore */ } return !c; });
    } else setDrawer((d) => !d);
  }
  async function signOut() {
    await browserClient().auth.signOut();
    window.location.href = "/login";
  }

  const current = NAV.find((n) => path === n.href || path.startsWith(n.href + "/"));
  const title = current?.label ?? "Eiden";
  const initial = (user?.username ?? "?").slice(0, 1).toLowerCase();

  return (
    <div className="h-screen flex bg-surface text-ink overflow-hidden">
      {/* ── Sidebar ── */}
      {drawer && <div className="lg:hidden fixed inset-0 z-30 bg-black/30" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside aria-label="Primary"
        className={`fixed lg:static z-40 inset-y-0 left-0 w-[248px] shrink-0 bg-surface flex flex-col transition-transform duration-200
          ${drawer ? "translate-x-0 shadow-pop" : "-translate-x-full"} ${collapsed ? "lg:hidden" : "lg:translate-x-0"}`}>
        <div className="h-[72px] px-5 flex items-center justify-between">
          <Link href="/drive" className="flex items-center gap-3">
            <Logo size={34} />
            <span className="font-brand text-[22px] font-semibold tracking-tight">Eiden</span>
          </Link>
          <button className="lg:hidden size-9 grid place-items-center rounded-md hover:bg-tint" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="mx-4 border-t border-line" />
        <div className="mx-4 mt-3 mb-1 h-11 px-3 flex items-center justify-between text-[15px] text-ink/90">
          <span className="flex items-center gap-3"><Pin size={18} className="text-muted" strokeWidth={1.6} /> Pinned</span>
          <ChevronDown size={17} className="text-brand" />
        </div>
        <div className="mx-4 border-t border-line" />
        <nav className="mt-2 px-4 flex flex-col gap-1 overflow-y-auto">
          {NAV.map((n) => {
            const on = current?.href === n.href;
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                className={`relative min-h-[44px] pl-3 pr-3 rounded-md flex items-center gap-3 text-[15px] transition-colors
                  ${on ? "bg-tint text-brand font-medium" : "text-ink/85 hover:bg-tint/60"}`}>
                {on && <span className="absolute -left-4 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-brand" />}
                <Icon size={19} strokeWidth={1.6} className={on ? "text-brand" : "text-muted"} />
                {n.short}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-4 pb-3">
          {promo && (
            <div className="mb-3 p-3 rounded-lg bg-soft border border-line">
              <div className="flex gap-3">
                <Zap size={22} className="text-brand shrink-0 mt-0.5" fill="currentColor" strokeWidth={0} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">Eiden v0.1.0</p>
                  <p className="text-[11px] text-muted leading-snug mt-0.5">Check storage, backups and agent health at a glance.</p>
                </div>
              </div>
              <div className="mt-2 flex justify-between text-[13px]">
                <button className="text-muted hover:text-ink px-1 min-h-[32px]" onClick={() => { setPromo(false); try { localStorage.setItem("eiden-promo", "0"); } catch { /* ignore */ } }}>Dismiss</button>
                <Link href="/storage" className="text-brand font-medium px-1 min-h-[32px] inline-flex items-center">Open</Link>
              </div>
            </div>
          )}
          <div className="border-t border-line pt-2">
            <button onClick={signOut} className="w-full min-h-[44px] px-3 rounded-md flex items-center gap-3 text-[15px] text-ink/85 hover:bg-tint/60">
              <LogOut size={19} strokeWidth={1.6} className="text-muted" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[72px] shrink-0 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={toggleSidebar} aria-label="Toggle sidebar" className="size-10 grid place-items-center rounded-md hover:bg-tint"><MenuIcon size={22} strokeWidth={1.6} /></button>
            <span className="hidden sm:block h-5 border-l border-line" />
            <h1 className="text-[16px] text-ink/90 truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            <div ref={menuRef} className="relative">
              <button onClick={() => setUserMenu((o) => !o)} aria-haspopup="menu" aria-expanded={userMenu} aria-label="Account menu"
                className="min-h-[44px] flex items-center gap-1 pl-1 pr-2 rounded-full hover:bg-tint">
                <span className="size-9 rounded-full bg-brand text-white grid place-items-center text-[15px] font-medium">{initial}</span>
                <ChevronDown size={17} className="text-ink/70" />
              </button>
              {userMenu && (
                <div role="menu" className="pop-in absolute right-0 mt-2 w-[230px] rounded-lg bg-surface border border-line shadow-pop py-2 z-50">
                  <div className="px-4 py-2 border-b border-line">
                    <p className="text-[14px] font-medium truncate">{user?.username ?? "Signed in"}</p>
                    <p className="text-[11px] text-muted capitalize">{user?.role ?? "member"}{user?.dept ? ` · ${user.dept}` : ""}</p>
                  </div>
                  <button role="menuitem" onClick={signOut} className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-tint flex items-center gap-2"><LogOut size={15} /> Sign out</button>
                </div>
              )}
            </div>
            <button onClick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} className="size-10 grid place-items-center rounded-md hover:bg-tint">
              {dark ? <Sun size={21} strokeWidth={1.6} /> : <Moon size={21} strokeWidth={1.6} />}
            </button>
            <button onClick={() => setRail((r) => !r)} aria-label={rail ? "Hide side rail" : "Show side rail"} className="hidden lg:grid size-10 place-items-center rounded-md hover:bg-tint">
              {rail ? <ChevronsRight size={21} strokeWidth={1.6} /> : <ChevronsLeft size={21} strokeWidth={1.6} />}
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 flex">
          <main className="flex-1 min-w-0 min-h-0 overflow-auto px-3 sm:px-4 pb-4">{children}</main>
          {rail && (
            <aside aria-label="Quick links" className="hidden lg:flex w-[56px] shrink-0 border-l border-line flex-col items-center gap-2 pt-4">
              <Link href="/activity" aria-label="Activity feed" className="size-10 grid place-items-center rounded-md hover:bg-tint text-[#22c32e]"><Bell size={20} strokeWidth={1.7} /></Link>
              <Link href="/security" aria-label="Security approvals" className="size-10 grid place-items-center rounded-md hover:bg-tint text-brand"><CircleCheck size={20} strokeWidth={1.7} /></Link>
              <Link href="/storage" aria-label="Backups schedule" className="size-10 grid place-items-center rounded-md hover:bg-tint text-muted"><CalendarDays size={20} strokeWidth={1.7} /></Link>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
