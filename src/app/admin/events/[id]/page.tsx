import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getEventById, getEventHistory, getRegistrations } from "@/lib/data/events";
import { deriveStatus, getAvailability } from "@/lib/domain/availability";
import {
  formatTime12h,
  formatDateShort,
  formatEventSchedule,
  toDateKey,
  toTimeKey,
} from "@/lib/domain/time";
import { AUDIENCE_LABELS, CATEGORY_LABELS } from "@/lib/domain/types";
import { AdminShell } from "@/components/admin/admin-shell";
import { StatusBadge } from "@/components/status-badge";
import { CapacityMeter } from "@/components/capacity-meter";
import { MovePanel, StatusPanel } from "@/components/admin/event-controls";
import { SetupNotice } from "@/components/setup-notice";

export const dynamic = "force-dynamic";

export default async function AdminEventPage({ params }: PageProps<"/admin/events/[id]">) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const admin = await requireAdmin();
  const { id } = await params;

  const event = await getEventById(id);
  if (!event) notFound();

  const [registrations, history] = await Promise.all([
    getRegistrations(event.id),
    getEventHistory(event.id),
  ]);

  const now = new Date();
  const status = deriveStatus(event, now);
  const availability = getAvailability(event);
  const startDate = toDateKey(event.startAt);
  const lastDate = event.lastDate;
  const isClosed = status === "CANCELLED" || status === "COMPLETED";

  const candidates = registrations.filter((r) => r.userType === "CANDIDATE").length;
  const employers = registrations.length - candidates;

  return (
    <AdminShell admin={admin} active="/admin/events">
      <Link
        href="/admin/events"
        className="text-sm font-semibold text-[var(--color-brand-700)] hover:underline"
      >
        ← All events
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              {CATEGORY_LABELS[event.category]}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
            {event.title}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {formatEventSchedule(event.startAt, event.endAt, event.lastDate)} · {event.location},{" "}
            {event.state}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/events/${event.slug}`}
            target="_blank"
            className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            View public page
          </Link>
          <Link
            href={`/admin/events/${event.id}/edit`}
            className="rounded-lg bg-[var(--color-ink-900)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-ink-800)]"
          >
            Edit details
          </Link>
        </div>
      </div>

      {status === "CANCELLED" && (
        <div className="mt-5 rounded-xl border border-[var(--color-status-cancelled-line)] bg-[var(--color-status-cancelled-bg)] p-4">
          <p className="font-bold text-[var(--color-status-cancelled)]">This event is cancelled</p>
          <p className="mt-0.5 text-sm">{event.cancellationReason}</p>
          {registrations.length > 0 && (
            <p className="mt-2 text-sm font-medium text-[var(--color-status-cancelled)]">
              {registrations.length.toLocaleString()} registrations were already taken. They are
              kept below so you can contact everyone.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {/* -------------------------------------------------- move / status */}
          <section className="card p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Manage
            </h2>
            {status !== "COMPLETED" && status !== "CANCELLED" ? (
              <div className="mt-4 flex flex-wrap items-start gap-3">
                <MovePanel
                  eventId={event.id}
                  location={event.location}
                  state={event.state}
                  current={{
                    date: startDate,
                    endDate: lastDate,
                    startTime: toTimeKey(event.startAt),
                    endTime: toTimeKey(event.endAt),
                  }}
                />
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                {status === "CANCELLED"
                  ? "A cancelled event cannot be moved. Reinstate it first if the date needs to change."
                  : "This event has already taken place, so it can no longer be moved."}
              </p>
            )}
            <div className="mt-4 border-t pt-4">
              <p className="mb-2.5 text-xs font-semibold text-[var(--color-ink-900)]">
                Change status
              </p>
              <StatusPanel
                eventId={event.id}
                currentStatus={event.status}
                registeredCount={registrations.length}
              />
            </div>
          </section>

          {/* ------------------------------------------------- registrations */}
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
              <div>
                <h2 className="text-base font-bold text-[var(--color-ink-900)]">Registrations</h2>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {candidates.toLocaleString()} candidates · {employers.toLocaleString()} employers
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums text-[var(--color-ink-900)]">
                {registrations.length.toLocaleString()} / {event.capacity.toLocaleString()}
              </span>
            </header>

            {registrations.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted-foreground)]">
                Nobody has registered yet.
              </p>
            ) : (
              <>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--surface-muted)] text-left">
                      <tr>
                        <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                          Name
                        </th>
                        <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                          Email
                        </th>
                        <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                          Type
                        </th>
                        <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                          Registered
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {registrations.slice(0, 100).map((registration) => (
                        <tr key={registration.id}>
                          <td className="px-4 py-2 font-medium text-[var(--color-ink-900)]">
                            {registration.name}
                          </td>
                          <td className="px-4 py-2 text-[var(--muted-foreground)]">
                            {registration.email}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                registration.userType === "EMPLOYER"
                                  ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {registration.userType.toLowerCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-[var(--muted-foreground)]">
                            {formatDateShort(toDateKey(registration.createdAt))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {registrations.length > 100 && (
                  <p className="border-t bg-[var(--surface-muted)] px-4 py-2 text-xs text-[var(--muted-foreground)]">
                    Showing the 100 most recent of {registrations.length.toLocaleString()}.
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        {/* ------------------------------------------------------- side rail */}
        <aside className="space-y-4">
          <section className="card p-5">
            {/* Same rule as the public page: "places left" is only meaningful
                while a place is something someone can still take. A cancelled
                or finished event reports what was taken instead — otherwise
                this panel contradicts the banner above it. */}
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              {isClosed ? "Registrations taken" : "Capacity"}
            </h2>
            <p className="mt-3 text-3xl font-bold tabular-nums text-[var(--color-ink-900)]">
              {isClosed
                ? availability.registered.toLocaleString()
                : availability.remaining.toLocaleString()}
              <span className="ml-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                {isClosed
                  ? `of ${availability.capacity.toLocaleString()} places`
                  : "places left"}
              </span>
            </p>
            {/* The meter's own label reads "N places left", so it is omitted
                entirely once the event is closed rather than contradicting the
                heading directly above it. */}
            {!isClosed && (
              <div className="mt-3">
                <CapacityMeter availability={availability} />
              </div>
            )}
            <dl className="mt-4 space-y-2 border-t pt-3 text-xs">
              <Meta label="Audience" value={AUDIENCE_LABELS[event.audience]} />
              <Meta label="Venue" value={event.location} />
              <Meta label="State" value={event.state} />
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 font-semibold text-[var(--muted-foreground)]">
                  Public link
                </dt>
                <dd className="truncate text-right">
                  <Link
                    href={`/events/${event.slug}`}
                    target="_blank"
                    className="text-[var(--color-brand-700)] hover:underline"
                  >
                    /events/{event.slug}
                  </Link>
                </dd>
              </div>
            </dl>
          </section>

          {/* --------------------------------------------------- audit trail */}
          <section className="card overflow-hidden">
            <header className="border-b p-4">
              <h2 className="text-sm font-bold text-[var(--color-ink-900)]">History</h2>
              <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                Written in the same transaction as the change, so it cannot go missing.
              </p>
            </header>
            {history.length === 0 ? (
              <p className="p-4 text-sm text-[var(--muted-foreground)]">
                No changes recorded yet.
              </p>
            ) : (
            <ol className="divide-y">
              {history.map((entry) => (
                <li key={entry.id} className="p-3.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                      {entry.action.toLowerCase().replace("_", " ")}
                    </span>
                    {entry.source === "COPILOT" && (
                      <span className="rounded bg-[var(--color-copilot-100)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-copilot-700)]">
                        Copilot
                      </span>
                    )}
                  </div>
                  {entry.action === "RESCHEDULED" && <RescheduleDiff entry={entry} />}
                  {entry.reason && (
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--foreground)]">
                      {entry.reason}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                    {entry.changedBy} ·{" "}
                      {formatDateShort(toDateKey(entry.createdAt))} at{" "}
                      {formatTime12h(toTimeKey(entry.createdAt))}
                  </p>
                </li>
              ))}
            </ol>
            )}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}

function RescheduleDiff({
  entry,
}: {
  entry: { previousValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null };
}) {
  const before = entry.previousValue?.start_at;
  const after = entry.newValue?.start_at;
  if (typeof before !== "string" || typeof after !== "string") return null;

  return (
    <p className="mt-1.5 text-xs text-[var(--foreground)]">
      <span className="text-[var(--muted-foreground)] line-through">
        {formatDateShort(toDateKey(new Date(before)))} {toTimeKey(new Date(before))}
      </span>
      <span className="mx-1.5">→</span>
      <span className="font-semibold">
        {formatDateShort(toDateKey(new Date(after)))} {toTimeKey(new Date(after))}
      </span>
    </p>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 font-semibold text-[var(--muted-foreground)]">{label}</dt>
      <dd className="truncate text-right text-[var(--foreground)]" title={value}>
        {value}
      </dd>
    </div>
  );
}
