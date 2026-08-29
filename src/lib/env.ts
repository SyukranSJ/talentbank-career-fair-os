/**
 * Environment access, in one place, with loud failures.
 *
 * Reading `process.env.X` inline all over the codebase is how a missing key
 * turns into a blank page at 2am. Every variable is read here once, and the
 * server-only ones are guarded so they can never be imported into a client
 * component by accident.
 */

/** Values that are safe in the browser. The anon key is protected by RLS. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

export function requirePublicEnv() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return publicEnv as { supabaseUrl: string; supabaseAnonKey: string };
}

/** The Gemini key. Returns null rather than throwing, so the admin UI can
 *  render a clear "Copilot is not configured" state instead of a crash. */
export function getGeminiKey(): string | null {
  if (typeof window !== "undefined") {
    throw new Error("getGeminiKey() must never run in the browser.");
  }
  // GOOGLE_API_KEY is the name the Google SDK picks up by default, so both are
  // accepted and neither is required to be set twice.
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

/**
 * Gemini 3.5 Flash-Lite is the default, chosen by measuring BOTH speed and
 * free-tier quota against this workload. Quota turned out to matter more:
 *
 *   model                    latency   free-tier daily requests
 *   gemini-3.5-flash-lite    ~3.4s     high        <- default
 *   gemini-3.5-flash         ~4.0s     20 per day  <- exhausted in one session
 *   gemini-3.6-flash         ~12s      -
 *   gemini-3.7-flash         80-105s then 503 "high demand"
 *   gemini-2.5-flash         404 - withdrawn for new API keys
 *
 * The 20-per-day cap on gemini-3.5-flash is the deciding factor. It is not a
 * rate limit you wait out; it is a hard daily ceiling
 * (GenerateRequestsPerDayPerProjectPerModel-FreeTier), and a demo that stops
 * working after twenty questions is not a demo. Quotas are per model, so
 * switching models is also the fastest recovery if one runs dry.
 *
 * Flash-Lite still reasons well enough for this task: it compares a request
 * against a table of intervals, which is a small structured problem, not an
 * open-ended one.
 */
export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
}

export function getGeminiThinkingLevel(): "LOW" | "MEDIUM" | "HIGH" | null {
  const configured = (process.env.GEMINI_THINKING_LEVEL || "LOW").toUpperCase();
  if (configured === "OFF" || configured === "NONE") return null;
  if (configured === "MEDIUM" || configured === "HIGH") return configured;
  return "LOW";
}

/** Service role key. Bypasses RLS — only the local seed script may use it. */
export function requireServiceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("The service role key must never be read in the browser.");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing. It is required only for `npm run seed`.",
    );
  }
  return key;
}
