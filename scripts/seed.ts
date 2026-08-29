/**
 * Demo data loader.  Run with:  npm run seed
 *
 * Uses the SERVICE ROLE key, which bypasses Row Level Security. That is
 * appropriate here and nowhere else: this is a local developer script, it is
 * never imported by the app, and the key has no NEXT_PUBLIC_ prefix so Next.js
 * cannot bundle it into the browser.
 *
 * A NOTE ON THE TWO-PHASE INSERT
 * The `registrations` table has a BEFORE INSERT trigger that refuses rows for
 * events that are cancelled, completed, or full. That is exactly what we want
 * in production — and it also means we cannot simply insert 300 registrations
 * against an event that is already marked CANCELLED.
 *
 * Rather than weaken the trigger with a "seeding" backdoor, the seeder replays
 * what really happened: it creates the event as it originally was (open, in the
 * future), adds the registrations people made while it was open, and only then
 * applies the change that closed it. The invariant is never bypassed.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fromKL } from "../src/lib/domain/time";
import { slugify } from "../src/lib/domain/rules";
import { allowedUserTypes } from "../src/lib/domain/availability";
import type {
  EventAudience,
  EventCategory,
  EventStatus,
  UserType,
} from "../src/lib/domain/types";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "\n  Missing configuration.\n" +
      "  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n" +
      "  (Supabase dashboard -> Project Settings -> API)\n",
  );
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/* ------------------------------------------------------------------ data --- */

interface Spec {
  title: string;
  description: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  location: string;
  state: string;
  category: EventCategory;
  audience: EventAudience;
  capacity: number;
  status: EventStatus;
  cancellationReason?: string;
  /** How many demo registrations to create. */
  registrations: number;
}

/**
 * Demonstration data. Names and venues are realistic for Malaysia and follow
 * Talentbank's real event taxonomy (university campus fair / sector-focused
 * fair / public career fair), but THESE ARE NOT REAL TALENTBANK EVENTS.
 *
 * The set is chosen to exercise every code path in the product:
 *   · past events, including one nobody remembered to close  (auto-COMPLETED)
 *   · two-day fairs                                          (multi-day cells)
 *   · two events on one day in the same state                (MEDIUM conflict)
 *   · two events on one day in different states              (LOW conflict)
 *   · overlapping hours at the same venue                    (HIGH conflict)
 *   · one event at capacity                                  (FULL)
 *   · one cancelled event that already had registrations     (CANCELLED)
 *   · one event nearly full                                  (urgency state)
 *   · events outside normal hours                            (rule warning)
 */
