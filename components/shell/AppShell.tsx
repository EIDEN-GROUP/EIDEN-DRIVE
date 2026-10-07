"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown, Menu as MenuIcon, FolderClosed, Activity, ShieldCheck, KeyRound, Users, HardDrive,
  Moon, Sun, ChevronsRight, ChevronsLeft, Bell, CircleCheck, CalendarDays, LogOut, X
} from "lucide-react";
import Logo from "../ui/Logo";
import NotificationsPanel from "../notifications/NotificationsPanel";
import ProfileModal from "../profile/ProfileModal";
import { browserClient } from "@/lib/supabase-client";
import { formatBytes } from "@/lib/files";

export interface ShellUser { username: string; role: string; dept: string | null }

const NAV = [
  { href: "/drive", label: "File Management", short: "Drive", icon: FolderClosed },
  { href: "/activity", label: "Activity", short: "Activity", icon: Activity },
  { href: "/security", label: "Security Center", short: "Security", icon: ShieldCheck },
  { href: "/vault", label: "Vault", short: "Vault", icon: KeyRound },
  { href: "/users", label: "Users & Departments", short: "Users", icon: Users },
  { href: "/calendar", label: "Calendar & Plans", short: "Calendar", icon: CalendarDays },
  { href: "/storage", label: "Storage & Backups", short: "Storage", icon: HardDrive }
];

