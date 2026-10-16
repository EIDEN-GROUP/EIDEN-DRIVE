"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, X } from "lucide-react";
import Logo from "../ui/Logo";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#security", label: "Security" },
  { href: "#access", label: "Access" },
  { href: "#faq", label: "FAQ" },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  // Section anchors only exist on the homepage — other public pages get a
  // Home link instead of dead anchors.
  const isHome = pathname === "/";
  const accessHref = isHome ? "#access" : "/#access";
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className={`fixed inset-x-0 top-0 z-40 transition-colors ${scrolled || open ? "bg-surface/95 backdrop-blur border-b border-line" : "bg-transparent border-b border-transparent"}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link href={isHome ? "#top" : "/"} className="flex items-center gap-2.5 min-h-[44px]" aria-label="EIDEN-DRIVE home">
          <Logo size={32} />
          <span className="font-brand leading-none">
            <span className="block text-[19px] font-bold tracking-tight text-brand">Eiden</span>
            <span className="block text-[11.5px] font-medium text-ink/70 tracking-wide">Drive</span>
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1" aria-label="Site">
          {isHome && LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="px-3 min-h-[44px] inline-flex items-center text-[14px] text-ink/80 hover:text-ink rounded-md">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-2">
          <Link href="/login" className="min-h-[44px] px-4 inline-flex items-center text-[14px] font-medium text-ink/80 hover:text-ink rounded-md">
            Sign in
          </Link>
          <Link href={accessHref} className="min-h-[44px] px-4 inline-flex items-center rounded-lg bg-brand text-white text-[14px] font-medium hover:brightness-110">
            Request access
          </Link>
        </div>
        <button className="md:hidden size-11 grid place-items-center rounded-md hover:bg-tint" onClick={() => setOpen((o) => !o)}
          aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"}>
          {open ? <X size={20} /> : <MenuIcon size={20} />}
        </button>
      </div>
      {open && (
        <nav className="md:hidden border-t border-line bg-surface px-4 py-3 flex flex-col" aria-label="Site mobile">
          {isHome && LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="min-h-[48px] inline-flex items-center text-[15px] text-ink/85 border-b border-line last:border-0">
              {l.label}
            </Link>
          ))}
          <div className="flex gap-2 py-3">
            <Link href="/login" onClick={() => setOpen(false)} className="flex-1 min-h-[48px] inline-flex items-center justify-center rounded-lg border border-line text-[15px] font-medium">
              Sign in
            </Link>
            <Link href={accessHref} onClick={() => setOpen(false)} className="flex-1 min-h-[48px] inline-flex items-center justify-center rounded-lg bg-brand text-white text-[15px] font-medium">
              Request access
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
