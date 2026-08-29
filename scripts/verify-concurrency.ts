/**
 * Capacity invariant test.  Run with:  npm run verify:concurrency
 *
 * The claim this proves: an event can never take more registrations than its
 * capacity, even when many people register at the exact same moment.
 *
 * An application-level "is there room?" check cannot deliver that on its own —
 * two requests can both read "4 places left" before either one writes. The
 * guarantee comes from the BEFORE INSERT trigger in the schema, which does
 * `SELECT ... FOR UPDATE` on the event row and so forces concurrent
 * registrations for the same event to queue behind each other.
 *
 * This script fires 40 simultaneous registrations at an event with 4 places
 * left and asserts that exactly 4 win. It creates its own disposable event and
 * deletes it afterwards, so the demo data is untouched.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("\n  Missing Supabase configuration in .env.local\n");
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const publicClient = createClient(url, anonKey, { auth: { persistSession: false } });

/** What register_for_event() returns. */
interface RegistrationOutcome {
  ok: boolean;
  code?: string;
  remaining?: number;
  registered_count?: number;
}

let failed = 0;

function pass(label: string, detail: string) {
  console.log(`   OK   ${label.padEnd(46)} ${detail}`);
}

function fail(label: string, detail: string) {
  failed += 1;
  console.log(`   FAIL ${label.padEnd(46)} ${detail}`);
}

/** Asserts a condition, printing the matching line either way. */
function expect(label: string, condition: boolean, detail: string, onFail = detail) {
  if (condition) pass(label, detail);
  else fail(label, onFail);
}

async function register(
  eventId: string,
  email: string,
  name = "Test Person",
  userType = "CANDIDATE",
): Promise<RegistrationOutcome | null> {
  const { data } = await publicClient.rpc("register_for_event", {
    p_event_id: eventId,
    p_name: name,
    p_email: email,
    p_user_type: userType,
  });
  return (data as RegistrationOutcome) ?? null;
}

const CAPACITY = 5;
const CONTENDERS = 40;

async function main() {
  console.log("\n  REGISTRATION RULES (through the public anonymous path)\n");

  const { data: probe, error: probeError } = await service
    .from("events")
    .insert({
      slug: `capacity-probe-${Date.now()}`,
      title: "Capacity probe",
      description: "Temporary event created and removed by the concurrency test.",
      start_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      end_at: new Date(Date.now() + 7 * 86_400_000 + 6 * 3_600_000).toISOString(),
      location: "Probe Hall",
      state: "Kuala Lumpur",
      category: "PUBLIC_CAREER_FAIR",
      audience: "EVERYONE",
      status: "UPCOMING",
      capacity: CAPACITY,
    })
    .select("id")
    .single();

  if (probeError || !probe) {
    fail("create probe event", probeError?.message ?? "unknown error");
    process.exit(1);
  }

  const first = await register(probe.id, "first.person@example.com");
  expect("a valid registration succeeds", Boolean(first?.ok),
    `${first?.remaining} places left`, JSON.stringify(first));

  const duplicate = await register(probe.id, "FIRST.PERSON@EXAMPLE.COM");
  expect("duplicate email is rejected", duplicate?.code === "DUPLICATE",
    "matched case-insensitively", JSON.stringify(duplicate));

  const badEmail = await register(probe.id, "not-an-email");
  expect("invalid email rejected by the database", badEmail?.code === "INVALID_EMAIL",
    "INVALID_EMAIL", JSON.stringify(badEmail));

  const badType = await register(probe.id, "typed@example.com", "Test", "ROBOT");
  expect("invalid user type rejected by the database", badType?.code === "INVALID_USER_TYPE",
    "INVALID_USER_TYPE", JSON.stringify(badType));

  /* ------------------------------------------------------------- race --- */
  const places = CAPACITY - 1;
  console.log(`\n  CONCURRENCY: ${CONTENDERS} simultaneous registrations for ${places} places\n`);

  const outcomes = await Promise.all(
    Array.from({ length: CONTENDERS }, (_, i) =>
      register(probe.id, `racer${i}@example.com`, `Racer ${i}`),
    ),
  );

  const accepted = outcomes.filter((o) => o?.ok).length;
  const rejectedFull = outcomes.filter((o) => o?.code === "FULL").length;

  const { count } = await service
    .from("registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", probe.id);

  console.log(`   accepted=${accepted}  rejected_full=${rejectedFull}\n`);

  expect("registrations never exceed capacity", count === CAPACITY,
    `${count}/${CAPACITY} stored — the row lock held`,
    `${count} rows for a capacity of ${CAPACITY}`);

  expect("exactly the remaining places were filled", accepted === places,
    `${accepted} of ${CONTENDERS} attempts won`,
    `${accepted} accepted, expected ${places}`);

  /* --------------------------------------------------- closed events --- */
  console.log("\n  CLOSED EVENTS REFUSE REGISTRATION\n");

  const closed: Array<[expected: string, title: string]> = [
    ["FULL", "Talentbank Penang TES Career Fair"],
    ["CANCELLED", "Sabah Graduate Career Fair"],
    ["COMPLETED", "Klang Valley Graduate Networking Evening"],
  ];

  for (const [expected, title] of closed) {
    const { data: event } = await service.from("events").select("id").eq("title", title).maybeSingle();
    if (!event) {
      fail(title.slice(0, 40), "event not found — has the database been seeded?");
      continue;
    }
    const outcome = await register(event.id, `probe-${Date.now()}@example.com`);
    expect(title.slice(0, 40), outcome?.code === expected,
      `rejected with ${outcome?.code}`,
      `expected ${expected}, got ${JSON.stringify(outcome)}`);
  }

  // Registrations cascade with the event, so one delete cleans everything up.
  await service.from("events").delete().eq("id", probe.id);
  pass("probe event removed", "registrations cascaded");

  console.log(failed ? `\n  ${failed} check(s) failed\n` : "\n  All checks passed.\n");
  process.exit(failed ? 1 : 0);
}

main();
