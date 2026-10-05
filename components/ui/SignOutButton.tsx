"use client";
import { browserClient } from "@/lib/supabase-client";
import { LogoutIcon } from "./icons";

export default function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await browserClient().auth.signOut();
        window.location.href = "/login";
      }}
      className="min-h-[44px] flex items-center gap-2 px-3 rounded-xl hover:bg-white/10 transition-colors text-sm w-full text-left"
      aria-label="Sign out">
      <LogoutIcon size={18} /> Sign out
    </button>
  );
}
