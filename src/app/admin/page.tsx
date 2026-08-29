import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getRecentHistory, listEvents } from "@/lib/data/events";
import { deriveStatus, getAvailability } from "@/lib/domain/availability";
import {
  toTimeKey,
  formatTime12h,
  formatDateShort,
  formatDailyHours,
  relativeDayLabel,
  toDateKey,
} from "@/lib/domain/time";
import type { EventStatus } from "@/lib/domain/types";
import { AdminShell } from "@/components/admin/admin-shell";
import { CopilotPanel } from "@/components/admin/copilot-panel";
import { StatusBadge } from "@/components/status-badge";
import { SetupNotice } from "@/components/setup-notice";

export const dynamic = "force-dynamic";

/**
 * The AI Copilot lives on this page, and one Copilot request can legitimately
 * run for the best part of a minute: up to 24s for the model, a 1.5s pause, up
 * to 24s for one retry on a 5xx, plus the database reads around it. Vercel's
 * default function timeout is shorter than that, so without this the function
 * is killed mid-flight and the admin sees a generic failure instead of the
 * error messages the Copilot actually produces.
 *
 * Local development has no timeout, which is why this never showed up until
 * deployment was considered.
 */
export const maxDuration = 60;

export default async function AdminOverviewPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const admin = await requireAdmin();
  const events = await listEvents();

  const now = new Date();
  const today = toDateKey(now);

  const withStatus = events.map((event) => ({
    event,
    status: deriveStatus(event, now),
    availability: getAvailability(event),
  }));

  const counts = withStatus.reduce<Record<EventStatus, number>>(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { UPCOMING: 0, FULL: 0, CANCELLED: 0, COMPLETED: 0, RESCHEDULED: 0 },
  );

  const upcoming = withStatus
    .filter((item) => item.event.startAt.getTime() >= now.getTime() && item.status !== "CANCELLED")
    .sort((a, b) => a.event.startAt.getTime() - b.event.startAt.getTime());

  const totalRegistrations = events.reduce((sum, e) => sum + e.registeredCount, 0);

  // Events worth acting on today — the actual job of an events coordinator.
  const attention = withStatus.filter(
    (item) =>
      (item.status === "UPCOMING" && item.availability.isAlmostFull) ||
      (item.status === "COMPLETED" && item.event.status === "UPCOMING"),
  );

  const history = await getRecentHistory(8);

  return (
    <AdminShell admin={admin} active="/admin">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          {/* No first-name split: admin_users.full_name may hold a team name
              ("Talentbank Events Team"), and taking the first word greeted the
              user as "Talentbank". Using the whole name is correct for both a
              person and a team. */}
          Good to see you, {admin.fullName}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {upcoming.length} upcoming {upcoming.length === 1 ? "event" : "events"} ·{" "}
          {totalRegistrations.toLocaleString()} total registrations
        </p>
      </div>

      {/* --------------------------------------------------------- stat row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open for registration" value={counts.UPCOMING + counts.RESCHEDULED} tone="open" />
        <StatCard label="At capacity" value={counts.FULL} tone="full" />
        <StatCard label="Cancelled" value={counts.CANCELLED} tone="cancelled" />
        <StatCard label="Completed" value={counts.COMPLETED} tone="done" />
      </div>

      {attention.length > 0 && (
        <section className="mt-6 rounded-xl border border-[var(--color-status-full-line)] bg-[var(--color-status-full-bg)] p-4">
          <h2 className="text-sm font-bold text-[var(--color-status-full)]">Needs your attention</h2>
          <ul className="mt-2 space-y-1.5">
            {attention.map((item) => (
              <li key={item.event.id} className="text-sm">
                <Link
                  href={`/admin/events/${item.event.id}`}
                  className="font-semibold text-[var(--color-ink-900)] hover:underline"
                >
                  {item.event.title}
                </Link>
                <span className="ml-2 text-[var(--muted-foreground)]">
                  {item.status === "COMPLETED"
                    ? "has finished but is still marked upcoming — consider closing it off."
                    : `is nearly full — only ${item.availability.remaining} places left.`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_23rem]">
        <div className="space-y-6">
          <CopilotPanel />

          {/* ------------------------------------------------ next up list */}
          <section className="card overflow-hidden">
            <header className="flex items-center justify-between border-b p-4">
              <h2 className="text-base font-bold text-[var(--color-ink-900)]">Coming up next</h2>
              <Link
                href="/admin/events"
                className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
              >
                All events
              </Link>
            </header>

            {upcoming.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted-foreground)]">
                No upcoming events yet.{" "}
                <Link href="/admin/events/new" className="font-semibold text-[var(--color-brand-700)]">
                  Add one
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y">
                {upcoming.slice(0, 6).map(({ event, status, availability }) => {
                  const startDate = toDateKey(event.startAt);
                  return (
                    <li key={event.id}>
                      <Link
                        href={`/admin/events/${event.id}`}
                        className="flex items-center gap-4 p-4 hover:bg-slate-50"
                      >
                        <div className="w-16 shrink-0 rounded-lg bg-[var(--surface-muted)] py-1.5 text-center">
                          <p className="text-[10px] font-bold uppercase text-[var(--muted-foreground)]">
                            {formatDateShort(startDate).split(" ")[1]}
                          </p>
                          <p className="text-lg font-bold leading-none text-[var(--color-ink-900)]">
                            {Number(startDate.slice(8, 10))}
                          </p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[var(--color-ink-900)]">
                            {event.title}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                            {formatDailyHours(event.startAt, event.endAt, event.lastDate)} · {event.location}
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-sm font-semibold tabular-nums text-[var(--color-ink-900)]">
                            {availability.registered}/{availability.capacity}
                          </p>
                          {relativeDayLabel(startDate, today) && (
                            <p className="text-[11px] text-[var(--muted-foreground)]">
                              {relativeDayLabel(startDate, today)}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={status} size="sm" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* -------------------------------------------------- activity feed */}
        <aside>
          <section className="card overflow-hidden">
            <header className="border-b p-4">
              <h2 className="text-base font-bold text-[var(--color-ink-900)]">Recent activity</h2>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                Every change is recorded, including which ones came from the Copilot.
              </p>
            </header>
            {history.length === 0 ? (
              <p className="p-4 text-sm text-[var(--muted-foreground)]">Nothing yet.</p>
            ) : (
              <ul className="divide-y">
                {history.map((entry) => (
                  <li key={entry.id} className="p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                        {entry.action.toLowerCase().replace("_", " ")}
                      </span>
                      {entry.source === "COPILOT" && (
                        <span className="rounded bg-[var(--color-copilot-100)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-copilot-700)]">
                          Copilot
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-[var(--color-ink-900)]">
                      {entry.eventTitle}
                    </p>
                    {entry.reason && (
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{entry.reason}</p>
                    )}
                    <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                      {entry.changedBy} ·{" "}
                      {formatDateShort(toDateKey(entry.createdAt))} at{" "}
                      {formatTime12h(toTimeKey(entry.createdAt))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}

const TONES = {
  open: "text-[var(--color-status-open)]",
  full: "text-[var(--color-status-full)]",
  cancelled: "text-[var(--color-status-cancelled)]",
  done: "text-[var(--color-status-done)]",
} as const;

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONES;
}) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${TONES[tone]}`}>{value}</p>
    </div>
  );
}