export default function AppShell({ user, children }: { user: ShellUser | null; children: ReactNode }) {
  const path = usePathname() ?? "/drive";
  const [drawer, setDrawer] = useState(false);              // phone: overlay drawer (< 768 px)
  const [mode, setMode] = useState<"full" | "rail">("full"); // tablet/desktop: full ⇄ icon rail
  const [rail, setRail] = useState(true);
  const [dark, setDark] = useState(false);
  const [promo, setPromo] = useState(true);
  const [health, setHealth] = useState<{ used: number; total: number; drives: number; agentOnline: boolean } | null>(null);
  const [userMenu, setUserMenu] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  async function refreshUnread() {
    try {
      const r = await fetch("/api/notifications");
      const d = await r.json().catch(() => ({}));
      if (typeof d.unread === "number") setUnread(d.unread);
    } catch { /* offline — badge stays */ }
  }
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 60000);
    return () => clearInterval(t);
  }, []);

  // Live storage + agent status for the sidebar card (same endpoint as the Storage page; null = nothing connected).
  useEffect(() => {
    let dead = false;
    const run = async () => {
      try {
        const r = await fetch("/api/storage");
        if (!r.ok) return;
        const d = await r.json();
        const act = ((d.drives ?? []) as { status: string; used: number; total: number }[]).filter((x) => x.status === "active");
        if (!dead) setHealth(act.length ? { used: act.reduce((a, x) => a + (x.used || 0), 0), total: act.reduce((a, x) => a + (x.total || 0), 0), drives: act.length, agentOnline: !!d.agent?.online } : null);
      } catch { /* offline — card hides */ }
    };
    run();
    const t = setInterval(run, 300_000);
    return () => { dead = true; clearInterval(t); };
  }, []);
  useEffect(() => {
    try {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
      if (localStorage.getItem("eiden-promo") === "0") setPromo(false);
    } catch { /* storage blocked */ }
    // The boot script in app/layout.tsx already set <html data-sb> before first paint (no flash);
    // mirror it into React state so the toggle and tooltips know the current mode.
    setMode(document.documentElement.getAttribute("data-sb") === "rail" ? "rail" : "full");
    // Crossing into tablet/desktop width closes the phone drawer.
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => { if (mq.matches) setDrawer(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [drawer]);
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
    if (window.matchMedia("(min-width: 768px)").matches) {
      const next = mode === "rail" ? "full" : "rail";
      document.documentElement.setAttribute("data-sb", next); // CSS does the animation
      try { localStorage.setItem("eiden-sidebar", next); } catch { /* ignore */ }
      setMode(next);
    } else setDrawer((d) => !d);
  }
  async function signOut() {
    await browserClient().auth.signOut();
    window.location.href = "/login";
  }

  const current = NAV.find((n) => path === n.href || path.startsWith(n.href + "/"));
  const title = current?.label ?? "Eiden Drive";
  const initial = (user?.username ?? "?").slice(0, 1).toLowerCase();

  return (
    <div className="h-screen flex bg-surface text-ink overflow-hidden">
      {/* ── Sidebar ── */}
      {drawer && <div className="md:hidden fixed inset-0 z-30 bg-black/30" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside aria-label="Primary" role={drawer ? "dialog" : undefined} aria-modal={drawer ? true : undefined}
        className={`sb fixed md:static z-40 inset-y-0 left-0 shrink-0 bg-surface flex flex-col overflow-hidden
          ${drawer ? "translate-x-0 shadow-pop" : "-translate-x-full md:translate-x-0"}`}>
        <div className="sb-head h-[72px] px-5 flex items-center justify-between">
          <Link href="/drive" className="flex items-center gap-3 min-w-0" aria-label="Eiden Drive — home">
            <Logo size={38} />
            <span className="sb-full font-brand leading-none whitespace-nowrap">
              <span className="block text-[22px] font-bold tracking-tight text-brand">Eiden</span>
              <span className="block text-[13.5px] font-medium text-ink/70 mt-1 tracking-wide">Drive</span>
            </span>
          </Link>
          <button className="md:hidden size-11 grid place-items-center rounded-md hover:bg-tint" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="sb-divider mx-4 border-t border-line" />
        <nav className="sb-nav mt-2 px-4 flex flex-col gap-1 overflow-y-auto overflow-x-hidden" aria-label="Sections">
          {NAV.map((n) => {
            const on = current?.href === n.href;
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} title={mode === "rail" ? n.label : undefined}
                className={`sb-item relative min-h-[44px] pl-3 pr-3 rounded-md flex items-center gap-3 text-[15px] transition-colors
                  ${on ? "bg-tint text-brand font-medium" : "text-ink/85 hover:bg-tint/60"}`}>
                {on && <span className="sb-bar absolute -left-4 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-brand" />}
                <Icon size={19} strokeWidth={1.6} className={`shrink-0 ${on ? "text-brand" : "text-muted"}`} />
                <span className="sb-text whitespace-nowrap">{n.short}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sb-foot mt-auto px-4 pb-3">
          {promo && health && (
            <div className="sb-full mb-3 p-3 rounded-lg bg-soft border border-line">
              <div className="flex items-center gap-2">
                <HardDrive size={16} className="text-brand shrink-0" />
                <p className="text-[13px] font-medium flex-1">Storage</p>
                <span className={`inline-flex items-center gap-1 text-[11px] ${health.agentOnline ? "text-[#15902a]" : "text-muted"}`} title={health.agentOnline ? "Local agent is online" : "Local agent is offline"}>
                  <span className={`size-1.5 rounded-full ${health.agentOnline ? "bg-[#22c32e]" : "bg-muted/50"}`} />agent
                </span>
              </div>
              {health.total > 0 ? (() => {
                const pct = Math.min(100, Math.round((health.used / health.total) * 100));
                return (
                  <>
                    <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden" role="img" aria-label={`${pct}% of storage used`}>
                      <div className={`h-full rounded-full ${pct >= 95 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted tabular-nums">{formatBytes(health.used)} of {formatBytes(health.total)} · {health.drives} drive{health.drives === 1 ? "" : "s"}</p>
                  </>
                );
              })() : <p className="mt-1.5 text-[11px] text-muted">{health.drives} drive{health.drives === 1 ? "" : "s"} connected</p>}
              <div className="mt-1.5 flex justify-between text-[13px]">
                <button className="text-muted hover:text-ink px-2 min-h-[44px]" onClick={() => { setPromo(false); try { localStorage.setItem("eiden-promo", "0"); } catch { /* ignore */ } }}>Hide</button>
                <Link href="/storage" className="text-brand font-medium px-2 min-h-[44px] inline-flex items-center">Details</Link>
              </div>
            </div>
          )}
          <div className="border-t border-line pt-2">
            <button onClick={signOut} title={mode === "rail" ? "Sign out" : undefined}
              className="sb-item w-full min-h-[44px] px-3 rounded-md flex items-center gap-3 text-[15px] text-ink/85 hover:bg-tint/60">
              <LogOut size={19} strokeWidth={1.6} className="text-muted shrink-0" /> <span className="sb-text whitespace-nowrap">Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[72px] shrink-0 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={toggleSidebar} aria-label={mode === "rail" ? "Expand sidebar" : "Collapse sidebar"} className="size-11 grid place-items-center rounded-md hover:bg-tint"><MenuIcon size={22} strokeWidth={1.6} /></button>
            <span className="hidden sm:block h-5 border-l border-line" />
            <h1 className="text-[16px] text-ink/90 truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            <button onClick={() => setNotifOpen(true)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              className="lg:hidden relative size-11 grid place-items-center rounded-md hover:bg-tint text-[#22c32e]">
              <Bell size={21} strokeWidth={1.6} />
              {unread > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold grid place-items-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            <div ref={menuRef} className="relative">
              <button onClick={() => { setProfileOpen(true); setUserMenu(false); }} aria-haspopup="dialog" aria-label="Open your profile"
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
                  <Link role="menuitem" href="/account/password" className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-tint flex items-center gap-2"><KeyRound size={15} /> Set password</Link>
                </div>
              )}
            </div>
            <button onClick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} className="size-11 grid place-items-center rounded-md hover:bg-tint">
              {dark ? <Sun size={21} strokeWidth={1.6} /> : <Moon size={21} strokeWidth={1.6} />}
            </button>
            <button onClick={() => setRail((r) => !r)} aria-label={rail ? "Hide side rail" : "Show side rail"} className="hidden lg:grid size-11 place-items-center rounded-md hover:bg-tint">
              {rail ? <ChevronsRight size={21} strokeWidth={1.6} /> : <ChevronsLeft size={21} strokeWidth={1.6} />}
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 flex">
          <main className="flex-1 min-w-0 min-h-0 overflow-auto px-3 sm:px-4 pb-4">{children}</main>
          {rail && (
            <aside aria-label="Quick links" className="hidden lg:flex w-[56px] shrink-0 border-l border-line flex-col items-center gap-2 pt-4">
              <button onClick={() => setNotifOpen(true)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                className="relative size-11 grid place-items-center rounded-md hover:bg-tint text-[#22c32e]">
                <Bell size={20} strokeWidth={1.7} />
                {unread > 0 && (
                  <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold grid place-items-center">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              <Link href="/security" aria-label="Security approvals" className="size-11 grid place-items-center rounded-md hover:bg-tint text-brand"><CircleCheck size={20} strokeWidth={1.7} /></Link>
              <Link href="/calendar" aria-label="Calendar" className="size-11 grid place-items-center rounded-md hover:bg-tint text-muted"><CalendarDays size={20} strokeWidth={1.7} /></Link>
            </aside>
          )}
        </div>
      </div>
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} onSeen={() => setUnread(0)} />
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