const SPECS: Spec[] = [
  // ---------------------------------------------------------------- past ---
  {
    title: "Penang Engineering & Semiconductor Career Fair",
    description:
      "A sector-focused fair for engineering and semiconductor employers across the northern region.\nOver 60 exhibitors from manufacturing, test and assembly, and design services.",
    date: "2026-07-09",
    startTime: "10:00",
    endTime: "17:00",
    location: "SPICE Arena",
    state: "Penang",
    category: "SECTOR_FOCUSED_FAIR",
    audience: "EVERYONE",
    capacity: 900,
    status: "COMPLETED",
    registrations: 812,
  },
  {
    title: "Universiti Malaya Campus Career Fair",
    description:
      "On-campus recruitment for final-year students and recent graduates, hosted with the UM Careers Centre.",
    date: "2026-08-05",
    startTime: "09:00",
    endTime: "16:00",
    location: "Dewan Tunku Canselor, Universiti Malaya",
    state: "Kuala Lumpur",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 600,
    status: "COMPLETED",
    registrations: 574,
  },
  {
    title: "Klang Valley Graduate Networking Evening",
    description:
      "An informal evening connecting recent graduates with hiring managers from twelve employers.",
    date: "2026-08-19",
    startTime: "18:00",
    endTime: "21:00",
    location: "Menara Kembar Bank Rakyat",
    state: "Kuala Lumpur",
    category: "NETWORKING",
    audience: "EVERYONE",
    capacity: 150,
    // Deliberately left as UPCOMING even though the date has passed, to show
    // that the public calendar derives COMPLETED from the end time rather than
    // relying on someone remembering to change it.
    status: "UPCOMING",
    registrations: 143,
  },

  // ----------------------------------------------------------- september ---
  {
    title: "Talentbank BAFI Career Fair",
    description:
      "Banking, accounting, finance and insurance employers under one roof.\nBring copies of your CV — many exhibitors interview on the day.",
    date: "2026-09-12",
    startTime: "10:00",
    endTime: "17:00",
    location: "Kuala Lumpur Convention Centre",
    state: "Kuala Lumpur",
    category: "SECTOR_FOCUSED_FAIR",
    audience: "EVERYONE",
    capacity: 800,
    status: "UPCOMING",
    registrations: 517,
  },
  {
    title: "KL AI & Data Career Fair",
    description:
      "Malaysia's largest gathering of AI, data and machine-learning employers.\nExpect roles across data engineering, analytics, MLOps and applied research, from graduate level upwards.",
    date: "2026-09-18",
    startTime: "10:00",
    endTime: "17:00",
    location: "Kuala Lumpur Convention Centre",
    state: "Kuala Lumpur",
    category: "SECTOR_FOCUSED_FAIR",
    audience: "EVERYONE",
    capacity: 500,
    status: "UPCOMING",
    registrations: 470, // nearly full — shows the urgency state
  },
  {
    title: "Employer Roundtable: Hiring Gen Z",
    description:
      "A closed-door session for talent acquisition leads on attracting and retaining early-career talent.",
    date: "2026-09-18",
    startTime: "14:00",
    endTime: "17:00",
    location: "Menara Talentbank, Bangsar South",
    state: "Kuala Lumpur",
    category: "NETWORKING",
    audience: "EMPLOYERS",
    capacity: 60,
    status: "UPCOMING",
    registrations: 41,
  },
  {
    title: "Unitar International University Career Fair",
    description: "Campus fair for Unitar students across business, IT and hospitality programmes.",
    date: "2026-09-23",
    startTime: "09:00",
    endTime: "16:00",
    location: "Unitar International University, Petaling Jaya",
    state: "Selangor",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 400,
    status: "UPCOMING",
    registrations: 188,
  },
  {
    title: "Selangor Manufacturing Careers Day",
    description:
      "Manufacturing, logistics and supply-chain employers from the Selangor industrial corridor.",
    date: "2026-09-24",
    startTime: "15:00",
    endTime: "18:00",
    location: "Setia City Convention Centre",
    state: "Selangor",
    category: "SECTOR_FOCUSED_FAIR",
    audience: "EVERYONE",
    capacity: 350,
    status: "UPCOMING",
    registrations: 96,
  },
  {
    title: "Penang Tech Talent Fair",
    description: "Software, cloud and cybersecurity employers based in the northern corridor.",
    date: "2026-09-24",
    startTime: "10:00",
    endTime: "17:00",
    location: "SPICE Arena",
    state: "Penang",
    category: "SECTOR_FOCUSED_FAIR",
    audience: "EVERYONE",
    capacity: 450,
    status: "UPCOMING",
    registrations: 203,
  },

  // ------------------------------------------------------------- october ---
  {
    title: "Talentbank Tech Career Fair",
    description:
      "Two full days of technology hiring across software, data, product and infrastructure.\nDay one focuses on graduate roles, day two on experienced hires.",
    date: "2026-10-03",
    endDate: "2026-10-04",
    startTime: "10:00",
    endTime: "18:00",
    location: "Mid Valley Exhibition Centre",
    state: "Kuala Lumpur",
    category: "SECTOR_FOCUSED_FAIR",
    audience: "EVERYONE",
    capacity: 1200,
    status: "UPCOMING",
    registrations: 604,
  },
  {
    title: "Talentbank Johor Career Fair",
    description:
      "The southern region's largest public career fair, running across two days in Johor Bahru.",
    date: "2026-10-03",
    endDate: "2026-10-04",
    startTime: "10:00",
    endTime: "18:00",
    location: "Persada Johor International Convention Centre",
    state: "Johor",
    category: "PUBLIC_CAREER_FAIR",
    audience: "EVERYONE",
    capacity: 1500,
    status: "UPCOMING",
    registrations: 721,
  },
  {
    title: "Heriot-Watt University Malaysia Career Fair",
    description: "Campus fair for engineering, business and computer science students.",
    date: "2026-10-07",
    startTime: "10:00",
    endTime: "16:00",
    location: "Heriot-Watt University Malaysia, Putrajaya",
    state: "Putrajaya",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 350,
    status: "UPCOMING",
    registrations: 122,
  },
  {
    title: "Universiti Sains Islam Malaysia Career Fair",
    description: "Campus recruitment for USIM final-year students across all faculties.",
    date: "2026-10-14",
    startTime: "09:00",
    endTime: "16:00",
    location: "Universiti Sains Islam Malaysia, Nilai",
    state: "Negeri Sembilan",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 500,
    status: "UPCOMING",
    registrations: 214,
  },
  {
    title: "CV Clinic & Mentoring Evening",
    description:
      "Small-group mentoring with practising hiring managers. Bring a draft CV and one job description you are targeting.",
    date: "2026-10-15",
    startTime: "19:00",
    endTime: "21:30",
    location: "Online (Zoom)",
    state: "Kuala Lumpur",
    category: "MENTORING",
    audience: "CANDIDATES",
    capacity: 80,
    status: "UPCOMING",
    registrations: 63,
  },
  {
    title: "Universiti Tun Hussein Onn Career Fair",
    description: "Two-day campus fair covering engineering, technology and vocational programmes.",
    date: "2026-10-20",
    endDate: "2026-10-21",
    startTime: "09:00",
    endTime: "16:00",
    location: "Universiti Tun Hussein Onn Malaysia, Batu Pahat",
    state: "Johor",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 700,
    status: "UPCOMING",
    registrations: 288,
  },
  {
    title: "INTI Nilai Graduate Employability Fair",
    description: "Employer showcase for INTI Nilai students, with on-the-spot interview slots.",
    date: "2026-10-21",
    startTime: "10:00",
    endTime: "16:00",
    location: "INTI International University, Nilai",
    state: "Negeri Sembilan",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 300,
    status: "UPCOMING",
    registrations: 97,
  },
  {
    title: "Sunway University Get Hired Career Fair",
    description:
      "Two days of hiring across business, computing, hospitality and the creative industries.",
    date: "2026-10-27",
    endDate: "2026-10-28",
    startTime: "10:00",
    endTime: "17:00",
    location: "Sunway University, Bandar Sunway",
    state: "Selangor",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "EVERYONE",
    capacity: 1000,
    status: "UPCOMING",
    registrations: 342,
  },

  // ------------------------------------------------------------ november ---
  {
    title: "Universiti Putra Malaysia Career Fair",
    description: "Two-day campus fair covering agriculture, science, engineering and business.",
    date: "2026-11-11",
    endDate: "2026-11-12",
    startTime: "09:00",
    endTime: "16:30",
    location: "Universiti Putra Malaysia, Serdang",
    state: "Selangor",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 900,
    status: "UPCOMING",
    registrations: 265,
  },
  {
    title: "Graduates' Choice Award Night",
    description:
      "The annual recognition evening for Malaysia's most preferred graduate employers. Invitation and registration required.",
    date: "2026-11-13",
    startTime: "19:00",
    endTime: "22:30",
    location: "Grand Hyatt Kuala Lumpur",
    state: "Kuala Lumpur",
    category: "NETWORKING",
    audience: "EMPLOYERS",
    capacity: 400,
    status: "UPCOMING",
    registrations: 231,
  },
  {
    title: "Taylor's University Career Fair",
    description: "Campus fair with a strong hospitality, design and business employer mix.",
    date: "2026-11-18",
    startTime: "10:00",
    endTime: "16:00",
    location: "Taylor's University, Subang Jaya",
    state: "Selangor",
    category: "UNIVERSITY_CAMPUS_FAIR",
    audience: "CANDIDATES",
    capacity: 650,
    status: "UPCOMING",
    registrations: 180,
  },
  {
    title: "Talentbank Penang TES Career Fair",
    description:
      "Technology, engineering and semiconductor employers across the northern corridor. This event has reached capacity.",
    date: "2026-11-21",
    startTime: "10:00",
    endTime: "17:00",
    location: "Setia SPICE Convention Centre",
    state: "Penang",
    category: "SECTOR_FOCUSED_FAIR",
    audience: "EVERYONE",
    capacity: 300,
    status: "FULL",
    registrations: 300, // exactly at capacity
  },

  // ------------------------------------------------------------ december ---
  {
    title: "Year-End Virtual Career Fair",
    description:
      "A fully online fair for candidates who cannot travel, with live employer video booths.",
    date: "2026-12-03",
    startTime: "10:00",
    endTime: "16:00",
    location: "Online (Talentbank Virtual Hall)",
    state: "Kuala Lumpur",
    category: "PUBLIC_CAREER_FAIR",
    audience: "EVERYONE",
    capacity: 2000,
    status: "UPCOMING",
    registrations: 388,
  },
  {
    title: "Sabah Graduate Career Fair",
    description:
      "East Malaysia's regional career fair for graduates across all disciplines.",
    date: "2026-12-10",
    startTime: "10:00",
    endTime: "17:00",
    location: "Sabah International Convention Centre, Kota Kinabalu",
    state: "Sabah",
    category: "PUBLIC_CAREER_FAIR",
    audience: "EVERYONE",
    capacity: 400,
    status: "CANCELLED",
    cancellationReason:
      "Cancelled due to venue flooding. A replacement date in March 2027 will be announced, and everyone who registered has been contacted directly.",
    registrations: 137, // registrations existed BEFORE it was cancelled
  },

  // ---------------------------------------------------------------- 2027 ---
  {
    title: "Sarawak Digital Economy Careers Day",
    description: "Digital economy and shared-services employers across Kuching and Samarahan.",
    date: "2027-02-18",
    startTime: "10:00",
    endTime: "17:00",
    location: "Borneo Convention Centre Kuching",
    state: "Sarawak",
    category: "PUBLIC_CAREER_FAIR",
    audience: "EVERYONE",
    capacity: 350,
    status: "UPCOMING",
    registrations: 42,
  },
  {
    title: "Talentbank Career Fair 2027",
    description:
      "The flagship two-day public career fair, bringing together employers from every major sector.\nFree to attend for all candidates.",
    date: "2027-04-03",
    endDate: "2027-04-04",
    startTime: "10:00",
    endTime: "18:00",
    location: "Sunway Pyramid Convention Centre",
    state: "Selangor",
    category: "PUBLIC_CAREER_FAIR",
    audience: "EVERYONE",
    capacity: 3000,
    status: "UPCOMING",
    registrations: 156,
  },
  {
    title: "National Career Fair 2027",
    description:
      "Talentbank's national two-day fair, held in partnership with employers and universities nationwide.",
    date: "2027-06-19",
    endDate: "2027-06-20",
    startTime: "10:00",
    endTime: "18:00",
    location: "Kuala Lumpur Convention Centre",
    state: "Kuala Lumpur",
    category: "PUBLIC_CAREER_FAIR",
    audience: "EVERYONE",
    capacity: 5000,
    status: "UPCOMING",
    registrations: 89,
  },
];

