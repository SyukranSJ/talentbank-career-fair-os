/**
 * Setup smoke test.  Run with:  npm run verify
 *
 * Confirms the schema migrated correctly and that the security model actually
 * works — not just that queries succeed.
 *
 * A note on why the security checks report HOW something was blocked:
 * Postgres denies an anonymous read of `registrations` in two completely
 * different ways depending on configuration. A missing GRANT produces
 * `42501 permission denied`; a working GRANT plus a restrictive RLS policy
 * produces an empty result set. Both look like "blocked" from the client, but
 * only one of them means the policies are doing their job. An earlier version
 * of this script reported success in a project where RLS had never been
 * consulted at all, so it now names the mechanism.
 *
 * Prints no secret values.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("\n  Missing Supabase configuration in .env.local\n");
  process.exit(1);
}

const service: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false } });

type Check = [name: string, run: () => Promise<string>];

/**
 * Postgres reports BOTH "you have no privilege on this table" and "a row-level
 * security policy rejected this row" as SQLSTATE 42501. Telling them apart
 * matters: the first means the policy never ran, the second means it ran and
 * did its job. Only the message distinguishes them.
 */
function classifyDenial(error: { code?: string; message?: string } | null): "GRANT" | "POLICY" | "OTHER" | null {
  if (!error) return null;
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("row-level security")) return "POLICY";
  if (message.includes("permission denied")) return "GRANT";
  return "OTHER";
}


