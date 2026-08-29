# Talentbank Career Fair OS

A prototype career-fair calendar and event-management system, built for the
Talentbank Junior AI Automation Engineer challenge.

This document is a **setup and handover guide**. Follow it top to bottom and you
will have the application running on your own machine. No prior knowledge of the
project is assumed.

---

## 1. What this project is

Talentbank runs around fifty career fairs a year. This prototype covers two
groups of people.

**For candidates and employers (the public side)**

- A full-year calendar of career fairs, with month-by-month navigation
- Search and filters by event type, audience and Malaysian state
- An event page for every fair showing the date, time, venue, who it is for,
  and **how many places are left**
- Registration directly on the page, as a candidate or an employer
- Honest status: a fair that is **full** stops accepting registrations, and a
  fair that is **cancelled stays on the calendar** with the reason, instead of
  quietly disappearing

**For the Talentbank events team (the admin side)**

- A dashboard listing every event with its capacity and status
- Add, edit, move and cancel events — **no code or database access needed**
- A warning when a new date clashes with another event, graded by how serious
  the clash is
- The list of people registered for each event
- A history log of every change: what changed, who changed it, and when

**The AI Event Copilot**

Inside the admin dashboard there is an assistant you can talk to in plain
English — for example *"move the KL AI & Data Career Fair to the following
Thursday afternoon"*.

The important part: **the Copilot never changes anything by itself.** It reads
the real calendar and produces a *suggestion*. The system then checks that
suggestion against its own rules, shows you a preview, and only saves it after
you click **Apply**.

> **This is a prototype, not a production system.** All events in it are
> demonstration data and are not real Talentbank events.

---

## Quick start

If you just want it running, this is the whole thing — about 10 minutes, most of
which is creating a free Supabase project.

```bash
npm install
cp .env.example .env.local     # then fill in the values, see step 5
npm run seed                   # after running supabase/setup.sql, see step 6
npm run dev                    # open http://localhost:3000
```