/* ------------------------------------------------------- registrant names --- */

const FIRST_NAMES = [
  "Aisyah", "Muhammad", "Nurul", "Ahmad", "Siti", "Wei Jie", "Mei Ling", "Rajesh",
  "Priya", "Hafiz", "Farah", "Daniel", "Chong", "Kavitha", "Amirul", "Nadia",
  "Yong Hui", "Zulkifli", "Sharifah", "Arun", "Li Wen", "Iskandar", "Anis",
  "Kumar", "Xin Yi", "Faizal", "Melissa", "Ravi", "Syafiqah", "Jun Hao",
];

const LAST_NAMES = [
  "binti Rahman", "bin Abdullah", "Tan", "Lim", "Subramaniam", "Wong", "Ismail",
  "Lee", "Krishnan", "Yusof", "Chan", "Nair", "Hassan", "Ng", "Pillai",
  "Mohamed", "Cheah", "Devi", "Aziz", "Teoh",
];

/** Deterministic pseudo-random so re-seeding produces the same demo data. */
function makeRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function buildRegistrants(eventSlug: string, count: number, audience: EventAudience) {
  const random = makeRandom(
    [...eventSlug].reduce((sum, ch) => sum + ch.charCodeAt(0), 7),
  );
  const rows: { name: string; email: string; user_type: UserType }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i += 1) {
    const first = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
    const name = `${first} ${last}`;
    const handle = `${first}.${last}`
      .toLowerCase()
      .replace(/[^a-z.]/g, "")
      .replace(/\.+/g, ".");
    const email = `${handle}.${i}@example.com`;
    if (seen.has(email)) continue;
    seen.add(email);
    // Respect the event's audience: a campus fair marked "For candidates"
    // must not seed employers, or the demo data contradicts the rule the
    // registration flow enforces. Where both are welcome, roughly 1 in 8 is
    // an employer, which matches the mix at a typical fair.
    const allowed = allowedUserTypes(audience);
    const userType =
      allowed.length === 1 ? allowed[0] : random() < 0.125 ? "EMPLOYER" : "CANDIDATE";
    rows.push({ name, email, user_type: userType });
  }
  return rows;
}

