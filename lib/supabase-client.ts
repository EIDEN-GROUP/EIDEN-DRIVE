"use client";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export function browserClient() {
  return createClientComponentClient();
}
