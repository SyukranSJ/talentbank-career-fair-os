import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requirePublicEnv } from "@/lib/env";

/**
 * Server client bound to the signed-in user's cookies.
 *
 * IMPORTANT: this uses the ANON key, not the service role key. That is
 * deliberate. Every admin mutation therefore runs as the logged-in user and is
 * still subject to Row Level Security — if a route handler ever forgets its
 * auth check, Postgres refuses the write anyway. Defence in depth.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = requirePublicEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by middleware, so this is safe to skip.
        }
      },
    },
  });
}