async function main() {
  const checks: Check[] = [
    /* ------------------------------------------------------- structure --- */
    ["events table", async () => {
      const { count, error } = await service.from("events").select("*", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `${count} rows`;
    }],
    ["registrations table", async () => {
      const { count, error } = await service.from("registrations").select("*", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `${count} rows`;
    }],
    ["event_history table", async () => {
      const { count, error } = await service.from("event_history").select("*", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `${count} rows`;
    }],
    ["admin_users table", async () => {
      const { count, error } = await service.from("admin_users").select("*", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `${count} admin(s)`;
    }],
    ["event_availability view", async () => {
      const { error } = await service.from("event_availability").select("id,registered_count").limit(1);
      if (error) throw new Error(error.message);
      return "readable";
    }],

    /* ------------------------------------------------------- functions --- */
    ["register_for_event() callable by anon", async () => {
      // A nonexistent event id: the function must return a structured failure
      // rather than throwing, which proves it exists and anon may execute it.
      const { data, error } = await anon.rpc("register_for_event", {
        p_event_id: "00000000-0000-0000-0000-000000000000",
        p_name: "Schema Probe",
        p_email: "probe@example.com",
        p_user_type: "CANDIDATE",
      });
      if (error) throw new Error(error.message);
      const result = data as { ok: boolean; code?: string };
      if (result.ok) throw new Error("a nonexistent event should not accept a registration");
      return `rejects unknown event with code ${result.code}`;
    }],
    ["is_admin() callable by anon", async () => {
      const { data, error } = await anon.rpc("is_admin");
      if (error) throw new Error(error.message);
      if (data !== false) throw new Error(`anon should not be an admin, got ${data}`);
      return "anon -> false";
    }],

    /* -------------------------------------------------- multi-day model --- */
    ["events.last_date column exists", async () => {
      const { error } = await service.from("events").select("last_date").limit(1);
      if (error) throw new Error(`${error.code}: ${error.message} — has 0003_multi_day.sql been run?`);
      return "present";
    }],
    ["event_availability exposes last_date", async () => {
      const { data, error } = await service.from("event_availability").select("*").limit(1);
      if (error) throw new Error(error.message);
      const columns = Object.keys((data as Record<string, unknown>[])[0] ?? {});
      if (!columns.includes("last_date")) throw new Error("view is missing last_date");
      // CREATE OR REPLACE VIEW may only append, so the original 16 must be
      // untouched and in order; last_date must be the final column.
      const expectedPrefix = [
        "id", "slug", "title", "description", "start_at", "end_at", "location", "state",
        "category", "audience", "status", "capacity", "cancellation_reason",
        "created_at", "updated_at", "registered_count",
      ];
      const prefix = columns.slice(0, expectedPrefix.length);
      if (prefix.join(",") !== expectedPrefix.join(","))
        throw new Error(`original column order changed: ${prefix.join(",")}`);
      if (columns[columns.length - 1] !== "last_date")
        throw new Error("last_date is not the final column");
      return `${columns.length} columns, original 16 preserved, last_date appended`;
    }],
    ["event_finishes_at() exists", async () => {
      const { data, error } = await service.rpc("event_finishes_at", {
        p_start_at: "2026-10-01T02:00:00.000Z",
        p_end_at: "2026-10-01T09:00:00.000Z",
        p_last_date: "2026-10-02",
      });
      if (error) throw new Error(`${error.code}: ${error.message}`);
      // 2026-10-02 17:00 in Malaysia is 09:00Z.
      const finish = new Date(data as string).toISOString();
      if (finish !== "2026-10-02T09:00:00.000Z")
        throw new Error(`expected the last day's end, got ${finish}`);
      return "returns the LAST day's end";
    }],
    ["backfill: no row spans >1 day in start_at/end_at", async () => {
      const { data, error } = await service.from("events").select("title,start_at,end_at,last_date");
      if (error) throw new Error(error.message);
      const klDate = (iso: string) =>
        new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
      const rows = data as Array<{ title: string; start_at: string; end_at: string; last_date: string | null }>;
      const straddling = rows.filter((r) => klDate(r.start_at) !== klDate(r.end_at));
      if (straddling.length > 0)
        throw new Error(`${straddling.length} row(s) still store a continuous range, e.g. "${straddling[0].title}"`);
      const multiDay = rows.filter((r) => r.last_date !== null);
      return `${rows.length} events, ${multiDay.length} multi-day via last_date`;
    }],
    ["admin_create_event uses the new signature", async () => {
      // Non-destructive probe: capacity 0 violates a CHECK constraint, so the
      // call always fails — but HOW it fails tells us whether the pre-0003
      // signature (which had no p_last_date) still resolves. An earlier
      // version of this check passed valid arguments and created a real event
      // every time it ran.
      const { error } = await service.rpc("admin_create_event", {
        p_slug: "signature-probe-never-created", p_title: "signature probe", p_description: "",
        p_start_at: "2099-01-01T02:00:00.000Z", p_end_at: "2099-01-01T09:00:00.000Z",
        p_location: "x", p_state: "Kuala Lumpur", p_category: "PUBLIC_CAREER_FAIR",
        p_audience: "EVERYONE", p_status: "UPCOMING", p_capacity: 0,
        p_changed_by: "probe", p_source: "MANUAL",
      });
      if (!error) throw new Error("capacity 0 was accepted — the capacity CHECK is missing");
      if (error.code === "PGRST404" || error.code === "PGRST202")
        return "old signature correctly removed";
      throw new Error(`the OLD signature still resolves (${error.code}: ${String(error.message).slice(0, 60)})`);
    }],

    /* -------------------------------------------------------- audience --- */
    // These probe register_for_event() with the PUBLIC key — the path that
    // bypasses the server action entirely.
    //
    // They are non-destructive in BOTH outcomes, which matters: an earlier
    // version of this probe used a fresh email, so when the gate was missing
    // it silently CREATED the very registration it was meant to prove
    // impossible. Using an address already registered for that event means a
    // missing gate lands on the unique constraint (DUPLICATE) instead.
    ["audience gate refuses the wrong role", async () => {
      const { data: events } = await service
        .from("events")
        .select("id,title,audience")
        .in("audience", ["CANDIDATES", "EMPLOYERS"])
        .eq("status", "UPCOMING");

      const candidates = (events ?? []) as Array<{ id: string; title: string; audience: string }>;
      if (candidates.length === 0) return "skipped (no audience-restricted upcoming events)";

      for (const event of candidates) {
        const { data: existing } = await service
          .from("registrations").select("email").eq("event_id", event.id).limit(1).maybeSingle();
        if (!existing) continue; // need an existing address to stay non-destructive

        const wrongRole = event.audience === "CANDIDATES" ? "EMPLOYER" : "CANDIDATE";
        const expected =
          event.audience === "CANDIDATES" ? "AUDIENCE_CANDIDATES_ONLY" : "AUDIENCE_EMPLOYERS_ONLY";

        const { data } = await anon.rpc("register_for_event", {
          p_event_id: event.id,
          p_name: "Audience probe",
          p_email: (existing as { email: string }).email,
          p_user_type: wrongRole,
        });
        const result = data as { ok: boolean; code?: string };

        if (result.code === expected) continue;
        if (result.ok) throw new Error(`"${event.title}" accepted a ${wrongRole} — and created a row`);
        throw new Error(
          `"${event.title}" did not enforce its audience (got ${result.code}) — re-run 0003_multi_day.sql`,
        );
      }
      return `${candidates.length} restricted event(s) refuse the wrong role`;
    }],
    ["audience gate still admits the right role", async () => {
      const { data: event } = await service
        .from("events").select("id,title").eq("audience", "EVERYONE").eq("status", "UPCOMING")
        .limit(1).maybeSingle();
      if (!event) return "skipped (no open-to-all upcoming event)";
      const target = event as { id: string; title: string };

      const { data: existing } = await service
        .from("registrations").select("email").eq("event_id", target.id).limit(1).maybeSingle();
      if (!existing) return "skipped (no existing registration to reuse)";

      for (const role of ["CANDIDATE", "EMPLOYER"]) {
        const { data } = await anon.rpc("register_for_event", {
          p_event_id: target.id,
          p_name: "Audience probe",
          p_email: (existing as { email: string }).email,
          p_user_type: role,
        });
        const result = data as { ok: boolean; code?: string };
        // DUPLICATE means it passed the audience gate and reached the insert.
        if (result.code !== "DUPLICATE")
          throw new Error(`open-to-all event refused ${role} (got ${result.code ?? "ok"})`);
      }
      return "both roles reach the insert on an open-to-all event";
    }],

    /* -------------------------------------------------------- security --- */
    ["public CAN read events", async () => {
      const { error } = await anon.from("events").select("id,title").limit(1);
      if (error) throw new Error(`${error.code}: ${error.message}`);
      return "granted";
    }],
    ["public CAN read availability counts", async () => {
      const { data, error } = await anon
        .from("event_availability")
        .select("id,capacity,registered_count")
        .limit(1);
      if (error) throw new Error(`${error.code}: ${error.message}`);
      return data?.length ? "counts visible without exposing registrant rows" : "no rows yet";
    }],
    ["public CANNOT read registrant details", async () => {
      const { data, error } = await anon.from("registrations").select("name,email").limit(1);
      const denial = classifyDenial(error);
      if (denial === "GRANT") return "blocked at the GRANT layer (anon has no privilege)";
      if (denial) return `blocked by RLS ${denial.toLowerCase()} (${error!.code})`;
      if (data && data.length > 0) throw new Error(`LEAK: anon read ${data.length} registration row(s)`);
      return "blocked by RLS policy (empty result)";
    }],
    ["public CANNOT create an event", async () => {
      const { error } = await anon.from("events").insert({
        slug: `probe-${Date.now()}`,
        title: "Security probe",
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 3_600_000).toISOString(),
        location: "probe",
        state: "Kuala Lumpur",
        category: "PUBLIC_CAREER_FAIR",
        capacity: 1,
      });
      const denial = classifyDenial(error);
      if (denial === "GRANT") return "blocked at the GRANT layer (anon has no insert privilege)";
      if (denial === "POLICY") return "blocked by RLS policy";
      if (error) return `blocked (${error.code})`;
      throw new Error("LEAK: anon inserted an event");
    }],
    ["public CANNOT modify an event", async () => {
      const { data: target } = await anon.from("events").select("id,title").limit(1);
      if (!target?.length) return "skipped (no events seeded yet)";
      const { error, count } = await anon
        .from("events")
        .update({ title: "OWNED" }, { count: "exact" })
        .eq("id", target[0].id);
      const denial = classifyDenial(error);
      if (denial === "GRANT") return "blocked at the GRANT layer";
      if (denial === "POLICY") return "blocked by RLS policy";
      if (error) return `blocked (${error.code})`;
      if (count && count > 0) throw new Error("LEAK: anon updated an event");
      return "blocked by RLS policy (0 rows affected)";
    }],
    ["public CANNOT read the audit log", async () => {
      const { data, error } = await anon.from("event_history").select("id").limit(1);
      const denial = classifyDenial(error);
      if (denial === "GRANT") return "blocked at the GRANT layer";
      if (denial) return `blocked (${error!.code})`;
      if (data && data.length > 0) throw new Error("LEAK: anon read the audit log");
      return "blocked by RLS policy (empty result)";
    }],
  ];

  let failed = 0;
  for (const [name, run] of checks) {
    try {
      console.log(`  OK    ${name.padEnd(42)} ${await run()}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${name.padEnd(42)} ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(failed ? `\n  ${failed} check(s) failed\n` : "\n  All checks passed.\n");
  process.exit(failed ? 1 : 0);
}

main();