| # | Step | Where |
| --- | --- | --- |
| 1 | `npm install` | Terminal |
| 2 | Create a free Supabase project | [supabase.com/dashboard](https://supabase.com/dashboard) |
| 3 | Paste **`supabase/setup.sql`** into the SQL Editor and run it | Supabase dashboard |
| 4 | Copy your Supabase URL and two keys into `.env.local` | Text editor |
| 5 | `npm run seed` | Terminal |
| 6 | `npm run dev` → http://localhost:3000 | Terminal + browser |

**You can run `npm install` and `npm run dev` before doing any of the Supabase
steps.** The site will load and show an on-screen setup guide rather than an
error, so you can confirm the project builds before signing up for anything.

The AI Copilot needs a free Gemini API key. **Everything else works without it** —
skip it if you only want to see the calendar and admin tools.

The rest of this document explains each step in detail.

---

## 2. What you need before you start

| Requirement | Notes |
| --- | --- |
| **Node.js 20 or newer** | Developed and tested on Node **v26.7.0**. Download from [nodejs.org](https://nodejs.org). Check with `node -v`. |
| **npm 10 or newer** | Comes with Node.js. Check with `npm -v`. |
| **Git** | Only needed if you are cloning the project rather than receiving a folder. Check with `git --version`. |
| **A Supabase account** | Free tier is enough. Sign up at [supabase.com](https://supabase.com). This is the database. |
| **A Google Gemini API key** | Free tier is enough. Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Only needed for the AI Copilot — everything else works without it. |

The project does not require Docker, a local database, or the Supabase CLI.

---

## 3. Get the project

If you were given the project as a folder, copy it somewhere sensible and skip
to step 4.

If you are cloning it from Git:

```bash
git clone <repository-url>
cd Talent
```

> There is no public repository URL configured in this project yet. Use whichever
> URL Talentbank hosts it at.

---

## 4. Install dependencies

From inside the project folder:

```bash
npm install
```

This downloads everything the project needs into a `node_modules` folder. It
takes a minute or two the first time. You only need to do this once.

---

## 5. Set up your environment variables

The application needs to know how to reach your database and the AI service.
Those values live in a file called `.env.local`, which you create yourself.

**Create the file** by copying the template that ships with the project:

```bash
cp .env.example .env.local
```

Then open `.env.local` in a text editor and fill in the values. The template
contains the variable names and comments, and **no real values**.

### The variables

| Variable | Safe in the browser? | Where to get it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Public** | Supabase → Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Public** | Supabase → Project Settings → API Keys → the `anon` / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | **SECRET** | Supabase → Project Settings → API Keys → the `service_role` / secret key |
| `GEMINI_API_KEY` | **SECRET** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `SEED_ADMIN_EMAIL` | Local only | You choose — e.g. `events@talentbank.demo` |
| `SEED_ADMIN_PASSWORD` | Local only | **You choose.** Any password you will remember. |

Your file should end up looking like this, with your own values in place of the
angle-bracket placeholders:

```bash
NEXT_PUBLIC_SUPABASE_URL=<your-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
GEMINI_API_KEY=<your-gemini-key>
SEED_ADMIN_EMAIL=events@talentbank.demo
SEED_ADMIN_PASSWORD=<choose-a-local-password>
```

### Optional variables

These have sensible defaults and can be left out entirely:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Which Gemini model the Copilot uses. Chosen by measuring speed **and** free-tier daily quota. Alternatives: `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`. |
| `GEMINI_THINKING_LEVEL` | `LOW` | How much the model reasons before answering. `LOW`, `MEDIUM`, `HIGH`, or `OFF`. |
| `GOOGLE_API_KEY` | — | Accepted as an alternative name for `GEMINI_API_KEY`. |

> ### ⚠️ Do not commit `.env.local` to GitHub
>
> It contains keys that give full access to your database. The project's
> `.gitignore` already excludes it (the `.env*` rule on line 34), so Git will
> not pick it up. Do not override that, and do not paste these values into
> chat, tickets or email.
>
> `.env.example` **is** committed on purpose — it contains variable names only.

---

## 6. Set up the database

The database lives in Supabase. You need to create a project and run three SQL
files, in order.

**Step 1 — create a Supabase project**

Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new
project. Any region works; Singapore is closest to Malaysia. Supabase will ask
you to set a database password — save it somewhere, though this application
does not use it directly.

**Step 2 — create the tables (one file, one paste)**

In the Supabase dashboard, open **SQL Editor** in the left sidebar, click
**New query**, paste the **entire contents of `supabase/setup.sql`**, and click
**Run**.

That single file contains all three migrations in the correct order. The SQL
Editor runs it as one transaction, so it either applies completely or not at all.

**What success looks like:** the editor shows **"Success. No rows returned."**

**Is it safe to re-run?** Yes. Everything in it uses `IF NOT EXISTS`,
`CREATE OR REPLACE` or guarded updates. If you are unsure whether it applied,
running it again is harmless.

<details>
<summary>Prefer to run the migrations individually?</summary>

`supabase/setup.sql` is generated from these three files. You can run them one at
a time instead, in this order:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase/migrations/0001_schema.sql` | Tables, security rules, capacity safeguards |
| 2 | `supabase/migrations/0002_grants.sql` | Database permissions |
| 3 | `supabase/migrations/0003_multi_day.sql` | Multi-day events and audience restrictions |

`0002_grants.sql` exists for databases created before those grants were folded
into `0001`. On a brand-new project `0001` then `0003` is enough, but running all
three in order is simpler and does no harm.

</details>

**Step 3 — load the demonstration data**

Back in your terminal, in the project folder:

```bash
npm run seed
```

This creates roughly 26 career fairs spread across a year, with realistic
registrations, and it creates your admin login. It prints what it is doing as it
goes and finishes with a summary.

> `npm run seed` **deletes all existing events first** and replaces them. Only
> run it on a database you are happy to reset.

---

## 7. The admin account

`npm run seed` creates the admin account for you, using the two values you put
in `.env.local`:

```bash
SEED_ADMIN_EMAIL=events@talentbank.demo
SEED_ADMIN_PASSWORD=<choose-a-local-password>
```

If you leave `SEED_ADMIN_PASSWORD` blank, the seed script skips creating the
account and says so — set a password and run `npm run seed` again.

You log in at **http://localhost:3000/admin/login**. Visiting any admin page
while signed out redirects you there automatically.

---

## 8. Run the application

```bash
npm run dev
```

Then open **http://localhost:3000** in your browser.

**To stop the server:** press `Ctrl + C` in the terminal window where it is
running.

---

## 9. Pages in the application

| Address | What it is |
| --- | --- |
| `/` | Public career-fair calendar — month grid, list view, search and filters |
| `/events/<event-name>` | Public event page with full details and the registration form |
| `/admin` | Admin dashboard — overview, alerts, activity log and the AI Copilot |
| `/admin/login` | Sign-in page for the events team |
| `/admin/events` | Every event, grouped by month, with capacity and status |
| `/admin/events/new` | Add a new event |
| `/admin/events/<id>` | One event: move it, change its status, see registrations and history |
| `/admin/events/<id>/edit` | Edit an event's details |

---

## 10. How to use the system

### Public side

1. **Browse** — the calendar opens on the current month. Use the arrows to move
   between months, **Today** to jump back, or switch to **List** view.
2. **Filter** — search by name, venue or state, and narrow by event type,
   audience or state. **Open for registration** hides everything you cannot book.
3. **Open an event** — click any event in the grid or any card below it.
4. **Check capacity** — the event page shows *places left* rather than a ratio,
   and warns you when a fair is nearly full.
5. **Register** — enter your name and email, choose candidate or employer, and
   confirm. The remaining count updates immediately.
6. **Audience restrictions** — a fair marked *For candidates* only offers the
   candidate option; *For employers* only offers employer; *Open to all* offers
   both. This is enforced on the server and in the database, not just in the form.

### Admin side

1. **Sign in** at `/admin/login`.
2. **Create an event** — *Add event*. As you type a date, the system checks the
   calendar and warns you about clashes straight away.
3. **Edit an event** — open it, then *Edit details*.
4. **Move an event** — open it and click *Move event*. You see the current date
   and the new one side by side before you confirm.
5. **Cancel an event** — open it, choose *Cancel event*, and give a reason. The
   reason is shown publicly. The event stays on the calendar and its
   registrations are kept.
6. **See registrations** — listed at the bottom of each event page, with a
   breakdown of candidates and employers.
7. **Understand conflicts** — clashes are graded:
   - **Venue clash** — same venue, overlapping hours. Physically impossible.
   - **Same state** — same region, overlapping hours. The same team and employers
     are likely committed to both.
   - **Worth a look** — overlapping hours in a different state. Usually fine.

   A clash **never blocks you**. Talentbank legitimately runs several fairs on
   one day, so the system tells you and lets you decide.
8. **Review history** — every event page has a history panel showing each change,
   who made it, when, and whether it came from the Copilot.

---

## 11. The AI Event Copilot

The Copilot sits on the admin dashboard at `/admin`. Type what you want in plain
English and it reads the real calendar to work out what you mean.

### What it can do

- Suggest moving an event to a new date and time
- Draft a new event from a description
- Recommend better dates for an existing event
- Propose cancelling or reopening an event
- Answer questions about the schedule
- Ask you to clarify when your request is ambiguous

### Example prompts

```
Move the KL AI & Data Career Fair to the following Thursday afternoon

Suggest a better date for the Selangor Manufacturing Careers Day

Create a graduate career fair in Kuala Lumpur on 15 October from 10am to 4pm,
capacity 300, for final-year students and employers

Which events in October still have more than 200 places left?

Cancel the Sarawak Digital Economy Careers Day because the venue double-booked us
```

### Why you always have to approve

The Copilot produces a **proposal**, never a change. Behind the scenes it can
only choose from six fixed actions, and every one of them merely *describes*
something — none of them can write to the database.

Whatever it suggests is then checked by the same rules that apply when you fill
in the form by hand: does the event exist, are the dates real, does it break any
business rules, does it clash with anything. Only then are you shown a preview
with an **Apply** button.

If the suggestion clashes with another event, you must tick a box confirming you
have read the clash before Apply becomes available.

Every change made this way is recorded in the history log and tagged as a
**Copilot** change, so you can always tell which edits originated with the AI.

### A note on the free tier

The Gemini free tier allows only a few requests per minute and a limited number
per day. If the Copilot stops responding, wait a minute. If it says the daily
quota is used up, either wait until tomorrow or set `GEMINI_MODEL` in
`.env.local` to a different model — each model has its own separate quota.

---

## 12. Multi-day events

A career fair that runs over several days runs its **normal hours on each day** —
it does not run continuously through the night.

A three-day fair from 10–12 October, 10:00 AM to 5:00 PM, is stored and treated
as **three daily sittings of seven hours**, not one 55-hour block. The event page
reads:

> **10–12 October 2026** · 10:00 AM – 5:00 PM **each day**

It appears in the calendar on all three days, and conflict detection compares
events day by day — so an evening event on the first night is correctly *not*
reported as a clash with a fair that closed at 5 PM.

### How to enter a multi-day event

1. Go to **Add event** (or edit an existing one).
2. Set **Date** to the **first** day.
3. Set **Start time** and **End time** to the hours it runs **each day** —
   e.g. 10:00 and 17:00.
4. Tick **"This event runs across more than one day"**.
5. Set **Last day** to the final day.

> **Current limitation:** every day of a multi-day event uses the same hours. A
> fair running 10–5 on Saturday and 12–4 on Sunday cannot be represented; it
> would need a schema change.

---

## 13. Troubleshooting

**`npm install` fails**
Check `node -v` is 20 or newer. If it still fails, delete the `node_modules`
folder and the `package-lock.json` file, then run `npm install` again.

**The site loads but says "Finish connecting the database"**
`.env.local` is missing or the Supabase values are blank. Go back to step 5.
After editing `.env.local` you must **stop and restart** `npm run dev` — the file
is only read at startup.

**"column events.last_date does not exist" or similar database errors**
The database setup is incomplete. Go back to step 6 and run the whole of
`supabase/setup.sql`. Re-running it is safe.

**`npm run seed` says "Missing configuration"**
`NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing from
`.env.local`.

**`npm run seed` says "Could not clear existing events"**
The migrations have not been run yet, or the service-role key is wrong.

**Port 3000 is already in use**
Something else is using it. Either stop that program, or run the app on a
different port:

```bash
npm run dev -- -p 3001
```

**The Copilot says it is not configured**
`GEMINI_API_KEY` is missing from `.env.local`. Everything else in the app works
without it.

**The Copilot says the rate limit or daily quota is reached**
Expected on the free tier. Wait a minute, or change `GEMINI_MODEL` — see
section 11.

**The Copilot says the model is not available on this API key**
Set `GEMINI_MODEL` in `.env.local` to one of the alternatives listed in section 5.

**Cannot log in to the admin dashboard**
Check `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env.local`, then run
`npm run seed` again — it will reset the password to match.

---

## 14. Checking everything works

| Command | What it checks |
| --- | --- |
| `npm run verify` | Connects to your database and confirms the tables, permissions and security rules are all correct. **Run this first if anything seems wrong.** Creates no data. |
| `npm test` | Runs the business-rule tests — dates, capacity, conflicts, statuses, audience rules. Needs no database. |
| `npm run lint` | Checks code style and common mistakes. |
| `npm run build` | Builds the production version, which also type-checks everything. |
| `npm run verify:concurrency` | Proves capacity cannot be exceeded: fires 40 simultaneous registrations at an event with 4 places and confirms exactly 4 succeed. Creates a temporary event and deletes it afterwards. |
| `npm run start` | Runs the built production version. Run `npm run build` first. |

A healthy project reports **all checks passed** from `npm run verify` and
**0 failing** from `npm test`.

---

## 15. Security notes

- **Never commit `.env.local`.** It is already in `.gitignore`.
- **The service-role key bypasses all database security.** It is used only by
  `npm run seed`, never by the website itself.
- **The Gemini API key is read only on the server**, inside the Copilot. It never
  reaches the browser.
- **Only variables starting with `NEXT_PUBLIC_` reach the browser.** Those two
  are safe to expose — the database's own security rules protect them.
- **Never paste any of these values into GitHub, chat or email.**
- If a key is ever exposed, rotate it in Supabase or Google AI Studio and update
  `.env.local`.

---

## 16. Running the demonstration

A short walkthrough of the main features, using the data `npm run seed` creates.

1. **Start the app** — `npm run dev`, then open http://localhost:3000
2. **Browse the calendar** — move forward to **October 2026**
3. **Open a multi-day event** — *Talentbank Tech Career Fair* on 3–4 October
   shows on both days and reads "10:00 AM – 6:00 PM each day"
4. **Register** — open *KL AI & Data Career Fair* (18 September), which is nearly
   full, register, and watch the places-left count drop
5. **See the edge cases** — *Talentbank Penang TES Career Fair* is full;
   *Sabah Graduate Career Fair* is cancelled but still listed with its reason;
   *Unitar International University Career Fair* is candidates-only and does not
   offer the employer option
6. **Log in** at `/admin/login`
7. **Move an event** — open *Penang Tech Talent Fair*, click **Move event**, and
   set the date to 18 September to trigger the conflict warning
8. **Use the Copilot** — on `/admin`, click the example prompt *"Move the KL AI &
   Data Career Fair to the following Thursday afternoon"*
9. **Review before applying** — read the proposed slot and the Copilot's
   reasoning, then either **Apply** or **Discard**. Nothing changes until you
   choose.

---

## Project layout

```
src/app/          Pages (public calendar, event pages, admin dashboard)
src/components/   Reusable interface pieces
src/lib/domain/   The business rules — dates, capacity, conflicts, audiences.
                  Plain TypeScript with no database, so it can be tested alone.
src/lib/actions/  The only code allowed to change data
src/lib/copilot/  The AI integration and the six actions it may propose
src/lib/data/     Database queries
supabase/         setup.sql (paste this into Supabase) and the three
                  individual migration files it is generated from
scripts/          Seed and health-check scripts
tests/            Business-rule tests
```
