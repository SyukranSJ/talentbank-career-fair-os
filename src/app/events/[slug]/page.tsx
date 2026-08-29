import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEventBySlug, listEvents } from "@/lib/data/events";
import { isSupabaseConfigured } from "@/lib/env";
import {
  deriveStatus,
  getAvailability,
  isRegistrationOpen,
  registrationClosedReason,
} from "@/lib/domain/availability";
import {
  formatDailyHours,
  formatDayRange,
  relativeDayLabel,
  toDateKey,
  weekdayName,
} from "@/lib/domain/time";
import { AUDIENCE_LABELS, CATEGORY_LABELS } from "@/lib/domain/types";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { SetupNotice } from "@/components/setup-notice";
import { StatusBadge } from "@/components/status-badge";
import { CapacityMeter } from "@/components/capacity-meter";
import { EventCard } from "@/components/event-card";
import { RegistrationForm } from "@/components/registration-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  if (!isSupabaseConfigured()) return { title: "Event" };
  const { slug } = await params;
  const event = await getEventBySlug(slug).catch(() => null);
  if (!event) return { title: "Event not found" };
  return {
    title: event.title,
    description: `${formatDayRange(toDateKey(event.startAt), event.lastDate)} · ${event.location}, ${event.state}`,
  };
}

export default async function EventPage({ params }: PageProps<"/events/[slug]">) {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <SiteHeader />
        <SetupNotice />
        <SiteFooter />
      </>
    );
  }

  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const now = new Date();
  const today = toDateKey(now);
  const status = deriveStatus(event, now);
  const availability = getAvailability(event);
  const canRegister = isRegistrationOpen(event, now);
  const closedReason = registrationClosedReason(event, now);
  const startDate = toDateKey(event.startAt);
  const lastDate = event.lastDate;
  const relative = relativeDayLabel(startDate, today);

  // "Other fairs you could go to instead" — the genuinely useful thing to show
  // someone looking at a cancelled or full event.
  const all = await listEvents();
  const alternatives = all
    .filter(
      (e) =>
        e.id !== event.id &&
        isRegistrationOpen(e, now) &&
        e.startAt.getTime() > now.getTime(),
    )
    .sort((a, b) => {
      // Same state first, then soonest.
      const stateScore = (x: typeof a) => (x.state === event.state ? 0 : 1);
      return stateScore(a) - stateScore(b) || a.startAt.getTime() - b.startAt.getTime();
    })
    .slice(0, 3);

  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-[var(--color-brand-700)] hover:underline"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to the calendar
          </Link>

          {/* --------------------------------------------- cancellation banner */}
          {status === "CANCELLED" && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--color-status-cancelled-line)] bg-[var(--color-status-cancelled-bg)] p-4"
            >
              <svg
                viewBox="0 0 24 24"
                className="mt-0.5 size-5 shrink-0 text-[var(--color-status-cancelled)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
              </svg>
              <div>
                <p className="font-bold text-[var(--color-status-cancelled)]">
                  This event has been cancelled
                </p>
                <p className="mt-0.5 text-sm text-[var(--foreground)]">
                  {event.cancellationReason ??
                    "Talentbank has cancelled this event. Registration is closed."}
                </p>
                {availability.registered > 0 && (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    {availability.registered.toLocaleString()} people had already registered and
                    have been notified.
                  </p>
                )}
              </div>
            </div>
          )}

          {status === "RESCHEDULED" && (
            <div
              role="status"
              className="mt-4 rounded-xl border border-[var(--color-status-moved-line)] bg-[var(--color-status-moved-bg)] p-4"
            >
              <p className="font-bold text-[var(--color-status-moved)]">This event has moved</p>
              <p className="mt-0.5 text-sm text-[var(--foreground)]">
                The date or time changed after it was first published. The details below are
                current. Existing registrations are still valid.
              </p>
            </div>
          )}

          <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_22rem]">
            {/* ---------------------------------------------------------- main */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--color-brand-50)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-brand-700)]">
                  {CATEGORY_LABELS[event.category]}
                </span>
                <StatusBadge status={status} />
              </div>

              <h1
                className={`mt-3 text-2xl font-bold leading-tight tracking-tight text-[var(--color-ink-900)] sm:text-3xl ${
                  status === "CANCELLED" ? "line-through decoration-[var(--color-status-cancelled)]/40" : ""
                }`}
              >
                {event.title}
              </h1>

              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <DetailRow label="Date" icon="calendar">
                  {/* Dates only. The Time row directly beside this one owns the
                      hours — printing the full schedule here repeated them. */}
                  <span className="font-semibold">
                    {formatDayRange(startDate, lastDate)}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                    {weekdayName(startDate)}
                    {status !== "COMPLETED" && status !== "CANCELLED" && relative && (
                      <> · {relative}</>
                    )}
                  </span>
                </DetailRow>

                <DetailRow label="Time" icon="clock">
                  {/* Hours only — the Date row above already states which days.
                      "each day" is appended for a multi-day run so this never
                      reads as one continuous overnight session. */}
                  <span className="font-semibold">
                    {formatDailyHours(event.startAt, event.endAt, lastDate)}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                    Malaysia time (GMT+8)
                  </span>
                </DetailRow>

                <DetailRow label="Location" icon="pin">
                  <span className="font-semibold">{event.location}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                    {event.state}
                  </span>
                </DetailRow>

                <DetailRow label="Who it's for" icon="users">
                  <span className="font-semibold">{AUDIENCE_LABELS[event.audience]}</span>
                </DetailRow>
              </dl>

              {event.description && (
                <section className="mt-7 border-t pt-6">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    About this event
                  </h2>
                  <div className="mt-3 space-y-3 text-sm leading-relaxed text-[var(--foreground)]">
                    {event.description.split("\n").filter(Boolean).map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </section>
              )}

              <p className="mt-7 rounded-lg bg-[var(--surface-muted)] p-3 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                <strong className="font-semibold">Demonstration data.</strong> This is a prototype
                built for the Talentbank Junior AI Automation Engineer challenge. This event is not
                a real Talentbank event.
              </p>
            </div>

            {/* -------------------------------------------------------- aside */}
            <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
              {/* "Places left" is only meaningful while a place is something you
                  can still take. On a cancelled or finished event the same
                  number contradicts the banner directly above it, so those
                  states report attendance instead. */}
              {canRegister ? (
                <div className="card p-5">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Availability
                  </h2>
                  <p className="mt-3 text-3xl font-bold tabular-nums text-[var(--color-ink-900)]">
                    {availability.remaining.toLocaleString()}
                    <span className="ml-1.5 text-sm font-medium text-[var(--muted-foreground)]">
                      of {availability.capacity.toLocaleString()} places left
                    </span>
                  </p>
                  <div className="mt-3">
                    <CapacityMeter availability={availability} />
                  </div>
                  {availability.isAlmostFull && (
                    <p className="mt-3 rounded-md bg-[var(--color-status-full-bg)] px-2.5 py-2 text-xs font-semibold text-[var(--color-status-full)]">
                      Filling up fast — only {availability.remaining} left.
                    </p>
                  )}
                </div>
              ) : (
                <div className="card p-5">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {status === "COMPLETED" ? "Attendance" : "Registrations"}
                  </h2>
                  <p className="mt-3 text-3xl font-bold tabular-nums text-[var(--color-ink-900)]">
                    {availability.registered.toLocaleString()}
                    <span className="ml-1.5 text-sm font-medium text-[var(--muted-foreground)]">
                      {status === "CANCELLED"
                        ? "people were registered"
                        : status === "COMPLETED"
                          ? "people registered"
                          : `of ${availability.capacity.toLocaleString()} places taken`}
                    </span>
                  </p>
                  {status === "FULL" && (
                    <div className="mt-3">
                      <CapacityMeter availability={availability} />
                    </div>
                  )}
                  {status === "CANCELLED" && (
                    <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
                      These places are no longer available. Everyone who registered has been
                      contacted directly.
                    </p>
                  )}
                </div>
              )}

              {canRegister ? (
                <RegistrationForm event={event} remaining={availability.remaining} />
              ) : (
                <div className="card p-5">
                  <h3 className="text-base font-bold text-[var(--color-ink-900)]">
                    Registration closed
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">
                    {closedReason}
                  </p>
                  <button
                    type="button"
                    disabled
                    className="mt-4 w-full cursor-not-allowed rounded-lg bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500"
                  >
                    Registration unavailable
                  </button>
                </div>
              )}
            </aside>
          </div>

          {/* --------------------------------------------------- alternatives */}
          {alternatives.length > 0 && (
            <section className="mt-12 border-t pt-8">
              <h2 className="text-lg font-bold text-[var(--color-ink-900)]">
                {canRegister ? "Other fairs you might like" : "Other fairs still open"}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {canRegister
                  ? "Events happening soon, closest to this one."
                  : "These events are still taking registrations."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {alternatives.map((alt) => (
                  <EventCard key={alt.id} event={alt} now={now} today={today} />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

const ICONS = {
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M18 20a6 6 0 0 0-2-4.5" strokeLinecap="round" />
    </>
  ),
};

function DetailRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: keyof typeof ICONS;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
          {ICONS[icon]}
        </svg>
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </dt>
        <dd className="mt-0.5 text-sm text-[var(--foreground)]">{children}</dd>
      </div>
    </div>
  );
}
