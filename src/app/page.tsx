import { listEvents } from "@/lib/data/events";
import { isSupabaseConfigured } from "@/lib/env";
import { deriveStatus, getAvailability } from "@/lib/domain/availability";
import { toDateKey } from "@/lib/domain/time";
import { CalendarExplorer } from "@/components/calendar-explorer";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { SetupNotice } from "@/components/setup-notice";

// Registrations change the numbers on this page, so it must not be cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <SiteHeader />
        <SetupNotice />
        <SiteFooter />
      </>
    );
  }

  let events;
  try {
    events = await listEvents();
  } catch (error) {
    return (
      <>
        <SiteHeader />
        <SetupNotice detail={error instanceof Error ? error.message : String(error)} />
        <SiteFooter />
      </>
    );
  }

  const now = new Date();
  const today = toDateKey(now);

  const open = events.filter((e) => {
    const status = deriveStatus(e, now);
    return status === "UPCOMING" || status === "RESCHEDULED";
  });
  const placesLeft = open.reduce((sum, e) => sum + getAvailability(e).remaining, 0);
  const states = [...new Set(events.map((e) => e.state))].sort();

  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* ------------------------------------------------------------ hero */}
        <section className="border-b bg-gradient-to-b from-[var(--color-ink-950)] to-[var(--color-ink-800)] text-white">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-brand-300)]">
              The nation&rsquo;s talent authority
            </p>
            <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Every Talentbank career fair, on one calendar.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Find the fairs happening near you, see how many places are left before you travel,
              and register in under a minute.
            </p>

            <dl className="mt-8 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Stat label="Events listed" value={events.length.toLocaleString()} />
              <Stat label="Open for registration" value={open.length.toLocaleString()} />
              <Stat label="Places available" value={placesLeft.toLocaleString()} />
              <Stat label="States covered" value={states.length.toLocaleString()} />
            </dl>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <CalendarExplorer
            events={events}
            today={today}
            nowIso={now.toISOString()}
            states={states}
          />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
