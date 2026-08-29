import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { listEvents } from "@/lib/data/events";
import { deriveStatus, getAvailability } from "@/lib/domain/availability";
import {
  formatDailyHours,
  formatDateShort,
  monthName,
  toDateKey,
} from "@/lib/domain/time";
import { CATEGORY_LABELS } from "@/lib/domain/types";
import { AdminShell } from "@/components/admin/admin-shell";
import { StatusBadge } from "@/components/status-badge";
import { SetupNotice } from "@/components/setup-notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "All events" };

export default async function AdminEventsPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const admin = await requireAdmin();
  const events = await listEvents();
  const now = new Date();

  // Grouped by month so the list reads like a calendar rather than a table dump.
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const key = toDateKey(event.startAt).slice(0, 7);
    const list = groups.get(key);
    if (list) list.push(event);
    else groups.set(key, [event]);
  }

  return (
    <AdminShell admin={admin} active="/admin/events">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
            All events
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {events.length} events across the full calendar.
          </p>
        </div>
        <Link
          href="/admin/events/new"
          className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)]"
        >
          Add event
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-[var(--color-ink-900)]">No events yet</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Add your first event, or run <code className="rounded bg-slate-100 px-1">npm run seed</code> to
            load the demo calendar.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-2 text-sm font-bold text-[var(--color-ink-900)]">
                {monthName(Number(key.slice(5, 7)))} {key.slice(0, 4)}
                <span className="ml-2 font-normal text-[var(--muted-foreground)]">
                  · {list.length}
                </span>
              </h2>
              <div className="card divide-y overflow-hidden">
                {list.map((event) => {
                  const status = deriveStatus(event, now);
                  const availability = getAvailability(event);
                  return (
                    <Link
                      key={event.id}
                      href={`/admin/events/${event.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 hover:bg-slate-50"
                    >
                      <div className="w-14 shrink-0 text-center">
                        <p className="text-lg font-bold leading-none text-[var(--color-ink-900)]">
                          {Number(toDateKey(event.startAt).slice(8, 10))}
                        </p>
                        <p className="text-[10px] font-bold uppercase text-[var(--muted-foreground)]">
                          {formatDateShort(toDateKey(event.startAt)).split(" ")[1]}
                        </p>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--color-ink-900)]">
                          {event.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                          {formatDailyHours(event.startAt, event.endAt, event.lastDate)} · {event.location},{" "}
                          {event.state} · {CATEGORY_LABELS[event.category]}
                        </p>
                      </div>

                      <div className="w-28 shrink-0">
                        <p className="text-right text-sm font-semibold tabular-nums text-[var(--color-ink-900)]">
                          {availability.registered.toLocaleString()}/
                          {availability.capacity.toLocaleString()}
                        </p>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              availability.isAtCapacity
                                ? "bg-[var(--color-status-full)]"
                                : "bg-[var(--color-brand-600)]"
                            }`}
                            style={{ width: `${availability.percentFull}%` }}
                          />
                        </div>
                      </div>

                      <StatusBadge status={status} size="sm" />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
