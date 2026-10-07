import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Poppins, Fredoka, Roboto } from "next/font/google";
import { ToastHost } from "@/components/ui/Toast";

const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-poppins", display: "swap" });
const fredoka = Fredoka({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-fredoka", display: "swap" });
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-roboto", display: "swap" });

export const metadata: Metadata = {
  title: "Eiden Drive",
  description: "Eiden Drive — your team's files in one place: Google Shared Drives and local storage, with audit and a secure vault.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "any" }],
    apple: "/icons/apple-touch-icon.png"
  }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Dashboard app: everything is per-user (auth cookies, Supabase RLS) — never prerender.
export const dynamic = "force-dynamic";

// Runs before paint: restore saved theme, register the offline service worker.
const BOOT = `try{var s=localStorage.getItem('eiden-sidebar');document.documentElement.setAttribute('data-sb',(s==='full'||s==='rail')?s:(innerWidth>=1280?'full':'rail'));}catch(e){}
try{var t=localStorage.getItem('eiden-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}
if('serviceWorker' in navigator){
  var h=location.hostname;
  if(h==='localhost'||h==='127.0.0.1'){
    // dev: never let a service worker mask code changes
    navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister();});});
    if(window.caches)caches.keys().then(function(k){k.forEach(function(n){caches.delete(n);});});
  }else{navigator.serviceWorker.register('/sw.js').catch(function(){});}
}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the boot script sets data-theme and browser extensions touch <html>/<body>.
    <html lang="en" className={`${poppins.variable} ${fredoka.variable} ${roboto.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: BOOT }} /></head>
      <body className="min-h-screen" suppressHydrationWarning>
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
