"use client";
import dynamic from "next/dynamic";

// The explorer is entirely client-driven (it fetches its own data). Skipping SSR avoids hydration mismatches
// caused by browser extensions touching its search field, and costs nothing visible.
const Explorer = dynamic(() => import("./Explorer"), {
  ssr: false,
  loading: () => <div className="h-full min-h-[520px] rounded-lg border border-line bg-surface" aria-busy="true" />
});

export default function ExplorerClient() {
  return <Explorer />;
}
