"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicEnv } from "@/lib/env";

/**
 * Browser client. Carries the anon key, which is public by design — every
 * table it can touch is behind Row Level Security. Used for admin sign-in
 * (so Supabase can set the session cookie) and nothing else.
 */
export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = requirePublicEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