/* ------------------------------------------------------------------ run --- */

/** A placeholder slot used during phase 1 so the capacity trigger lets us in. */
const PLACEHOLDER_START = fromKL("2099-01-01", "10:00").toISOString();
const PLACEHOLDER_END = fromKL("2099-01-01", "17:00").toISOString();

async function main() {
  console.log("\n  Talentbank Career Fair OS — loading demo data\n");

  // --- wipe -------------------------------------------------------------
  // Registrations and history cascade from events, so one delete is enough.
  const { error: wipeError } = await db.from("events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (wipeError) {
    console.error(`  Could not clear existing events: ${wipeError.message}`);
    console.error("  Has supabase/migrations/0001_schema.sql been run yet?\n");
    process.exit(1);
  }
  console.log("  · cleared existing events");

  let totalRegistrations = 0;

  for (const spec of SPECS) {
    const slug = slugify(spec.title);
    // Both instants sit on the FIRST day; `endDate` becomes last_date. A
    // two-day fair runs its hours on each day, not continuously overnight.
    const realStart = fromKL(spec.date, spec.startTime).toISOString();
    const realEnd = fromKL(spec.date, spec.endTime).toISOString();
    const realLastDate = spec.endDate && spec.endDate > spec.date ? spec.endDate : null;

    // Phase 1 — insert the event as it was when registration was open.
    const needsTwoPhase =
      spec.registrations > 0 &&
      (spec.status !== "UPCOMING" ||
        fromKL(realLastDate ?? spec.date, spec.endTime).getTime() < Date.now());

    const { data: created, error: insertError } = await db
      .from("events")
      .insert({
        slug,
        title: spec.title,
        description: spec.description,
        start_at: needsTwoPhase ? PLACEHOLDER_START : realStart,
        end_at: needsTwoPhase ? PLACEHOLDER_END : realEnd,
        last_date: needsTwoPhase ? null : realLastDate,
        location: spec.location,
        state: spec.state,
        category: spec.category,
        audience: spec.audience,
        status: "UPCOMING",
        capacity: spec.capacity,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      console.error(`  ! ${spec.title}: ${insertError?.message}`);
      continue;
    }

    // Phase 2 — the registrations people made while it was open.
    const registrants = buildRegistrants(slug, spec.registrations, spec.audience);
    for (let i = 0; i < registrants.length; i += 200) {
      const batch = registrants.slice(i, i + 200).map((r) => ({ ...r, event_id: created.id }));
      const { error } = await db.from("registrations").insert(batch);
      if (error) {
        console.error(`  ! ${spec.title} registrations: ${error.message}`);
        break;
      }
    }
    totalRegistrations += registrants.length;

    // Phase 3 — apply the real schedule and status.
    if (needsTwoPhase || spec.status !== "UPCOMING") {
      const { error } = await db
        .from("events")
        .update({
          start_at: realStart,
          end_at: realEnd,
          last_date: realLastDate,
          status: spec.status,
          cancellation_reason: spec.cancellationReason ?? null,
        })
        .eq("id", created.id);
      if (error) console.error(`  ! ${spec.title} finalise: ${error.message}`);
    }

    // An audit trail that starts empty looks broken, so record the creation
    // and, where relevant, the change that closed the event.
    const history: Array<Record<string, unknown>> = [
      {
        event_id: created.id,
        action: "CREATED",
        new_value: { title: spec.title, start_at: realStart, capacity: spec.capacity },
        changed_by: "seed@talentbank.demo",
        source: "MANUAL",
      },
    ];
    if (spec.status === "CANCELLED") {
      history.push({
        event_id: created.id,
        action: "CANCELLED",
        previous_value: { status: "UPCOMING" },
        new_value: { status: "CANCELLED" },
        reason: spec.cancellationReason,
        changed_by: "seed@talentbank.demo",
        source: "MANUAL",
      });
    }
    if (spec.status === "FULL") {
      history.push({
        event_id: created.id,
        action: "MARKED_FULL",
        previous_value: { status: "UPCOMING" },
        new_value: { status: "FULL" },
        reason: "Reached venue capacity",
        changed_by: "seed@talentbank.demo",
        source: "MANUAL",
      });
    }
    await db.from("event_history").insert(history);

    console.log(
      `  · ${spec.title.padEnd(48).slice(0, 48)} ${String(registrants.length).padStart(5)} registrations`,
    );
  }

  // --- admin account ----------------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const { data: existing } = await db.auth.admin.listUsers();
    const already = existing?.users.find((u) => u.email === adminEmail);

    let userId = already?.id;
    if (!userId) {
      const { data, error } = await db.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
      });
      if (error) console.error(`  ! could not create admin user: ${error.message}`);
      userId = data?.user?.id;
    } else {
      await db.auth.admin.updateUserById(userId, { password: adminPassword });
    }

    if (userId) {
      await db
        .from("admin_users")
        .upsert({ id: userId, email: adminEmail, full_name: "Talentbank Events Team" });
      console.log(`\n  · admin account ready: ${adminEmail}`);
    }
  } else {
    console.log(
      "\n  · skipped admin account (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env.local)",
    );
  }

  console.log(
    `\n  Done. ${SPECS.length} events, ${totalRegistrations.toLocaleString()} registrations.\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
